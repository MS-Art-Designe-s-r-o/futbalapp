'use client';

import { useEffect, useState } from 'react';
import { api, getToken } from './api';

export interface Me {
  id: string;
  firstName: string;
  lastName: string;
  memberId: string | null;
  roles: Array<{ role: string; team: { id: string; name: string; categoryCode: string; isGoalkeeperGroup?: boolean } | null }>;
  children: Array<{ id: string; firstName: string; lastName: string }>;
}

export function isStaff(me: Me | null): boolean {
  return !!me?.roles.some((r) => r.role === 'ADMIN' || r.role === 'MANAGER');
}
export function isAdmin(me: Me | null): boolean {
  return !!me?.roles.some((r) => r.role === 'ADMIN');
}
export function isCoach(me: Me | null): boolean {
  return !!me?.roles.some((r) => r.role === 'COACH');
}
export function isParent(me: Me | null): boolean {
  return !!me?.roles.some((r) => r.role === 'PARENT');
}
export function isPlayer(me: Me | null): boolean {
  return !!me?.roles.some((r) => r.role === 'PLAYER');
}
/** Družstvá, ktoré tréner vedie. */
/** Tréner brankárov bez trénerstva bežného družstva: vidí len skupiny Brankári. */
export function isGkCoachOnly(me: Me | null): boolean {
  if (!me || isStaff(me)) return false;
  const gk = me.roles.some((r) => r.role === 'GK_COACH');
  const regular = me.roles.some((r) => r.role === 'COACH' && !(r.team?.isGoalkeeperGroup));
  return gk && !regular;
}

export function coachTeams(me: Me | null): Array<{ id: string; name: string; categoryCode: string }> {
  return (me?.roles ?? []).filter((r) => r.role === 'COACH' && r.team).map((r) => r.team!);
}
/** Môže používateľ vytvárať/upravovať obsah (vedenie alebo tréner)? */
export function canManage(me: Me | null): boolean {
  return isStaff(me) || isCoach(me);
}
/** Môže používateľ spravovať dané družstvo? Vedenie áno, tréner len svoje. */
export function canManageTeam(me: Me | null, teamId: string | null | undefined): boolean {
  if (isStaff(me)) return true;
  if (!teamId) return false;
  return coachTeams(me).some((t) => t.id === teamId);
}

export function useMe(): { me: Me | null; loading: boolean } {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api<Me>('/auth/me')
      .then(setMe)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  return { me, loading };
}
