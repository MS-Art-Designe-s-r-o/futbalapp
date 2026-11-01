import { z } from 'zod';
import { ROLES, MEMBER_STATUSES, ATTENDANCE_STATUSES, EVENT_TYPES, MATCH_EVENT_TYPES, SURFACE_CODES } from './enums';
import { parseRodneCislo } from './rodne-cislo';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type LoginInput = z.infer<typeof loginSchema>;

const regAddressSchema = z.object({
  street: z.string().min(2).max(120),
  houseNumber: z.string().min(1).max(20),
  zip: z.string().min(4).max(10),
  city: z.string().min(2).max(120),
});

/** Údaje o dieťati / hráčovi (spoločné pre dieťa aj dospelého). */
const regPlayerSchema = z.object({
  firstName: z.string().min(2).max(60),
  lastName: z.string().min(2).max(60),
  // rodné číslo je povinné; dátum narodenia a pohlavie sa z neho odvodia (server je autorita)
  birthNumber: z
    .string()
    .min(9)
    .max(11)
    .refine((v) => parseRodneCislo(v) !== null, { message: 'Neplatné rodné číslo' }),
  // registračné číslo (hráč ho ešte nemusí mať pridelené)
  registrationNumber: z.string().max(40).optional(),
  // fotka hráča ako data URL (voliteľná)
  photoBase64: z.string().max(6_000_000).optional(),
  healthNotes: z.string().max(2000).optional(),
  // vlastné prihlásenie hráča (povinné pre dospelého, voliteľné pre dieťa)
  email: z.string().email().optional(),
  originCountry: z.string().max(60).optional(),
  address: regAddressSchema,
});

const regParentSchema = z.object({
  firstName: z.string().min(2).max(60),
  lastName: z.string().min(2).max(60),
  email: z.string().email(),
  phone: z.string().min(9).max(20),
  relation: z.enum(['MOTHER', 'FATHER', 'GUARDIAN', 'RELATIVE']),
});

export const registrationRequestSchema = z
  .object({
    // CHILD = rodič registruje dieťa(deti), ADULT = dospelý hráč sám za seba,
    // PARENT = rodič si vytvára len konto (deti sú už členmi klubu)
    applicantType: z.enum(['CHILD', 'ADULT', 'PARENT']),
    // rodič — pri CHILD a PARENT
    parent: regParentSchema.optional(),
    // deti na registráciu — pri CHILD (aspoň jedno)
    children: z.array(regPlayerSchema).min(1).max(10).optional(),
    // dospelý hráč — pri ADULT
    player: regPlayerSchema.extend({ email: z.string().email() }).optional(),
    // rodič s existujúcimi deťmi (mená detí) — pri PARENT, priradenie urobí vedenie/tréner
    existingChildrenNote: z.string().max(2000).optional(),
    consents: z.object({
      gdpr: z.literal(true, { errorMap: () => ({ message: 'Súhlas so spracovaním údajov je povinný' }) }),
      photos: z.boolean(),
    }),
    note: z.string().max(2000).optional(),
  })
  .refine((d) => d.applicantType !== 'CHILD' || (!!d.parent && (d.children?.length ?? 0) > 0), {
    message: 'Pri registrácii dieťaťa treba údaje rodiča a aspoň jedno dieťa',
    path: ['children'],
  })
  .refine((d) => d.applicantType !== 'ADULT' || !!d.player, {
    message: 'Údaje dospelého hráča sú povinné',
    path: ['player'],
  })
  .refine((d) => d.applicantType !== 'PARENT' || !!d.parent, {
    message: 'Údaje rodiča sú povinné',
    path: ['parent'],
  });
export type RegistrationRequestInput = z.infer<typeof registrationRequestSchema>;

