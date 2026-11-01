import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { parseMatchesFromHtml, type NormalizedMatch } from './futbalnet.parser';
import { parseSportnetProgram, sportnetMatchKey } from './sportnet.parser';
import { ClubsService } from '../../clubs/clubs.service';

/** Zápas nášho tímu odvodený z futbalnet dát. */
interface OurMatch extends NormalizedMatch {
  opponent: string;
  isHome: boolean;
}

/**
 * Sportnet uvádza čas zápasu ako absolútny okamih (UTC). Portál však časy udalostí
 * ukladá ako „nástenný" (wall-clock) čas v UTC komponentoch pre pásmo Bratislavy
 * (17:00 v Košiciach = 17:00Z), aby sa zobrazoval rovnaký čas ako na sportnete.
 * Táto funkcia prevedie okamih na bratislavský nástenný čas uložený v UTC.
 */
export function toBratislavaWallClock(instant: Date): Date {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Bratislava',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value])) as Record<string, string>;
  let hour = Number(p.hour);
  if (hour === 24) hour = 0; // en-GB hour12:false môže o polnoci vrátiť „24"
  return new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second)));
}

@Injectable()
export class FutbalnetService {
  private readonly logger = new Logger(FutbalnetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clubs: ClubsService,
  ) {}

  /** Uloží sportnet program URL + názov nášho tímu pre konkrétne družstvo. */
  async setTeamSportnet(teamId: string, programUrl: string | null, teamName: string | null) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException('Družstvo neexistuje');
    return this.prisma.team.update({
      where: { id: teamId },
      data: {
        sportnetProgramUrl: programUrl?.trim() || null,
        sportnetTeamName: teamName?.trim() || null,
      },
    });
  }

  /**
   * Stiahne program súťaže zo sportnet.sme.sk a vytvorí/aktualizuje zápasy
   * daného družstva (idempotentne podľa stabilného kľúča zápasu).
   */
  async importTeamProgram(teamId: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException('Družstvo neexistuje');
    if (!team.sportnetProgramUrl || !team.sportnetTeamName) {
      throw new BadRequestException('Najprv nastavte odkaz na program a názov tímu na sportnete.');
    }
    const season = await this.prisma.season.findFirst({ where: { isActive: true } });
    if (!season) throw new BadRequestException('Neexistuje aktívna sezóna');

    const response = await fetch(team.sportnetProgramUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (fkknv.sk portal)' },
    });
    if (!response.ok) {
      throw new BadRequestException(`Stránku sa nepodarilo načítať (HTTP ${response.status}).`);
    }
    const html = await response.text();
    const fixtures = parseSportnetProgram(html);
    const ourName = team.sportnetTeamName.trim().toLowerCase();

    let created = 0;
    let updated = 0;
    let ours = 0;
    const keptIds: string[] = []; // externalId zápasov nášho tímu videných v tomto importe
    const wallTimes: Date[] = []; // nástenné časy všetkých zápasov v tomto okne (na rozsah)
    for (const f of fixtures) {
      const startAt = toBratislavaWallClock(f.startAt);
      wallTimes.push(startAt);
      const homeIsUs = f.home.toLowerCase() === ourName;
      const awayIsUs = f.away.toLowerCase() === ourName;
      if (!homeIsUs && !awayIsUs) continue;
      ours++;

      const opponent = homeIsUs ? f.away : f.home;
      const opponentLogo = (homeIsUs ? f.awayLogo : f.homeLogo) ?? null;
      // doplň klub do registra (aj s logom)
      await this.clubs.create({ name: opponent, logoUrl: opponentLogo });

      const title = homeIsUs ? `${team.name} vs ${opponent}` : `${opponent} vs ${team.name}`;
      const externalId = sportnetMatchKey(f);
      keptIds.push(externalId);
      const matchUrl = f.appSpace ? `https://sportnet.sme.sk/futbalnet/z/${f.appSpace}/zapas/${f.id}/` : null;

      const existing = await this.prisma.event.findUnique({
        where: { futbalnetId: externalId },
        include: { match: true },
      });
      // futbalnetId majú len importované zápasy; ručný/priateľský zápas sa nikdy neprepisuje
      if (existing && (existing.source !== 'FUTBALNET' || existing.match?.isFriendly)) continue;
      if (existing) {
        await this.prisma.event.update({
          where: { id: existing.id },
          data: { startAt, title, teamId: team.id },
        });
        if (existing.match) {
          await this.prisma.match.update({
            where: { id: existing.match.id },
            data: { opponent, isHome: homeIsUs, opponentLogo, sportnetUrl: matchUrl },
          });
        }
        updated++;
      } else {
        await this.prisma.event.create({
          data: {
            type: 'MATCH',
            seasonId: season.id,
            teamId: team.id,
            title,
            startAt,
            source: 'FUTBALNET',
            futbalnetId: externalId,
            match: { create: { opponent, isHome: homeIsUs, opponentLogo, sportnetUrl: matchUrl } },
          },
        });
        created++;
      }
    }

    // Zosúladenie: v rámci okna, ktoré program zobrazuje (rozsah dní videných
    // zápasov), zmaž staré importované zápasy tohto družstva, ktoré už na
    // sportnete nie sú (napr. duplikáty po preložení termínu). Mimo okna sa
    // nemaže (program ukazuje len najbližšie kolá) a ručné zápasy tiež nie.
    let removed = 0;
    if (ours > 0 && wallTimes.length > 0) {
      const times = wallTimes.map((d) => d.getTime());
      const min = new Date(Math.min(...times));
      const max = new Date(Math.max(...times));
      const from = new Date(Date.UTC(min.getUTCFullYear(), min.getUTCMonth(), min.getUTCDate(), 0, 0, 0));
      const to = new Date(Date.UTC(max.getUTCFullYear(), max.getUTCMonth(), max.getUTCDate(), 23, 59, 59, 999));
      const res = await this.prisma.event.deleteMany({
        where: {
          teamId: team.id,
          source: 'FUTBALNET',
          startAt: { gte: from, lte: to },
          futbalnetId: { notIn: keptIds },
          // poistky: nikdy nie zápas turnaja ani priateľský zápas
          parentEventId: null,
          NOT: { match: { isFriendly: true } },
        },
      });
      removed = res.count;
    }
    return { total: fixtures.length, ours, created, updated, removed };
  }

  /** Uloží konfiguráciu sync-u pre kategóriu (URL súťaže + názov nášho tímu). */
  async configure(categoryCode: string, url: string | null, teamName: string | null) {
    const category = await this.prisma.teamCategory.findUnique({ where: { code: categoryCode } });
    if (!category) throw new NotFoundException(`Kategória ${categoryCode} neexistuje`);
    return this.prisma.teamCategory.update({
      where: { id: category.id },
      data: { futbalnetCompetitionUrl: url, futbalnetTeamName: teamName },
    });
  }

  /**
   * Týždenný auto-import rozpisu zo sportnetu pre všetky nakonfigurované družstvá
   * (pondelok 4:00). Program ukazuje najbližšie kolá; opakovaným importom sa
   * postupne doplní celá sezóna, ako sa kolá blížia.
   */
  @Cron('0 4 * * 1')
  async importAllTeams() {
    const teams = await this.prisma.team.findMany({
      where: { sportnetProgramUrl: { not: null }, sportnetTeamName: { not: null } },
    });
    const results: Record<string, unknown> = {};
    for (const team of teams) {
      try {
        results[team.name] = await this.importTeamProgram(team.id);
      } catch (error) {
        results[team.name] = { error: error instanceof Error ? error.message : String(error) };
        this.logger.warn(`Sportnet import ${team.name} zlyhal: ${error}`);
      }
    }
    this.logger.log(`Sportnet auto-import: ${JSON.stringify(results)}`);
    return results;
  }

  /** Nastaví verejnú sportnet.sme.sk URL súťaže pre kategóriu (embed programu/tabuľky). */
  async setSportnetUrl(categoryCode: string, url: string | null) {
    const category = await this.prisma.teamCategory.findUnique({ where: { code: categoryCode } });
    if (!category) throw new NotFoundException(`Kategória ${categoryCode} neexistuje`);
    const clean = url?.trim().replace(/\/+$/, '') || null;
    return this.prisma.teamCategory.update({ where: { id: category.id }, data: { sportnetUrl: clean } });
  }

  /** Nastaví sportnet.sme.sk URL súťaže pre konkrétne družstvo (Tabuľka — A/B môžu mať vlastnú). */
  async setTeamSportnetUrl(teamId: string, url: string | null) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException('Družstvo neexistuje');
    const clean = url?.trim().replace(/\/+$/, '') || null;
    return this.prisma.team.update({ where: { id: teamId }, data: { sportnetUrl: clean } });
  }

  /** Týždenný sync všetkých nakonfigurovaných kategórií (pondelok 5:00). */
  @Cron('0 5 * * 1')
  async syncAll() {
    const categories = await this.prisma.teamCategory.findMany({
      where: { futbalnetCompetitionUrl: { not: null } },
    });
    const results: Record<string, unknown> = {};
    for (const category of categories) {
      try {
        results[category.code] = await this.syncCategory(category.code);
      } catch (error) {
        results[category.code] = { error: error instanceof Error ? error.message : String(error) };
        this.logger.warn(`Futbalnet sync ${category.code} zlyhal: ${error}`);
      }
    }
    this.logger.log(`Futbalnet sync: ${JSON.stringify(results)}`);
    return results;
  }

  /** Stiahne stránku súťaže z futbalnetu a naimportuje zápasy kategórie. */
  async syncCategory(categoryCode: string) {
    const category = await this.prisma.teamCategory.findUnique({ where: { code: categoryCode } });
    if (!category) throw new NotFoundException(`Kategória ${categoryCode} neexistuje`);
    if (!category.futbalnetCompetitionUrl || !category.futbalnetTeamName) {
      throw new BadRequestException(
        `Kategória ${categoryCode} nemá nastavenú futbalnet URL a názov tímu (POST /futbalnet/config/${categoryCode})`,
      );
    }

    const response = await fetch(category.futbalnetCompetitionUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (fkknv.sk portal)' },
    });
    if (!response.ok) {
      throw new BadRequestException(`Futbalnet vrátil ${response.status} pre ${category.futbalnetCompetitionUrl}`);
    }
    const html = await response.text();
    const matches = parseMatchesFromHtml(html);
    return this.importMatches(categoryCode, matches);
  }

  /**
   * Idempotentný import zápasov (z fetchu alebo manuálne poslaného JSON-u).
   * Vyberie len zápasy nášho tímu, existujúce (podľa futbalnetId) aktualizuje —
   * zmena termínu na futbalnete sa premietne do kalendára. Interné zápasy
   * vytvorené trénerom sa nikdy nemenia.
   */
  async importMatches(categoryCode: string, matches: NormalizedMatch[]) {
    const category = await this.prisma.teamCategory.findUnique({ where: { code: categoryCode } });
    if (!category) throw new NotFoundException(`Kategória ${categoryCode} neexistuje`);
    const teamName = category.futbalnetTeamName;
    if (!teamName) {
      throw new BadRequestException(`Kategória ${categoryCode} nemá nastavený futbalnetTeamName`);
    }
    const season = await this.prisma.season.findFirst({ where: { isActive: true } });
    if (!season) throw new BadRequestException('Neexistuje aktívna sezóna');

    // futbalnet zápasy patria predvolenému družstvu kategórie
    const defaultTeam = await this.prisma.team.findFirst({
      where: { teamCategoryId: category.id },
      orderBy: { sortOrder: 'asc' },
    });
    if (!defaultTeam) {
      throw new BadRequestException(`Kategória ${categoryCode} nemá žiadne družstvo`);
    }

    const normalizedTeam = teamName.trim().toLowerCase();
    const ours: OurMatch[] = [];
    for (const match of matches) {
      const isHome = match.homeTeam.trim().toLowerCase() === normalizedTeam;
      const isAway = match.awayTeam.trim().toLowerCase() === normalizedTeam;
      if (!isHome && !isAway) continue;
      ours.push({ ...match, isHome, opponent: isHome ? match.awayTeam : match.homeTeam });
    }

    let created = 0;
    let updated = 0;
    for (const match of ours) {
      const futbalnetId = `${categoryCode}:${match.externalId}`;
      const title = match.isHome ? `${teamName} vs ${match.opponent}` : `${match.opponent} vs ${teamName}`;
      // sportnet/futbalnet dávajú absolútny čas → ulož ako bratislavský nástenný čas
      const startAt = toBratislavaWallClock(match.startAt);
      const existing = await this.prisma.event.findUnique({ where: { futbalnetId }, include: { match: true } });
      // ručný/priateľský zápas sa nikdy neprepisuje
      if (existing && (existing.source !== 'FUTBALNET' || existing.match?.isFriendly)) continue;
      if (existing) {
        await this.prisma.event.update({
          where: { id: existing.id },
          data: { startAt, location: match.location, title },
        });
        updated++;
      } else {
        await this.prisma.event.create({
          data: {
            type: 'MATCH',
            seasonId: season.id,
            teamId: defaultTeam.id,
            title,
            startAt,
            location: match.location,
            source: 'FUTBALNET',
            futbalnetId,
            match: {
              create: { opponent: match.opponent, isHome: match.isHome, competition: match.competition },
            },
          },
        });
        created++;
      }
    }
    return { parsed: matches.length, ourMatches: ours.length, created, updated };
  }
}
