import type { PrismaService } from '../prisma/prisma.service';
import type { ClubsService } from '../clubs/clubs.service';

export interface ResolvedParticipant {
  clubName: string;
  logoUrl: string | null;
}

/**
 * Účastníci turnaja → kluby z registra. Existujúci klub (bez ohľadu na veľkosť písmen)
 * prevezme kanonický názov a logo; nový klub sa doplní do registra bez loga.
 * Výsledok je bez duplicít a v zadanom poradí.
 */
export async function resolveParticipantClubs(
  prisma: PrismaService,
  clubs: ClubsService,
  names: string[],
): Promise<ResolvedParticipant[]> {
  const out: ResolvedParticipant[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const existing = await prisma.club.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    const club = existing ?? (await clubs.create({ name }));
    const key = club.name.toLocaleLowerCase('sk');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ clubName: club.name, logoUrl: club.logoUrl ?? null });
  }
  return out;
}