export const createMemberSchema = z.object({
  firstName: z.string().min(2).max(60),
  lastName: z.string().min(2).max(60),
  birthDate: z.coerce.date().optional(), // hráči majú dátum, nehráči (rodič/tréner) nemusia
  status: z.enum(MEMBER_STATUSES).default('ACTIVE'),
  futbalnetId: z.string().max(40).optional(),
  healthNotes: z.string().max(2000).optional(),
  /// sociálny prípad — hráčovi sa nevytvára poplatok (len vedúci)
  socialCase: z.boolean().optional(),
  /// úroveň trénerskej licencie
  licenseLevel: z.enum(['A_PRO', 'A', 'B', 'C', 'GK']).optional(),
  /// registračný preukaz / futbalnet
  registrationNumber: z.string().max(40).optional(),
  homeClub: z.string().max(120).optional(),
  guestClub: z.string().max(120).optional(),
  clubAffiliation: z.string().max(120).optional(),
  registrationValidUntil: z.coerce.date().optional(),
  registeredAt: z.coerce.date().optional(),
  /// manuálne zaradenie do družstva (prepíše automatické podľa veku)
  teamId: z.string().optional(),
  /// manuálne zaradenie do viacerých skupín naraz (nahrádza teamId)
  teamIds: z.array(z.string()).optional(),
  /// funkcie/roly člena (na jeho prihlasovacom konte)
  roles: z.array(z.enum(ROLES)).optional(),
  /// vytvorenie/aktualizácia prihlasovacieho konta
  account: z
    .object({
      email: z.string().email(),
      phone: z.string().max(20).optional(),
    })
    .optional(),
  /// priradenie detí rodičovi (vytvorí väzbu Guardian; vyžaduje konto)
  childMemberIds: z.array(z.string()).optional(),
});
export type CreateMemberInput = z.infer<typeof createMemberSchema>;

/// adresa udalosti: orezaná, max 300 znakov, prázdny reťazec → null
export const eventAddressSchema = z
  .string()
  .trim()
  .max(300)
  .nullish()
  .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));

