import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { formatEventDateTimeSk, type MatchEventInput, type MatchTimerAction } from '@fkknv/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../notifications/push.service';
import { EmailService } from '../notifications/email.service';
import { coachBlockedFromTeam, coachTeamIds, isStaff } from '../auth/scope';
import { VeoService } from '../veo/veo.service';
import type { AuthUser } from '../auth/current-user.decorator';
import { applyTimerAction } from './match-timer';

/** Kategórie, kde hráč potvrdzuje účasť na zápase. */
const CONFIRM_CATEGORIES = ['U17', 'U19', 'MUZI'];

const NOMINATION_STATUS_SK: Record<string, string> = {
  NOMINATED: 'nominovaný',
  CONFIRMED: 'potvrdil účasť',
  DECLINED: 'odmietol',
};

@Injectable()
export class MatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: PushService,
    private readonly email: EmailService,
    private readonly veo: VeoService,
  ) {}

  /** Tréner smie spravovať zápas len svojho družstva (používa aj MatchVideosService). */
  async assertMatchTeam(matchId: string, user: AuthUser) {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { event: { select: { teamId: true } } },
    });
    if (!match) throw new NotFoundException('Zápas neexistuje');
    if (coachBlockedFromTeam(user, match.event.teamId)) {
      throw new ForbiddenException('Zápas a nomináciu môžete spravovať len pre svoje družstvo');
    }
  }

  async get(id: string, user?: AuthUser) {
    const match = await this.prisma.match.findUnique({
      where: { id },
      include: {
        // parent = turnaj, ku ktorému zápas patrí (zápas turnaja); parentEventId/tournamentOrder sú v event
        event: { include: { team: { include: { teamCategory: true } }, parent: { select: { id: true, title: true } } } },
        nominations: {
          where: { status: { not: 'REMOVED' } },
          include: { member: { select: { id: true, firstName: true, lastName: true } } },
        },
        events: {
          include: {
            member: { select: { id: true, firstName: true, lastName: true } },
            relatedMember: { select: { id: true, firstName: true, lastName: true } },
          },
          orderBy: [{ minute: 'asc' }, { createdAt: 'asc' }],
        },
        syncLogs: { orderBy: { createdAt: 'desc' }, take: 10 },
        photos: { select: { id: true, mimeType: true, size: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
        videos: {
          select: { id: true, mimeType: true, size: true, filename: true, title: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!match) throw new NotFoundException('Zápas neexistuje');
    // demo izolácia: demo konto vidí len demo zápasy a naopak
    if (user && match.event.isDemo !== !!user.isDemo) throw new NotFoundException('Zápas neexistuje');
    // serverNow: klient si podľa neho zarovná hodiny pre výpočet časomiery
    return { ...match, serverNow: new Date().toISOString() };
  }

  /** Odohrané (ukončené) zápasy — archív s videom a fotkami, od najnovšieho. */
  async playedMatches(user: AuthUser, opts: { mine?: boolean; limit?: number } = {}) {
    // „moje" (prehľad): vedenie všetko; ostatní len družstvá, kde sú tréner/hráč/rodič
    let teamFilter: { teamId: { in: string[] } } | undefined;
    if (opts.mine && !isStaff(user)) {
      const ids = new Set<string>(coachTeamIds(user));
      const memberIds = await this.myMemberIds(user.id);
      if (memberIds.length) {
        const rows = await this.prisma.teamMembership.findMany({
          where: { memberId: { in: memberIds }, leftAt: null, season: { isActive: true } },
          select: { teamId: true },
        });
        for (const r of rows) ids.add(r.teamId);
      }
      teamFilter = { teamId: { in: [...ids] } };
    }
    return this.prisma.match.findMany({
      where: { state: 'FINISHED', event: { isDemo: !!user.isDemo, ...teamFilter } },
      select: {
        id: true,
        opponent: true,
        opponentLogo: true,
        isFriendly: true,
        isHome: true,
        scoreUs: true,
        scoreThem: true,
        jerseyColor: true,
        videoUrl: true,
        highlightsUrl: true,
        event: {
          select: {
            title: true,
            startAt: true,
            location: true,
            address: true,
            team: { select: { name: true } },
            parentEventId: true,
            tournamentOrder: true,
            parent: { select: { id: true, title: true } },
          },
        },
        photos: { select: { id: true }, orderBy: { createdAt: 'asc' } },
        videos: { select: { id: true, mimeType: true, title: true }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { event: { startAt: 'desc' } },
      take: opts.limit ?? 200,
    });
  }

  /** Doteraz zadaní súperi (bez duplicít) pre našepkávač pri tvorbe zápasu. */
  async opponents(): Promise<string[]> {
    const rows = await this.prisma.match.findMany({
      distinct: ['opponent'],
      select: { opponent: true },
      orderBy: { opponent: 'asc' },
    });
    return rows.map((r) => r.opponent).filter((o) => !!o && o !== 'Neznámy súper');
  }

  /** Pridanie hráča do nominácie (aj tesne pred zápasom). Notifikuje hráča a rodičov. */
  async nominate(matchId: string, memberId: string, user: AuthUser) {
    await this.assertMatchTeam(matchId, user);
    const nomination = await this.prisma.matchNomination.upsert({
      where: { matchId_memberId: { matchId, memberId } },
      create: { matchId, memberId },
      update: { status: 'NOMINATED' },
    });

    const [match, member] = await Promise.all([
      this.prisma.match.findUnique({ where: { id: matchId }, include: { event: true } }),
      this.prisma.member.findUnique({
        where: { id: memberId },
        include: { guardians: { select: { userId: true } } },
      }),
    ]);
    if (match && member) {
      const recipients = [...member.guardians.map((g) => g.userId)];
      if (member.userId) recipients.push(member.userId);
      const when = match.event.startAt.toLocaleString('sk-SK', {
        day: 'numeric',
        month: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Bratislava',
      });
      await this.pushService.notifyUsers(recipients, {
        title: 'Nominácia na zápas',
        body: `${member.firstName} ${member.lastName} je v nominácii: ${match.event.title}, ${when}${match.event.location ? `, ${match.event.location}` : ''}`,
        data: { type: 'nomination', matchId },
      });
    }
    return nomination;
  }

  /**
   * Rozpošle e-mailom oznam o nominácii hráčom / rodičom nominovaných hráčov.
   * Vráti počet oslovených adries a zoznam nominovaných hráčov, ktorí nemajú
   * konto s e-mailom ani priradeného rodiča s e-mailom (nedostanú oznam).
   */
  async emailNomination(matchId: string, user: AuthUser) {
    await this.assertMatchTeam(matchId, user);
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        event: { include: { team: { include: { teamCategory: true } } } },
        nominations: {
          where: { status: { not: 'REMOVED' } },
          include: {
            member: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                user: { select: { email: true } },
                guardians: { select: { user: { select: { email: true } } } },
              },
            },
          },
        },
      },
    });
    if (!match) throw new NotFoundException('Zápas neexistuje');
    const ev = match.event;
    const teamName = ev.team?.name ?? 'FK KNV';
    const vs = match.isHome ? `${teamName} – ${match.opponent}` : `${match.opponent} – ${teamName}`;
    const when = formatEventDateTimeSk(ev.startAt);
    const category = ev.team?.teamCategory.code ?? null;
    const needsConfirm = category ? CONFIRM_CATEGORIES.includes(category) : false;

    // unikátne e-maily príjemcov + hráči bez akéhokoľvek e-mailu
    const emails = new Set<string>();
    const missing: Array<{ id: string; name: string }> = [];
    for (const nom of match.nominations) {
      const m = nom.member;
      const own = m.user?.email ? [m.user.email] : [];
      const guardianEmails = m.guardians.map((g) => g.user.email).filter((e): e is string => !!e);
      const all = [...own, ...guardianEmails];
      if (all.length === 0) missing.push({ id: m.id, name: `${m.lastName} ${m.firstName}` });
      else for (const e of all) emails.add(e.trim().toLowerCase());
    }

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#16223c">
        <h2 style="color:#1a2848">Nominácia na zápas</h2>
        <p>Váš hráč je v nominácii na najbližší zápas:</p>
        <table style="margin:10px 0;font-size:15px">
          <tr><td style="color:#6b7280;padding:2px 8px 2px 0">Zápas:</td><td><strong>${vs}</strong></td></tr>
          <tr><td style="color:#6b7280;padding:2px 8px 2px 0">Kedy:</td><td><strong>${when}</strong></td></tr>
          ${ev.location ? `<tr><td style="color:#6b7280;padding:2px 8px 2px 0">Kde:</td><td>${ev.location}</td></tr>` : ''}
        </table>
        ${
          needsConfirm
            ? `<p>Prosíme o <strong>potvrdenie účasti</strong> v aplikácii / portáli (Prehľad → nominácie).</p>`
            : ''
        }
        <p><a href="https://fkknv.sk/prihlasenie" style="display:inline-block;background:#2b4278;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Otvoriť portál</a></p>
      </div>`;
    const subject = `Nominácia na zápas — ${vs}`;
    let sent = 0;
    for (const to of emails) {
      const res = await this.email.send([to], subject, html);
      if (res.sent) sent++;
    }

    // kompletná nominácia na e-mail trénera, ktorý oznam rozposlal
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const players = [...match.nominations]
      .sort((x, y) => x.member.lastName.localeCompare(y.member.lastName, 'sk'))
      .map((n, i) => `<tr><td style="padding:2px 10px 2px 0;color:#6b7280">${i + 1}.</td><td>${esc(`${n.member.lastName} ${n.member.firstName}`)}</td><td style="padding-left:12px;color:#6b7280">${NOMINATION_STATUS_SK[n.status] ?? ''}</td></tr>`)
      .join('');
    const coachHtml = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#16223c">
        <h2 style="color:#1a2848">Nominácia na zápas — kópia pre trénera</h2>
        <table style="margin:10px 0;font-size:15px">
          <tr><td style="color:#6b7280;padding:2px 8px 2px 0">Zápas:</td><td><strong>${esc(vs)}</strong></td></tr>
          <tr><td style="color:#6b7280;padding:2px 8px 2px 0">Kedy:</td><td><strong>${esc(when)}</strong></td></tr>
          ${ev.location ? `<tr><td style="color:#6b7280;padding:2px 8px 2px 0">Kde:</td><td>${esc(ev.location)}</td></tr>` : ''}
        </table>
        <p><strong>Nominovaní hráči (${match.nominations.length}):</strong></p>
        <table style="font-size:15px">${players || '<tr><td>Žiadni hráči</td></tr>'}</table>
        ${
          missing.length > 0
            ? `<p style="margin-top:14px"><strong style="color:#b45309">Bez e-mailu (oznam nedostali):</strong> ${esc(missing.map((m) => m.name).join(', '))}</p>`
            : ''
        }
        <p style="color:#6b7280;font-size:13px">Oznam bol odoslaný na ${emails.size} e-mailových adries hráčov a rodičov.</p>
      </div>`;
    const coachRes = await this.email.send([user.email], `Nominácia (kópia) — ${vs}`, coachHtml);
    return { recipients: emails.size, sent, missing, needsConfirm, coachCopySent: coachRes.sent };
  }

  /**
   * Zápasy, na ktoré je prihlásený používateľ (alebo jeho deti) nominovaný —
   * na zvýraznenie „nominovaný" v kalendári a na dashboarde.
   */
  async myNominatedMatches(userId: string) {
    const memberIds = await this.myMemberIds(userId);
    if (memberIds.length === 0) return [];
    const noms = await this.prisma.matchNomination.findMany({
      where: { memberId: { in: memberIds }, status: { not: 'REMOVED' } },
      select: {
        matchId: true,
        status: true,
        member: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return noms.map((n) => ({
      matchId: n.matchId,
      status: n.status,
      member: n.member,
    }));
  }

  /** Členovia, ku ktorým má používateľ prístup (vlastný člen + deti). */
  private async myMemberIds(userId: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { member: { select: { id: true } }, guardianOf: { select: { memberId: true } } },
    });
    const ids = new Set<string>();
    if (user?.member) ids.add(user.member.id);
    for (const g of user?.guardianOf ?? []) ids.add(g.memberId);
    return [...ids];
  }

  /**
   * Nominácie prihláseného hráča (a jeho detí) na nadchádzajúce zápasy v
   * kategóriách U17/U19/MUŽI, ktoré treba potvrdiť. Vráti aj už potvrdené/odmietnuté.
   */
  async myNominations(userId: string) {
    const memberIds = await this.myMemberIds(userId);
    if (memberIds.length === 0) return [];
    const noms = await this.prisma.matchNomination.findMany({
      where: {
        memberId: { in: memberIds },
        status: { not: 'REMOVED' },
        match: {
          event: {
            startAt: { gte: new Date() },
            team: { teamCategory: { code: { in: CONFIRM_CATEGORIES } } },
          },
        },
      },
      include: {
        member: { select: { id: true, firstName: true, lastName: true } },
        match: { include: { event: { include: { team: { include: { teamCategory: true } } } } } },
      },
      orderBy: { match: { event: { startAt: 'asc' } } },
    });
    return noms.map((n) => ({
      id: n.id,
      status: n.status,
      member: n.member,
      matchId: n.matchId,
      title: n.match.event.title,
      opponent: n.match.opponent,
      isHome: n.match.isHome,
      startAt: n.match.event.startAt,
      location: n.match.event.location,
      team: n.match.event.team?.name ?? null,
      category: n.match.event.team?.teamCategory.code ?? null,
    }));
  }

  /** Hráč (alebo rodič) potvrdí/odmietne vlastnú nomináciu. */
  async respondNomination(nominationId: string, userId: string, status: 'CONFIRMED' | 'DECLINED') {
    const nom = await this.prisma.matchNomination.findUnique({ where: { id: nominationId } });
    if (!nom) throw new NotFoundException('Nominácia neexistuje');
    if (nom.status === 'REMOVED') throw new BadRequestException('Nominácia bola zrušená');
    const memberIds = await this.myMemberIds(userId);
    if (!memberIds.includes(nom.memberId)) {
      throw new ForbiddenException('Môžete potvrdiť len vlastnú nomináciu');
    }
    return this.prisma.matchNomination.update({ where: { id: nominationId }, data: { status } });
  }

  /** Odobratie hráča z nominácie — záznam ostáva pre históriu so statusom REMOVED. */
  async removeNomination(matchId: string, memberId: string, user: AuthUser) {
    await this.assertMatchTeam(matchId, user);
    return this.prisma.matchNomination.update({
      where: { matchId_memberId: { matchId, memberId } },
      data: { status: 'REMOVED' },
    });
  }

  async setState(matchId: string, state: 'PLANNED' | 'LIVE' | 'FINISHED' | 'CANCELLED', user: AuthUser) {
    await this.assertMatchTeam(matchId, user);
    // Skóre sa neprepočítava pri ukončení — môže byť zadané ručne (setScore)
    // aj bez zápisu jednotlivých gólov. Pri živom zápise sa skóre dopĺňa
    // priebežne pri každom góle (addMatchEvent → recomputeScore).
    const data: Prisma.MatchUpdateInput = { state };
    if (state === 'FINISHED') {
      // ukončenie zápasu zastaví aj bežiacu časomieru
      const cur = await this.prisma.match.findUnique({ where: { id: matchId } });
      if (cur && cur.timerPhase !== 'NOT_STARTED' && cur.timerPhase !== 'FINISHED') {
        const r = applyTimerAction(cur, 'END_SECOND', new Date());
        if (r.ok) Object.assign(data, r.next);
      }
    }
    return this.prisma.match.update({ where: { id: matchId }, data });
  }

  /**
   * Časomiera zápasu: výkop, prestávka, 2. polčas, koniec (+ späť / vynulovať).
   * Výkop prepne plánovaný zápas do stavu LIVE, koniec ho ukončí (FINISHED).
   */
  async timerAction(matchId: string, action: MatchTimerAction, user: AuthUser) {
    await this.assertMatchTeam(matchId, user);
    const cur = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!cur) throw new NotFoundException('Zápas neexistuje');
    if (cur.state === 'CANCELLED') throw new BadRequestException('Zápas je zrušený');
    const r = applyTimerAction(cur, action, new Date());
    if (!r.ok) throw new BadRequestException(r.error);
    const data: Prisma.MatchUpdateInput = { ...r.next };
    if (action === 'START_FIRST' && cur.state === 'PLANNED') data.state = 'LIVE';
    if (action === 'END_SECOND') data.state = 'FINISHED';
    if (action === 'UNDO' && cur.timerPhase === 'FINISHED' && cur.state === 'FINISHED') data.state = 'LIVE';
    return this.prisma.match.update({
      where: { id: matchId },
      data,
      select: {
        id: true,
        state: true,
        halfLengthMin: true,
        timerPhase: true,
        firstHalfStartedAt: true,
        firstHalfEndedAt: true,
        secondHalfStartedAt: true,
        secondHalfEndedAt: true,
      },
    });
  }

  /** Ručné nastavenie výsledku (napr. bez zápisu jednotlivých gólov). */
  async setScore(matchId: string, scoreUs: number, scoreThem: number, user: AuthUser) {
    await this.assertMatchTeam(matchId, user);
    const clamp = (n: number) => Math.max(0, Math.min(Math.trunc(Number(n) || 0), 99));
    return this.prisma.match.update({
      where: { id: matchId },
      data: { scoreUs: clamp(scoreUs), scoreThem: clamp(scoreThem) },
    });
  }

  /**
   * Nastaví čas zrazu (stretnutia) a/alebo poznámky k zápasu — tréner družstva
   * alebo vedenie. `meetAt`/`notes` null vymaže hodnotu (pri čase sa vráti k
   * predvolenému — hodina pred začiatkom).
   */
  async setDetails(
    matchId: string,
    input: {
      meetAt?: string | null;
      notes?: string | null;
      jerseyColor?: 'DARK' | 'LIGHT' | null;
      halfLengthMin?: number | null;
    },
    user: AuthUser,
  ) {
    await this.assertMatchTeam(matchId, user);
    const data: {
      meetAt?: Date | null;
      notes?: string | null;
      jerseyColor?: 'DARK' | 'LIGHT' | null;
      halfLengthMin?: number;
    } = {};
    if (input.meetAt !== undefined) data.meetAt = input.meetAt ? new Date(input.meetAt) : null;
    if (input.notes !== undefined) data.notes = input.notes?.trim() ? input.notes.trim() : null;
    if (input.jerseyColor !== undefined) data.jerseyColor = input.jerseyColor ?? null;
    if (input.halfLengthMin !== undefined) {
      const n = input.halfLengthMin == null ? 45 : Math.trunc(Number(input.halfLengthMin));
      if (!Number.isFinite(n) || n < 1 || n > 60) throw new BadRequestException('Dĺžka polčasu musí byť 1–60 minút');
      data.halfLengthMin = n;
    }
    return this.prisma.match.update({ where: { id: matchId }, data });
  }

  /** Nastaví/odstráni odkaz na video zo zápasu (napr. Veo). */
  async setVideo(matchId: string, url: string | null, user: AuthUser) {
    await this.assertMatchTeam(matchId, user);
    const clean = url?.trim() || null;
    if (clean && !/^https?:\/\//i.test(clean)) {
      throw new BadRequestException('Odkaz na video musí začínať http(s)://');
    }
    return this.prisma.match.update({ where: { id: matchId }, data: { videoUrl: clean } });
  }

  /** Nastaví/odstráni odkaz na highlighty zo zápasu. */
  async setHighlights(matchId: string, url: string | null, user: AuthUser) {
    await this.assertMatchTeam(matchId, user);
    const clean = url?.trim() || null;
    if (clean && !/^https?:\/\//i.test(clean)) {
      throw new BadRequestException('Odkaz na highlighty musí začínať http(s)://');
    }
    return this.prisma.match.update({ where: { id: matchId }, data: { highlightsUrl: clean } });
  }

  /**
   * Automaticky nájde kandidátov na Veo video podľa dátumu zápasu a názvov
   * tímov (náš klub, súper, kategória). Nič neukladá — vráti zoznam na výber.
   */
  async findVideoCandidates(matchId: string, user: AuthUser) {
    await this.assertMatchTeam(matchId, user);
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: { event: { include: { team: { include: { teamCategory: true } } } } },
    });
    if (!match) throw new NotFoundException('Zápas neexistuje');
    const terms = [
      'FK Košická Nová Ves',
      match.opponent,
      match.event.team?.name ?? '',
      match.event.team?.teamCategory?.code ?? '',
    ].filter(Boolean);
    const candidates = await this.veo.findCandidates(match.event.startAt, terms);
    return { candidates };
  }

  /** Nahrá fotku zo zápasu (obrázok, max 15 MB). */
  async addPhoto(
    matchId: string,
    file: { buffer: Buffer; mimetype: string; size: number },
    user: AuthUser,
  ) {
    await this.assertMatchTeam(matchId, user);
    if (!file?.buffer) throw new BadRequestException('Chýba súbor');
    if (!file.mimetype?.startsWith('image/')) throw new BadRequestException('Nahrať možno len obrázok');
    const count = await this.prisma.matchPhoto.count({ where: { matchId } });
    if (count >= 60) throw new BadRequestException('Dosiahnutý limit 60 fotiek na zápas');
    const photo = await this.prisma.matchPhoto.create({
      data: {
        matchId,
        mimeType: file.mimetype,
        size: file.size,
        data: file.buffer,
        uploadedById: user.id,
      },
      select: { id: true, mimeType: true, size: true, createdAt: true },
    });
    return photo;
  }

  /** Servírovanie fotky (neuhádnuteľné ID). */
  async getPhoto(photoId: string) {
    return this.prisma.matchPhoto.findUnique({
      where: { id: photoId },
      select: { mimeType: true, data: true },
    });
  }

  async deletePhoto(matchId: string, photoId: string, user: AuthUser) {
    await this.assertMatchTeam(matchId, user);
    const photo = await this.prisma.matchPhoto.findUnique({ where: { id: photoId } });
    if (!photo || photo.matchId !== matchId) throw new NotFoundException('Fotka neexistuje');
    await this.prisma.matchPhoto.delete({ where: { id: photoId } });
    return { deleted: true };
  }

  /**
   * Živý zápis udalosti (gól, striedanie, karta...) s minutážou.
   * clientId zaručuje idempotenciu pri offline synchronizácii —
   * opakované odoslanie tej istej udalosti nevytvorí duplikát.
   */
  async addMatchEvent(matchId: string, input: MatchEventInput, user: AuthUser) {
    await this.assertMatchTeam(matchId, user);
    const createdById = user.id;
    const match = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException('Zápas neexistuje');
    if (match.state === 'CANCELLED') throw new BadRequestException('Zápas je zrušený');

    const existing = await this.prisma.matchEvent.findUnique({ where: { clientId: input.clientId } });
    if (existing) return existing;

    const event = await this.prisma.matchEvent.create({
      data: {
        clientId: input.clientId,
        matchId,
        minute: input.minute,
        stoppage: input.stoppage,
        type: input.type,
        memberId: input.memberId,
        relatedMemberId: input.relatedMemberId,
        note: input.note,
        createdById,
      },
    });

    if (['GOAL', 'PENALTY_SCORED', 'GOAL_CONCEDED'].includes(input.type)) {
      await this.recomputeScore(matchId);
    }
    return event;
  }

  async deleteMatchEvent(matchId: string, matchEventId: string, user: AuthUser) {
    await this.assertMatchTeam(matchId, user);
    const event = await this.prisma.matchEvent.findUnique({ where: { id: matchEventId } });
    if (!event || event.matchId !== matchId) throw new NotFoundException('Udalosť neexistuje');
    await this.prisma.matchEvent.delete({ where: { id: matchEventId } });
    await this.recomputeScore(matchId);
    return { deleted: true };
  }

  /** Skóre sa vždy dopočítava z append-only logu (gól + premenená penalta). */
  private async recomputeScore(matchId: string) {
    const [scoreUs, scoreThem] = await Promise.all([
      this.prisma.matchEvent.count({ where: { matchId, type: { in: ['GOAL', 'PENALTY_SCORED'] } } }),
      this.prisma.matchEvent.count({ where: { matchId, type: 'GOAL_CONCEDED' } }),
    ]);
    await this.prisma.match.update({ where: { id: matchId }, data: { scoreUs, scoreThem } });
  }

  /** Štatistiky hráčov: góly a asistencie. Filter podľa kategórie alebo družstva. */
  async playerStats(filter: { categoryCode?: string; teamId?: string; isDemo?: boolean }) {
    const matchWhere = {
      event: {
        isDemo: filter.isDemo ?? false,
        team: {
          id: filter.teamId ? filter.teamId : undefined,
          teamCategory: filter.categoryCode ? { code: filter.categoryCode } : undefined,
        },
      },
    };
    const [goals, assists] = await Promise.all([
      this.prisma.matchEvent.groupBy({
        by: ['memberId'],
        where: { type: { in: ['GOAL', 'PENALTY_SCORED'] }, memberId: { not: null }, match: matchWhere },
        _count: { _all: true },
      }),
      this.prisma.matchEvent.groupBy({
        by: ['memberId'],
        where: { type: 'ASSIST', memberId: { not: null }, match: matchWhere },
        _count: { _all: true },
      }),
    ]);

    const ids = [...new Set([...goals, ...assists].map((g) => g.memberId!).filter(Boolean))];
    const members = await this.prisma.member.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true },
    });
    const nameById = new Map(members.map((m) => [m.id, `${m.lastName} ${m.firstName}`]));
    const assistById = new Map(assists.map((a) => [a.memberId, a._count._all]));
    const goalById = new Map(goals.map((g) => [g.memberId, g._count._all]));

    return ids
      .map((id) => ({
        memberId: id,
        name: nameById.get(id) ?? '?',
        goals: goalById.get(id) ?? 0,
        assists: assistById.get(id) ?? 0,
      }))
      .sort((a, b) => b.goals - a.goals || b.assists - a.assists);
  }
}
