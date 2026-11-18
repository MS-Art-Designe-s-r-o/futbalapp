import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

// Priorita: EXPO_PUBLIC_API_URL (dev/skúšanie, zapečie sa pri bundlovaní)
// → app.json extra.apiUrl (produkcia) → localhost (lokálny vývoj)
export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  'http://localhost:3001/api/v1';

const TOKEN_KEY = 'fkknv_token';

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string | null): Promise<void> {
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

/** Chyba z API s HTTP stavom (napr. 401 pri zlom hesle). */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: { code?: string; conflicts?: Array<{ teamName: string; title: string; startAt: string; endAt: string | null }> } = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers as Record<string, string> | undefined),
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string; code?: string; conflicts?: Array<{ teamName: string; title: string; startAt: string; endAt: string | null }> };
    throw new ApiError(body.message ?? `Chyba servera (${response.status})`, response.status, { code: body.code, conflicts: body.conflicts });
  }
  return (await response.json()) as T;
}