/// Zoznam klubov (účastníkov turnaja): orezané názvy 1–120 znakov, max 40, bez duplicít (bez ohľadu na veľkosť písmen).
export const tournamentClubListSchema = z
  .array(z.string().trim().min(1).max(120))
  .max(40)
  .transform((list) => {
    const seen = new Set<string>();
    return list.filter((name) => {
      const key = name.toLocaleLowerCase('sk');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

export const createEventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  title: z.string().min(2).max(120),
  teamId: z.string().optional(), // null/prázdne = celoklubová udalosť
  /// tréning pre viac družstiev naraz (teamId = prvé); pre každé vznikne vlastná udalosť
  teamIds: z.array(z.string()).optional(),
  /// cieľové družstvá (napr. rodičovské združenie pre viac družstiev naraz);
  /// prázdne = celoklubová udalosť
  audienceTeamIds: z.array(z.string()).optional(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date().optional(),
  location: z.string().max(200).optional(),
  address: eventAddressSchema,
  surface: z.enum(SURFACE_CODES).optional(),
  /// hracia plocha z nastavení; ak je zadaná, miesto a povrch sa preberú z nej
  pitchId: z.string().optional(),
  opponent: z.string().max(120).optional(),
  isHome: z.boolean().optional(),
  /// MATCH: priateľský zápas (nie je súčasťou súťaže SFZ; sync s futbalnetom ho nemení)
  friendly: z.boolean().optional(),
  /// TOURNAMENT: zúčastnené mužstvá (názvy klubov z registra; nové sa do registra doplnia)
  participants: tournamentClubListSchema.optional(),
  /// farba dresu pri zápase: tmavý / svetlý
  jerseyColor: z.enum(['DARK', 'LIGHT']).optional(),
  /// farba dresu súpera (nepovinné)
  opponentJerseyColor: z.enum(['DARK', 'LIGHT']).optional(),
  /// zobraziť v kalendári na verejnom webe (platí len pre TRAINING)
  isPublic: z.boolean().optional(),
  /// tréning: potvrdené, že plochu zdieľa s iným tréningom v rovnakom čase (zápas sa nikdy nezdieľa)
  allowSharedPitch: z.boolean().optional(),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

/// PUT /tournaments/:id/participants — nahradí zoznam účastníkov turnaja.
export const tournamentParticipantsSchema = z.object({
  clubs: tournamentClubListSchema,
});
export type TournamentParticipantsInput = z.infer<typeof tournamentParticipantsSchema>;

/** Nominácia hráča na turnaj (prenesie sa do zápasov turnaja). */
export const tournamentNominationSchema = z.object({ memberId: z.string().min(1) });
export type TournamentNominationInput = z.infer<typeof tournamentNominationSchema>;

/// POST /tournaments/:id/matches — zápas turnaja so zvoleným účastníkom (súperom).
export const createTournamentMatchSchema = z.object({
  opponent: z.string().trim().min(1).max(120),
  /// poradie zápasu v turnaji (1. zápas, 2. zápas …); predvolene ďalšie v poradí
  order: z.number().int().min(1).max(999).optional(),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional(),
  location: z.string().max(200).optional(),
  address: eventAddressSchema,
  /// hracia plocha; predvolene plocha turnaja
  pitchId: z.string().optional(),
  /// farba dresu, v ktorom nastúpime / dresu súpera; null = nezadané (pri PATCH vymaže)
  jerseyColor: z.enum(['DARK', 'LIGHT']).nullable().optional(),
  opponentJerseyColor: z.enum(['DARK', 'LIGHT']).nullable().optional(),
});
export type CreateTournamentMatchInput = z.infer<typeof createTournamentMatchSchema>;

/// PATCH /tournaments/:id/matches/:eventId
export const updateTournamentMatchSchema = createTournamentMatchSchema.partial();
export type UpdateTournamentMatchInput = z.infer<typeof updateTournamentMatchSchema>;

/// Hracia plocha klubu (nastavenia): názov + povrch.
export const createPitchSchema = z.object({
  name: z.string().trim().min(2).max(80),
  surface: z.enum(SURFACE_CODES),
  address: eventAddressSchema,
});
export type CreatePitchInput = z.infer<typeof createPitchSchema>;

export const createRecurringTrainingSchema = z.object({
  title: z.string().min(2).max(120),
  teamId: z.string().min(1),
  /// viac družstiev naraz (teamId = prvé); pre každé vznikne vlastná séria
  teamIds: z.array(z.string()).optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1),
  startTime: z.string().regex(/^\d{1,2}:\d{2}$/),
  endTime: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  from: z.coerce.date(),
  until: z.coerce.date(),
  location: z.string().max(200).optional(),
  address: eventAddressSchema,
  surface: z.enum(SURFACE_CODES).optional(),
  pitchId: z.string().optional(),
  /// zobraziť v kalendári na verejnom webe
  isPublic: z.boolean().optional(),
  /// potvrdené, že plochu zdieľa s iným tréningom v rovnakom čase
  allowSharedPitch: z.boolean().optional(),
});
export type CreateRecurringTrainingInput = z.infer<typeof createRecurringTrainingSchema>;

export const createTeamSchema = z.object({
  teamCategoryCode: z.string().min(1),
  name: z.string().min(1).max(60),
});
export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const markAttendanceSchema = z.object({
  memberId: z.string(),
  status: z.enum(ATTENDANCE_STATUSES),
});
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;

export const matchEventSchema = z.object({
  clientId: z.string().uuid().describe('Idempotentné ID z klienta pre offline sync'),
  minute: z.number().int().min(0).max(150),
  stoppage: z.number().int().min(0).max(30).optional(),
  type: z.enum(MATCH_EVENT_TYPES),
  memberId: z.string().optional(),
  relatedMemberId: z.string().optional(),
  note: z.string().max(500).optional(),
});
export type MatchEventInput = z.infer<typeof matchEventSchema>;

export const assignRoleSchema = z.object({
  role: z.enum(ROLES),
  teamId: z.string().optional(), // scope pre COACH
});
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;

export const publicConsentSchema = z.object({
  profile: z.boolean(),
  photo: z.boolean(),
});
export type PublicConsentInput = z.infer<typeof publicConsentSchema>;

/// Články verejného webu — čistý text, žiadne HTML.
export const createArticleSchema = z.object({
  title: z.string().trim().min(2).max(160),
  excerpt: z.string().trim().min(1).max(400),
  body: z.string().trim().min(1).max(20000),
  publish: z.boolean().optional(),
  isArchive: z.boolean().optional(),
  sourceUrl: z.lazy(() => optionalHttpUrl),
});
export type CreateArticleInput = z.infer<typeof createArticleSchema>;

export const updateArticleSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  excerpt: z.string().trim().min(1).max(400).optional(),
  body: z.string().trim().min(1).max(20000).optional(),
  publish: z.boolean().optional(),
  isArchive: z.boolean().optional(),
  sourceUrl: z.lazy(() => optionalHttpUrl),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Neplatný slug')
    .optional(),
});
export type UpdateArticleInput = z.infer<typeof updateArticleSchema>;

/// ---------------------------------------------------------------------------
/// Klubový obsah (stránky, funkcionári/tréneri, dokumenty) — správa v portáli.
/// Publikovanie (status=PUBLISHED) vyžaduje `confirm: true` (potvrdenie údajov klubom).

export const CONTENT_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];
export const DOCUMENT_CATEGORIES = ['CONTRACT', 'SUBSIDY', 'TAX_FORM', 'ANNOUNCEMENT', 'OTHER'] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
export const CLUB_PERSON_GROUPS = ['MANAGEMENT', 'COACH', 'OTHER'] as const;
export type ClubPersonGroup = (typeof CLUB_PERSON_GROUPS)[number];

/** Len absolútna http(s) URL (žiadne javascript:, data: …). */
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
}

