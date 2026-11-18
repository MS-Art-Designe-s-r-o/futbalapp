import * as SecureStore from 'expo-secure-store';
import { api, ApiError, setToken } from './api';

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
export function isCoach(me: Me | null): boolean {
  return !!me?.roles.some((r) => r.role === 'COACH');
}
export function isParent(me: Me | null): boolean {
  return !!me?.roles.some((r) => r.role === 'PARENT');
}
export function canManage(me: Me | null): boolean {
  return isStaff(me) || isCoach(me);
}
/** Tréner brankárov bez trénerstva bežného družstva: smie vytvárať len tréningy skupín Brankári. */
export function isGkCoachOnly(me: Me | null): boolean {
  if (!me || isStaff(me)) return false;
  const gk = me.roles.some((r) => r.role === 'GK_COACH');
  const regular = me.roles.some((r) => r.role === 'COACH' && !r.team?.isGoalkeeperGroup);
  return gk && !regular;
}
export function coachTeams(me: Me | null): Array<{ id: string; name: string; categoryCode: string }> {
  return (me?.roles ?? []).filter((r) => r.role === 'COACH' && r.team).map((r) => r.team!);
}
/** Môže používateľ spravovať dané družstvo? Vedenie áno, tréner len svoje. */
export function canManageTeam(me: Me | null, teamId: string | null | undefined): boolean {
  if (isStaff(me)) return true;
  if (!teamId) return false;
  return coachTeams(me).some((t) => t.id === teamId);
}

export function fetchMe(): Promise<Me> {
  return api<Me>('/auth/me');
}

// ---------- Prihlásenie a uložené prihlásenie (biometria) ----------

/** Prihlási e-mailom a heslom a uloží prístupový token. Heslo sa nikde neloguje. */
export async function loginWithPassword(email: string, password: string): Promise<void> {
  const result = await api<{ accessToken: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim(), password }),
  });
  await setToken(result.accessToken);
}

/** Server odmietol údaje (zlé/zmenené heslo, zablokované konto) — nie výpadok siete. */
export function isCredentialsRejected(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 400 || e.status === 401 || e.status === 403);
}

const SAVED_EMAIL_KEY = 'fkknv_saved_email';
const SAVED_PASSWORD_KEY = 'fkknv_saved_password';
const SAVED_ENABLED_KEY = 'fkknv_saved_login_enabled';
/** Voľba používateľa „Zapamätať si heslo / používať biometriu" ('1' / '0'). */
const REMEMBER_PREF_KEY = 'fkknv_remember_pref';

// Bez requireAuthentication (kompatibilita so staršími Androidmi) — biometriu overuje appka cez expo-local-authentication.
const STORE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export interface SavedLogin {
  email: string;
  password: string;
}

export async function saveLogin(email: string, password: string): Promise<void> {
  await SecureStore.setItemAsync(SAVED_EMAIL_KEY, email.trim(), STORE_OPTS);
  await SecureStore.setItemAsync(SAVED_PASSWORD_KEY, password, STORE_OPTS);
  await SecureStore.setItemAsync(SAVED_ENABLED_KEY, '1', STORE_OPTS);
}

export async function loadSavedLogin(): Promise<SavedLogin | null> {
  try {
    if ((await SecureStore.getItemAsync(SAVED_ENABLED_KEY, STORE_OPTS)) !== '1') return null;
    const email = await SecureStore.getItemAsync(SAVED_EMAIL_KEY, STORE_OPTS);
    const password = await SecureStore.getItemAsync(SAVED_PASSWORD_KEY, STORE_OPTS);
    return email && password ? { email, password } : null;
  } catch {
    return null;
  }
}

export async function hasSavedLogin(): Promise<boolean> {
  return (await loadSavedLogin()) !== null;
}

/** Vymaže uložené prihlásenie (e-mail, heslo, príznak). Odhlásenie ho NEmaže automaticky. */
export async function clearSavedLogin(): Promise<void> {
  await Promise.all(
    [SAVED_EMAIL_KEY, SAVED_PASSWORD_KEY, SAVED_ENABLED_KEY].map((k) =>
      SecureStore.deleteItemAsync(k, STORE_OPTS).catch(() => undefined),
    ),
  );
}

export async function getRememberPref(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(REMEMBER_PREF_KEY)) !== '0';
  } catch {
    return true;
  }
}

export async function setRememberPref(on: boolean): Promise<void> {
  await SecureStore.setItemAsync(REMEMBER_PREF_KEY, on ? '1' : '0').catch(() => undefined);
}
