import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { parseRodneCislo, type RegistrationInfoInput, type RegistrationRequestInput } from '@fkknv/shared';
import { EmailService } from '../notifications/email.service';
import { PushService } from '../notifications/push.service';
import { buildInfoRequestEmail } from './info-request-email';
import { buildNewRegistrationEmail } from './registration-notify-email';
import { PrismaService } from '../prisma/prisma.service';
import { SeasonsService } from '../seasons/seasons.service';
import { AccountsService } from '../auth/accounts.service';

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly email: EmailService,
    private readonly push: PushService,
    private readonly prisma: PrismaService,
    private readonly seasonsService: SeasonsService,
    private readonly accounts: AccountsService,
  ) {}

  /**
   * Prijme prihlášku. Podľa typu vytvorí:
   *  - ADULT: jednu prihlášku dospelého hráča,
   *  - CHILD: jednu prihlášku na každé registrované dieťa (spoločné údaje rodiča),
   *  - PARENT: jednu prihlášku rodiča bez dieťaťa (deti sú už členmi klubu).
   */
  async submit(input: RegistrationRequestInput) {
    const parent = input.parent
      ? {
          parentFirstName: input.parent.firstName,
          parentLastName: input.parent.lastName,
          parentEmail: input.parent.email.toLowerCase(),
          parentPhone: input.parent.phone,
          parentRelation: input.parent.relation,
        }
      : {};

    type RegPlayer = NonNullable<RegistrationRequestInput['children']>[number];
    const playerData = (p: RegPlayer | undefined) => {
      if (!p) throw new BadRequestException('Chýbajú údaje hráča');
      const rc = parseRodneCislo(p.birthNumber);
      if (!rc) throw new BadRequestException('Neplatné rodné číslo');
      return {
        childFirstName: p.firstName,
        childLastName: p.lastName,
        childBirthDate: rc.birthDate,
        birthNumber: p.birthNumber.replace(/\s/g, ''),
        sex: rc.sex,
        playerRegistrationNumber: p.registrationNumber,
        originCountry: p.originCountry,
        addressStreet: p.address.street,
        addressHouseNumber: p.address.houseNumber,
        addressZip: p.address.zip,
        addressCity: p.address.city,
        photoDataUrl: p.photoBase64,
        healthNotes: p.healthNotes,
        playerEmail: p.email?.toLowerCase(),
      };
    };

    const common = {
      applicantType: input.applicantType,
      consentGdpr: input.consents.gdpr,
      consentPhotos: input.consents.photos,
      note: input.note,
      ...parent,
    };

    const parentName = input.parent ? `${input.parent.firstName} ${input.parent.lastName}`.trim() : null;
    const summary = (players: Array<{ name: string; birthDate: string | null }>, extra: { playerEmail?: string | null; parentChildrenNote?: string | null } = {}) => ({
      applicantType: input.applicantType,
      players,
      parentName,
      parentEmail: input.parent?.email.toLowerCase() ?? null,
      parentPhone: input.parent?.phone ?? null,
      note: input.note ?? null,
      ...extra,
    });

    if (input.applicantType === 'ADULT') {
      const data = playerData(input.player);
      await this.prisma.registrationRequest.create({ data: { ...common, ...data } });
      void this.notifyNewRegistration(
        summary([{ name: `${data.childFirstName} ${data.childLastName}`, birthDate: data.childBirthDate?.toISOString().slice(0, 10) ?? null }], { playerEmail: data.playerEmail }),
      );
      return { created: 1 };
    }

    if (input.applicantType === 'PARENT') {
      await this.prisma.registrationRequest.create({
        data: { ...common, parentChildrenNote: input.existingChildrenNote },
      });
      void this.notifyNewRegistration(summary([], { parentChildrenNote: input.existingChildrenNote ?? null }));
      return { created: 1 };
    }

    // CHILD — jedna prihláška na každé dieťa
    const children = input.children ?? [];
    const childData = children.map((child) => playerData(child));
    await this.prisma.$transaction(childData.map((data) => this.prisma.registrationRequest.create({ data: { ...common, ...data } })));
    void this.notifyNewRegistration(
      summary(childData.map((d) => ({ name: `${d.childFirstName} ${d.childLastName}`, birthDate: d.childBirthDate?.toISOString().slice(0, 10) ?? null }))),
    );
    return { created: children.length };
  }

  /**
   * Upozorní klub e-mailom (predvolene info@fkknv.sk, prepísateľné REGISTRATION_NOTIFY_EMAIL)
   * na novú prihlášku. Best-effort — chyba e-mailu nikdy nezhodí registráciu.
   */
  private async notifyNewRegistration(summary: Parameters<typeof buildNewRegistrationEmail>[0]) {
    try {
      const to = (process.env.REGISTRATION_NOTIFY_EMAIL ?? 'info@fkknv.sk')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      const { subject, html } = buildNewRegistrationEmail(summary, 'https://fkknv.sk/portal/registracie');
      const res = await this.email.send(to, subject, html, summary.parentEmail ?? undefined);
      if (!res.sent) this.logger.warn(`Notifikačný e-mail o novej registrácii sa neodoslal: ${res.reason ?? ''}`);
    } catch (e) {
      this.logger.warn(`Notifikačný e-mail o novej registrácii zlyhal: ${e instanceof Error ? e.message : e}`);
    }
  }

  async listPending() {
    const rows = await this.prisma.registrationRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    // infoToken je tajný (len odkaz v e-maile) — nevracia sa
    return rows.map(({ infoToken: _token, ...r }) => ({ ...r, hasPhoto: !!r.photoDataUrl }));
  }

  /** História registrácií (schválené / zamietnuté / všetky), od najnovších; bez fotky a tajného tokenu. */
  async listHistory(status?: string, q?: string) {
    const st = status === 'APPROVED' || status === 'REJECTED' || status === 'PENDING' ? status : undefined;
    const rows = await this.prisma.registrationRequest.findMany({
      where: { ...(st ? { status: st } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const norm = (v: string | null | undefined) => (v ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const needle = norm(q?.trim());
    return rows
      .map(({ infoToken: _t, photoDataUrl, ...r }) => ({ ...r, hasPhoto: !!photoDataUrl }))
      .filter(
        (r) =>
          !needle ||
          norm(
            [r.childFirstName, r.childLastName, r.parentFirstName, r.parentLastName, r.parentEmail, r.playerEmail].join(' '),
          ).includes(needle),
      );
  }

  // ---------------------------------------------------------------------
  // Doplnenie údajov o dieťati rodičom cez verejný odkaz
  // ---------------------------------------------------------------------

  private infoLink(token: string) {
    return `https://fkknv.sk/doplnenie-udajov/${token}`;
  }

  private async loadForInfoRequest(id: string) {
    const r = await this.prisma.registrationRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Prihláška neexistuje');
    if (r.status !== 'PENDING') throw new BadRequestException('Prihláška už bola spracovaná');
    const to = r.parentEmail || r.playerEmail || null;
    if (!to) throw new BadRequestException('Prihláška nemá vyplnený e-mail rodiča ani hráča');
    const parentName = [r.parentFirstName, r.parentLastName].filter(Boolean).join(' ') || undefined;
    const childName = [r.childFirstName, r.childLastName].filter(Boolean).join(' ') || undefined;
    return { r, to, parentName, childName };
  }

  /** Náhľad e-mailu — nič neodosiela ani nemení. */
  async previewInfoRequest(id: string, message?: string) {
    const { to, parentName, childName } = await this.loadForInfoRequest(id);
    const link = this.infoLink('UKAZKA');
    const { subject, html } = buildInfoRequestEmail({ parentName, childName, link, message });
    return { to, subject, html, link };
  }

  async requestInfo(id: string, message?: string) {
    const { to, parentName, childName } = await this.loadForInfoRequest(id);
    const token = randomBytes(32).toString('hex');
    const now = new Date();
    await this.prisma.registrationRequest.update({
      where: { id },
      data: { infoToken: token, infoRequestedAt: now, infoExpiresAt: new Date(now.getTime() + 14 * 86_400_000) },
    });
    const link = this.infoLink(token);
    const { subject, html } = buildInfoRequestEmail({ parentName, childName, link, message });
    const res = await this.email.send([to], subject, html, 'info@fkknv.sk');
    return { sent: res.sent, ...(res.reason ? { reason: res.reason } : {}), to, link };
  }

  private async findByInfoToken(token: string) {
    if (!token || token.length < 16) return null;
    return this.prisma.registrationRequest.findUnique({ where: { infoToken: token } });
  }

  private async infoTeams() {
    const teams = await this.prisma.team.findMany({
      where: { isDemo: false, isGoalkeeperGroup: false },
      orderBy: [{ teamCategory: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
      select: { id: true, name: true, teamCategory: { select: { name: true } } },
    });
    return teams.map((t) => ({ id: t.id, name: t.name, categoryName: t.teamCategory.name }));
  }

  async getInfoForm(token: string) {
    const r = await this.findByInfoToken(token);
    if (!r || r.status !== 'PENDING') return { valid: false, teams: [] as Awaited<ReturnType<typeof this.infoTeams>> };
    if (r.infoExpiresAt && r.infoExpiresAt.getTime() < Date.now()) {
      return { valid: false, expired: true, teams: [] as Awaited<ReturnType<typeof this.infoTeams>> };
    }
    return {
      valid: true,
      alreadyReceived: !!r.infoReceivedAt,
      parentName: [r.parentFirstName, r.parentLastName].filter(Boolean).join(' ') || undefined,
      childFirstName: r.childFirstName ?? undefined,
      childLastName: r.childLastName ?? undefined,
      childBirthDate: r.childBirthDate ? r.childBirthDate.toISOString().slice(0, 10) : undefined,
      registrationNumber: r.playerRegistrationNumber ?? undefined,
      motherClub: r.infoMotherClub ?? undefined,
      guestClub: r.infoGuestClub ?? undefined,
      clubAffiliation: r.infoClubAffiliation ?? undefined,
      requestedTeamId: r.requestedTeamId ?? undefined,
      teams: await this.infoTeams(),
    };
  }

  async submitInfo(token: string, input: RegistrationInfoInput) {
    const r = await this.findByInfoToken(token);
    if (!r || r.status !== 'PENDING') throw new NotFoundException('Odkaz nie je platný');
    if (!r.infoExpiresAt || r.infoExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Platnosť odkazu vypršala. Požiadajte klub o nový odkaz.');
    }
    if (input.photoBase64) {
      const b64 = input.photoBase64.slice(input.photoBase64.indexOf(',') + 1);
      if (Math.floor((b64.length * 3) / 4) > 3 * 1024 * 1024) {
        throw new BadRequestException('Fotografia je príliš veľká (max 3 MB)');
      }
    }
    let teamId: string | undefined;
    if (input.teamId) {
      const team = await this.prisma.team.findFirst({
        where: { id: input.teamId, isDemo: false, isGoalkeeperGroup: false },
        select: { id: true },
      });
      if (!team) throw new BadRequestException('Vybrané družstvo neexistuje');
      teamId = team.id;
    }
    await this.prisma.registrationRequest.update({
      where: { id: r.id },
      data: {
        childFirstName: input.firstName,
        childLastName: input.lastName,
        childBirthDate: new Date(`${input.birthDate}T00:00:00Z`),
        playerRegistrationNumber: input.registrationNumber || null,
        infoMotherClub: input.motherClub || null,
        infoGuestClub: input.guestClub || null,
        infoClubAffiliation: input.clubAffiliation || null,
        requestedTeamId: teamId ?? null,
        ...(input.photoBase64 ? { photoDataUrl: input.photoBase64 } : {}),
        infoReceivedAt: new Date(),
      },
    });
    // rodič (typ PARENT) nemá dieťa v klube → dieťa sa hneď uloží do ním zvolenej skupiny
    if (r.applicantType === 'PARENT') {
      await this.saveChildFromInfo(r, input, teamId).catch((e) =>
        this.logger.warn(`Uloženie dieťaťa z doplnených údajov zlyhalo: ${e instanceof Error ? e.message : e}`),
      );
    }
    await this.notifyInfoReceived(`${input.firstName} ${input.lastName}`);
    return { ok: true };
  }

  /**
   * Vytvorí (alebo nájde/aktualizuje) člena-dieťa z údajov doplnených rodičom a zaradí ho
   * do rodičom zvolenej skupiny v aktívnej sezóne. Väzba na rodiča vznikne až pri schválení.
   */
  private async saveChildFromInfo(
    r: { id: string; createdMemberId: string | null; requestedTeamId: string | null; photoDataUrl: string | null; healthNotes: string | null },
    input: RegistrationInfoInput,
    teamId: string | undefined,
  ) {
    const birthDate = new Date(`${input.birthDate}T00:00:00Z`);
    const fields = {
      firstName: input.firstName,
      lastName: input.lastName,
      birthDate,
      registrationNumber: input.registrationNumber || undefined,
      homeClub: input.motherClub || undefined,
      guestClub: input.guestClub || undefined,
      clubAffiliation: input.clubAffiliation || undefined,
    };
    let member = r.createdMemberId ? await this.prisma.member.findUnique({ where: { id: r.createdMemberId } }) : null;
    if (!member) {
      member = await this.findExistingMember({
        playerRegistrationNumber: input.registrationNumber || null,
        birthNumber: null,
        childFirstName: input.firstName,
        childLastName: input.lastName,
        childBirthDate: birthDate,
      });
    }
    const isNew = !member;
    if (member) {
      // existujúceho člena neprepisujeme natvrdo — dopĺňame len prázdne polia (okrem opravy zadanej rodičom pri vlastnom zázname)
      const own = member.id === r.createdMemberId;
      member = await this.prisma.member.update({
        where: { id: member.id },
        data: own
          ? fields
          : {
              registrationNumber: member.registrationNumber ?? fields.registrationNumber,
              homeClub: member.homeClub ?? fields.homeClub,
              guestClub: member.guestClub ?? fields.guestClub,
              clubAffiliation: member.clubAffiliation ?? fields.clubAffiliation,
            },
      });
    } else {
      member = await this.prisma.member.create({ data: { ...fields, healthNotes: r.healthNotes } });
    }
    if (input.photoBase64 && (isNew || member.id === r.createdMemberId)) {
      await this.prisma.memberPhoto.deleteMany({ where: { memberId: member.id } });
      await this.prisma.memberPhoto.create({ data: { memberId: member.id, dataUrl: input.photoBase64 } });
      await this.prisma.member.update({ where: { id: member.id }, data: { photoUrl: `/members/${member.id}/photo` } });
    }

    const season = await this.prisma.season.findFirst({ where: { isActive: true } });
    if (season && teamId) {
      // rodič skupinu zmenil → pôvodná skupina z predchádzajúceho odoslania sa zruší
      if (r.requestedTeamId && r.requestedTeamId !== teamId && member.id === r.createdMemberId) {
        await this.prisma.teamMembership.deleteMany({
          where: { memberId: member.id, seasonId: season.id, teamId: r.requestedTeamId },
        });
      }
      await this.prisma.teamMembership.upsert({
        where: { memberId_seasonId_teamId: { memberId: member.id, seasonId: season.id, teamId } },
        create: { memberId: member.id, seasonId: season.id, teamId },
        update: { leftAt: null },
      });
    }
    await this.prisma.registrationRequest.update({ where: { id: r.id }, data: { createdMemberId: member.id } });
  }

  /** Best-effort: upozorní vedenie, že rodič doplnil údaje. */
  private async notifyInfoReceived(childName: string) {
    try {
      const staff = await this.prisma.user.findMany({
        where: { roles: { some: { role: { in: ['ADMIN', 'MANAGER'] as never } } } },
        select: { id: true },
      });
      await this.push.notifyUsers(staff.map((u) => u.id), {
        title: 'Doplnené údaje k registrácii',
        body: `Rodič doplnil údaje hráča ${childName}.`,
      });
    } catch (e) {
      this.logger.warn(`Notifikácia o doplnených údajoch zlyhala: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * Nájde už existujúceho člena zodpovedajúceho prihláške (aby sa pri schválení
   * nevytváral duplikát): najprv podľa registračného čísla (unikátne), potom
   * rodného čísla a nakoniec mena + priezviska + dátumu narodenia.
   */
  private async findExistingMember(request: {
    playerRegistrationNumber: string | null;
    birthNumber: string | null;
    childFirstName: string | null;
    childLastName: string | null;
    childBirthDate: Date | null;
  }) {
    if (request.playerRegistrationNumber) {
      const byReg = await this.prisma.member.findUnique({
        where: { registrationNumber: request.playerRegistrationNumber },
      });
      if (byReg) return byReg;
    }
    if (request.birthNumber) {
      const byBn = await this.prisma.member.findFirst({ where: { birthNumber: request.birthNumber } });
      if (byBn) return byBn;
    }
    if (request.childFirstName && request.childLastName && request.childBirthDate) {
      return this.prisma.member.findFirst({
        where: {
          firstName: { equals: request.childFirstName, mode: 'insensitive' },
          lastName: { equals: request.childLastName, mode: 'insensitive' },
          birthDate: request.childBirthDate,
        },
      });
    }
    return null;
  }

  /**
   * Schválenie prihlášky. Vytvorí:
   *  - člena-hráča (dieťa) so zaradením do kategórie podľa veku,
   *  - konto rodiča s dočasným heslom + rolou PARENT (rodič je vedený aj ako člen),
   *  - väzbu Guardian rodič ↔ dieťa.
   * Vráti dočasné heslo rodiča, aby ho vedenie mohlo odovzdať.
   *
   * `childMemberIds` (voliteľné): existujúci členovia, ktorých má schválenie
   * priradiť rodičovi. Pri type PARENT sú to deti, ktoré sú už členmi klubu.
   * Pri type CHILD/ADULT prvý z nich znamená „hráč už existuje" — namiesto
   * vytvorenia duplikátu sa použije tento člen. Ak sa nezadá a hráč už existuje
   * (podľa reg./rodného čísla či mena a dátumu), použije sa nájdený člen.
   */
  async approve(id: string, reviewerId: string, opts?: { childMemberIds?: string[] }) {
    const request = await this.prisma.registrationRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Prihláška neexistuje');
    if (request.status !== 'PENDING') throw new BadRequestException('Prihláška už bola spracovaná');

    const parentOnly = request.applicantType === 'PARENT';
    const selectedIds = [...new Set(opts?.childMemberIds ?? [])];

    // Rodič (typ PARENT) doplnil cez odkaz údaje dieťaťa a nik nevybral existujúceho člena →
    // dieťa sa vytvorí (alebo nájde) z doplnených údajov, aby nezostalo bez záznamu.
    const createFromInfo =
      parentOnly && selectedIds.length === 0 && !!request.infoReceivedAt && !!request.childFirstName && !!request.childLastName;

    // 1. hráč (dieťa alebo dospelý) ako člen — pri type PARENT sa hráč vytvára len z doplnených údajov
    let player: { id: string; firstName: string; lastName: string } | null = null;
    let playerAccount: { email: string; tempPassword: string | null } | null = null;
    let reusedExisting = false;
    if (!parentOnly || createFromInfo) {
      // hráč už môže byť členom (import z futbalnetu, skoršia registrácia) —
      // vtedy sa nevytvára duplikát, len sa priradí k rodičovi
      const explicit = selectedIds[0]
        ? await this.prisma.member.findUnique({ where: { id: selectedIds[0] } })
        : null;
      if (selectedIds[0] && !explicit) throw new BadRequestException('Vybraný člen neexistuje');
      const fromInfo =
        !explicit && createFromInfo && request.createdMemberId
          ? await this.prisma.member.findUnique({ where: { id: request.createdMemberId } })
          : null;
      const existing = explicit ?? fromInfo ?? (await this.findExistingMember(request));

      if (existing) {
        player = existing;
        reusedExisting = true;
      } else {
        player = await this.prisma.member.create({
          data: {
            firstName: request.childFirstName ?? '',
            lastName: request.childLastName ?? '',
            birthDate: request.childBirthDate,
            birthNumber: request.birthNumber,
            sex: request.sex,
            registrationNumber: request.playerRegistrationNumber || undefined,
            originCountry: request.originCountry,
            addressStreet: request.addressStreet,
            addressHouseNumber: request.addressHouseNumber,
            addressZip: request.addressZip,
            addressCity: request.addressCity,
            healthNotes: request.healthNotes,
            homeClub: request.infoMotherClub || undefined,
            guestClub: request.infoGuestClub || undefined,
            clubAffiliation: request.infoClubAffiliation || undefined,
          },
        });

        // 1b. fotka hráča (ak bola nahraná pri registrácii) — len pre nového člena
        if (request.photoDataUrl) {
          await this.prisma.memberPhoto.create({ data: { memberId: player.id, dataUrl: request.photoDataUrl } });
          await this.prisma.member.update({ where: { id: player.id }, data: { photoUrl: `/members/${player.id}/photo` } });
        }
      }

      // 2. voliteľné vlastné prihlásenie hráča (starší hráč / dospelý) — ak ešte nemá konto
      if (request.playerEmail && !(reusedExisting && (await this.hasAccount(player.id)))) {
        const acc = await this.accounts.ensureAccount({
          email: request.playerEmail,
          firstName: request.childFirstName ?? '',
          lastName: request.childLastName ?? '',
          roles: ['PLAYER'],
        });
        // prepoj hráča s jeho kontom
        await this.prisma.member.update({ where: { id: player.id }, data: { userId: acc.userId } });
        playerAccount = { email: acc.email, tempPassword: acc.tempPassword };
      }
    }

    // 3. rodič — pri registrácii dieťaťa aj pri type PARENT (konto rodiča)
    let parent: { email: string; tempPassword: string | null; accountCreated: boolean } | null = null;
    const linkedChildren: Array<{ id: string; firstName: string; lastName: string }> = [];
    if (request.applicantType !== 'ADULT' && request.parentEmail) {
      const parentAccount = await this.accounts.ensureAccount({
        email: request.parentEmail,
        phone: request.parentPhone ?? undefined,
        firstName: request.parentFirstName ?? '',
        lastName: request.parentLastName ?? '',
        roles: ['PARENT'],
      });
      // rodič vedený aj ako člen klubu
      const existingParentMember = await this.prisma.member.findUnique({ where: { userId: parentAccount.userId } });
      if (!existingParentMember) {
        await this.prisma.member.create({
          data: {
            firstName: request.parentFirstName ?? '',
            lastName: request.parentLastName ?? '',
            userId: parentAccount.userId,
          },
        });
      }
      // väzba rodič ↔ dieťa: pri registrácii dieťaťa je to vytvorený/nájdený hráč;
      // pri type PARENT sú to vybrané existujúce deti (childMemberIds)
      const childIds = player ? [player.id] : selectedIds;
      for (const childId of childIds) {
        const child = await this.prisma.member.findUnique({
          where: { id: childId },
          select: { id: true, firstName: true, lastName: true },
        });
        if (!child) continue;
        await this.prisma.guardian.upsert({
          where: { userId_memberId: { userId: parentAccount.userId, memberId: childId } },
          create: {
            userId: parentAccount.userId,
            memberId: childId,
            relation: request.parentRelation ?? 'GUARDIAN',
          },
          update: {},
        });
        linkedChildren.push(child);
      }
      parent = {
        email: parentAccount.email,
        tempPassword: parentAccount.tempPassword,
        accountCreated: parentAccount.created,
      };
    }

    await this.prisma.registrationRequest.update({
      where: { id },
      data: { status: 'APPROVED', reviewedById: reviewerId, reviewedAt: new Date(), createdMemberId: player?.id },
    });

    // 4. zaradenie hráča do kategórie podľa veku
    if (player) {
      const activeSeason = await this.prisma.season.findFirst({ where: { isActive: true } });
      // želaná skupina z doplnených údajov — pred automatickým zaradením, aby ho nechalo na pokoji
      if (activeSeason && request.requestedTeamId) {
        try {
          await this.prisma.teamMembership.upsert({
            where: {
              memberId_seasonId_teamId: { memberId: player.id, seasonId: activeSeason.id, teamId: request.requestedTeamId },
            },
            create: { memberId: player.id, seasonId: activeSeason.id, teamId: request.requestedTeamId },
            update: {},
          });
        } catch (e) {
          this.logger.warn(`Zaradenie do želanej skupiny zlyhalo: ${e instanceof Error ? e.message : e}`);
        }
      }
      if (activeSeason) await this.seasonsService.assignMemberships(activeSeason.id);
    }

    return {
      player: player
        ? { id: player.id, firstName: player.firstName, lastName: player.lastName, account: playerAccount, reused: reusedExisting }
        : null,
      parent,
      linkedChildren,
    };
  }

  /**
   * Ručné vytvorenie dieťaťa z údajov v prihláške (napr. keď sa pri schválení nevytvorilo).
   * Zaradí ho do rodičom zvolenej skupiny (alebo podľa veku) a naviaže na konto rodiča, ak existuje.
   */
  async createChildFromRequest(id: string) {
    const r = await this.prisma.registrationRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Prihláška neexistuje');
    if (!r.childFirstName || !r.childLastName || !r.childBirthDate) {
      throw new BadRequestException('V prihláške chýbajú údaje dieťaťa (meno, priezvisko, dátum narodenia)');
    }
    await this.saveChildFromInfo(
      r,
      {
        firstName: r.childFirstName,
        lastName: r.childLastName,
        birthDate: r.childBirthDate.toISOString().slice(0, 10),
        registrationNumber: r.playerRegistrationNumber ?? undefined,
        motherClub: r.infoMotherClub ?? undefined,
        guestClub: r.infoGuestClub ?? undefined,
        clubAffiliation: r.infoClubAffiliation ?? undefined,
        photoBase64: r.photoDataUrl ?? undefined,
      } as RegistrationInfoInput,
      r.requestedTeamId ?? undefined,
    );
    const fresh = await this.prisma.registrationRequest.findUnique({ where: { id } });
    const memberId = fresh?.createdMemberId;
    if (!memberId) throw new BadRequestException('Člena sa nepodarilo vytvoriť');

    let linkedParent = false;
    if (r.parentEmail) {
      const user = await this.prisma.user.findFirst({ where: { email: { equals: r.parentEmail, mode: 'insensitive' } } });
      if (user) {
        await this.prisma.guardian.upsert({
          where: { userId_memberId: { userId: user.id, memberId } },
          create: { userId: user.id, memberId, relation: r.parentRelation ?? 'GUARDIAN' },
          update: {},
        });
        linkedParent = true;
      }
    }
    const season = await this.prisma.season.findFirst({ where: { isActive: true } });
    if (season) await this.seasonsService.assignMemberships(season.id);
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      select: { id: true, firstName: true, lastName: true, memberships: { where: { leftAt: null }, select: { team: { select: { name: true } } } } },
    });
    return { member, linkedParent };
  }

  /** Má člen prepojené prihlasovacie konto? */
  private async hasAccount(memberId: string): Promise<boolean> {
    const m = await this.prisma.member.findUnique({ where: { id: memberId }, select: { userId: true } });
    return !!m?.userId;
  }

  async reject(id: string, reviewerId: string) {
    const request = await this.prisma.registrationRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Prihláška neexistuje');
    if (request.status !== 'PENDING') throw new BadRequestException('Prihláška už bola spracovaná');
    return this.prisma.registrationRequest.update({
      where: { id },
      data: { status: 'REJECTED', reviewedById: reviewerId, reviewedAt: new Date() },
    });
  }
}