/** Voliteľný text: '' → null, null = vymazať, undefined = nemeniť. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional();

/** Voliteľná http(s) URL: '' → null. */
export const optionalHttpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((s) => s === '' || isHttpUrl(s), 'URL musí byť platná adresa http:// alebo https://')
  .transform((s) => (s === '' ? null : s))
  .nullable()
  .optional();

const contentSlug = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug smie obsahovať len a-z, 0-9 a pomlčky');

const sortOrder = z.number().int().min(-100000).max(100000).optional();
const contentStatus = z.enum(CONTENT_STATUSES).optional();
/** true = obsah potvrdil klub (nastaví confirmedAt), false = potvrdenie zruší. */
const confirm = z.boolean().optional();

/** "YYYY-MM-DD" (platný kalendárny dátum) alebo null. */
export const isoDateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dátum v tvare YYYY-MM-DD')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'Neplatný dátum');

export const createClubPageSchema = z.object({
  slug: contentSlug,
  title: z.string().trim().min(1).max(200),
  /** Čistý text; odseky oddelené prázdnym riadkom, „## " = podnadpis. Žiadne HTML. */
  body: z.string().trim().max(50000),
  status: contentStatus,
  sourceUrl: optionalHttpUrl,
  sourceNote: optionalText(1000),
  sortOrder,
  confirm,
});
export type CreateClubPageInput = z.infer<typeof createClubPageSchema>;
export const updateClubPageSchema = createClubPageSchema.partial();
export type UpdateClubPageInput = z.infer<typeof updateClubPageSchema>;

export const createClubPersonSchema = z.object({
  name: z.string().trim().min(1).max(160),
  role: z.string().trim().min(1).max(160),
  group: z.enum(CLUB_PERSON_GROUPS).optional(),
  teamNote: optionalText(160),
  phone: optionalText(40),
  email: z
    .string()
    .trim()
    .max(200)
    .refine((s) => s === '' || z.string().email().safeParse(s).success, 'Neplatný e-mail')
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional(),
  status: contentStatus,
  sourceUrl: optionalHttpUrl,
  sourceNote: optionalText(1000),
  sortOrder,
  confirm,
});
export type CreateClubPersonInput = z.infer<typeof createClubPersonSchema>;
export const updateClubPersonSchema = createClubPersonSchema.partial();
export type UpdateClubPersonInput = z.infer<typeof updateClubPersonSchema>;

export const createClubDocumentSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: optionalText(4000),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  /** Dátum dokumentu podľa zdroja (nie dátum nahratia). */
  documentDate: isoDateString.nullable().optional(),
  sourceUrl: optionalHttpUrl,
  sourceNote: optionalText(1000),
  status: contentStatus,
  sortOrder,
  confirm,
});
export type CreateClubDocumentInput = z.infer<typeof createClubDocumentSchema>;
export const updateClubDocumentSchema = createClubDocumentSchema.partial();
export type UpdateClubDocumentInput = z.infer<typeof updateClubDocumentSchema>;

/** Povolené typy súborov dokumentov (ukladajú sa bez zmeny). */
export const CLUB_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
] as const;
export const CLUB_DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;
