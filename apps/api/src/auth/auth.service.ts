import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { roles: true },
    });
    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Nesprávny e-mail alebo heslo');
    }
    const roles = user.roles.map((r) => ({ role: r.role, teamId: r.teamId }));
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      roles,
      isDemo: user.isDemo,
    });
    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles,
      },
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        roles: { include: { team: { include: { teamCategory: true } } } },
        guardianOf: { include: { member: true } },
        member: { select: { id: true } },
      },
    });
    const roles = user.roles.map((r) => ({
      role: r.role as string,
      team: r.team
        ? { id: r.team.id, name: r.team.name, categoryCode: r.team.teamCategory.code, isGoalkeeperGroup: r.team.isGoalkeeperGroup }
        : null,
    }));
    // Tréner brankárov spravuje brankárske tréningy ktorejkoľvek skupiny Brankári (bez zaškrtnutých skupín):
    // aplikácie dostanú trénerský scope na všetky skupiny Brankári (demo konto len demo skupiny).
    if (user.roles.some((r) => r.role === 'GK_COACH')) {
      const have = new Set(roles.filter((r) => r.role === 'COACH' && r.team).map((r) => r.team!.id));
      const gkTeams = await this.prisma.team.findMany({
        where: { isGoalkeeperGroup: true, isDemo: user.isDemo },
        include: { teamCategory: true },
        orderBy: [{ teamCategory: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
      });
      for (const t of gkTeams) {
        if (have.has(t.id)) continue;
        roles.push({ role: 'COACH', team: { id: t.id, name: t.name, categoryCode: t.teamCategory.code, isGoalkeeperGroup: true } });
      }
    }
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      memberId: user.member?.id ?? null,
      roles,
      children: user.guardianOf.map((g) => ({
        id: g.member.id,
        firstName: g.member.firstName,
        lastName: g.member.lastName,
      })),
    };
  }
}
