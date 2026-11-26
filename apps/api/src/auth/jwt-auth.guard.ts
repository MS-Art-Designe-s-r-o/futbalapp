import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from './public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './current-user.decorator';

/** Roly sa čítajú z DB (nie len z tokenu, ktorý platí 30 dní) — krátka cache šetrí DB. */
const ROLES_TTL_MS = 10_000;

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  private readonly rolesCache = new Map<string, { at: number; roles: AuthUser['roles'] }>();

  /**
   * Aktuálne roly používateľa z DB. Token si nesie roly z čias prihlásenia, takže zmena roly alebo
   * automaticky pridelený scope (napr. skupiny Brankári) by sa prejavili až po novom prihlásení.
   * Pri chybe DB sa použijú roly z tokenu.
   */
  private async currentRoles(userId: string, fallback: AuthUser['roles']): Promise<AuthUser['roles']> {
    const hit = this.rolesCache.get(userId);
    if (hit && Date.now() - hit.at < ROLES_TTL_MS) return hit.roles;
    try {
      const rows = await this.prisma.userRole.findMany({ where: { userId }, select: { role: true, teamId: true } });
      const roles = rows.map((r) => ({ role: r.role as AuthUser['roles'][number]['role'], teamId: r.teamId }));
      this.rolesCache.set(userId, { at: Date.now(), roles });
      if (this.rolesCache.size > 2000) this.rolesCache.clear();
      return roles;
    } catch {
      return fallback;
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Chýba prihlásenie');

    try {
      const payload = await this.jwtService.verifyAsync<AuthUser & { sub: string }>(token);
      const roles = await this.currentRoles(payload.sub, payload.roles);
      request.user = { id: payload.sub, email: payload.email, roles, isDemo: !!payload.isDemo } satisfies AuthUser;
      return true;
    } catch {
      throw new UnauthorizedException('Neplatný alebo expirovaný token');
    }
  }
}
