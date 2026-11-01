import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreatePitchInput } from '@fkknv/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PitchesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.pitch.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  async create(input: CreatePitchInput) {
    const exists = await this.prisma.pitch.findUnique({ where: { name: input.name } });
    if (exists) throw new BadRequestException('Plocha s týmto názvom už existuje');
    const last = await this.prisma.pitch.aggregate({ _max: { sortOrder: true } });
    return this.prisma.pitch.create({
      data: { name: input.name, surface: input.surface, address: input.address ?? null, sortOrder: (last._max.sortOrder ?? 0) + 1 },
    });
  }

  async update(id: string, input: Partial<CreatePitchInput>) {
    const pitch = await this.prisma.pitch.findUnique({ where: { id } });
    if (!pitch) throw new NotFoundException('Plocha neexistuje');
    if (input.name && input.name !== pitch.name) {
      const exists = await this.prisma.pitch.findUnique({ where: { name: input.name } });
      if (exists) throw new BadRequestException('Plocha s týmto názvom už existuje');
    }
    const updated = await this.prisma.pitch.update({ where: { id }, data: { name: input.name, surface: input.surface, address: input.address } });
    // udalosti viazané na plochu držia kópiu názvu/povrchu — udrž ich zhodné
    await this.prisma.event.updateMany({ where: { pitchId: id }, data: { location: updated.name, surface: updated.surface } });
    // adresu prepíš len udalostiam bez vlastnej odlišnej adresy
    if (input.address !== undefined && updated.address !== pitch.address) {
      await this.prisma.event.updateMany({
        where: { pitchId: id, OR: [{ address: null }, { address: pitch.address }] },
        data: { address: updated.address },
      });
    }
    return updated;
  }

  /** Zmaže plochu; udalosti ostanú (miesto a povrch zostanú ako text, väzba sa zruší). */
  async remove(id: string) {
    const pitch = await this.prisma.pitch.findUnique({ where: { id } });
    if (!pitch) throw new NotFoundException('Plocha neexistuje');
    await this.prisma.pitch.delete({ where: { id } });
    return { deleted: 1 };
  }

  /** Obsadenosť plôch v období — všetky udalosti s plochou (nezávisle od družstva), len základné údaje. */
  async occupancy(from: Date | undefined, to: Date | undefined, isDemo: boolean) {
    const rows = await this.prisma.event.findMany({
      where: { pitchId: { not: null }, isDemo, startAt: { gte: from, lte: to } },
      select: {
        id: true,
        pitchId: true,
        type: true,
        title: true,
        startAt: true,
        endAt: true,
        team: { select: { name: true } },
        parent: { select: { pitchId: true } },
      },
      orderBy: { startAt: 'asc' },
    });
    // zápas turnaja na rovnakej ploche ako turnaj sa nepočíta dvakrát (plochu rezervuje turnaj)
    return rows.filter((r) => !(r.parent && r.parent.pitchId === r.pitchId)).map((r) => ({
      id: r.id,
      pitchId: r.pitchId as string,
      type: r.type,
      title: r.title,
      startAt: r.startAt,
      endAt: r.endAt,
      teamName: r.team?.name ?? null,
    }));
  }
}
