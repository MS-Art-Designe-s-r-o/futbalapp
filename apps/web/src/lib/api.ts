export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('fkknv_token');
}

export function setToken(token: string | null) {
  if (token) window.localStorage.setItem('fkknv_token', token);
  else window.localStorage.removeItem('fkknv_token');
}

/** Chyba API s telom odpovede (napr. `code: 'PITCH_SHARED'` pri zdieľaní plochy). */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: { code?: string; conflicts?: Array<{ teamName: string; title: string; startAt: string; endAt: string | null }> },
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (response.status === 401 && typeof window !== 'undefined') {
    setToken(null);
    window.location.href = '/prihlasenie';
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(body.message ?? `Chyba servera (${response.status})`, response.status, body);
  }
  return response.json() as Promise<T>;
}

/** Upload súboru (multipart/form-data) — Content-Type nastaví prehliadač (boundary). */
export async function apiUpload<T>(path: string, file: File, field = 'file'): Promise<T> {
  const token = getToken();
  const form = new FormData();
  form.append(field, file);
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (response.status === 401 && typeof window !== 'undefined') {
    setToken(null);
    window.location.href = '/prihlasenie';
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? `Chyba servera (${response.status})`);
  }
  return response.json() as Promise<T>;
}

/** Priebežný upload s možnosťou zrušiť (XMLHttpRequest kvôli priebehu nahrávania). */
export interface UploadHandle<T> {
  promise: Promise<T>;
  abort: () => void;
}

/**
 * Upload súboru s priebehom (onProgress 0–1) — fetch neposkytuje priebeh odosielania,
 * preto XMLHttpRequest. Vhodné pre veľké videá z telefónu.
 */
export function apiUploadWithProgress<T>(
  path: string,
  file: File,
  onProgress?: (fraction: number) => void,
  extra?: Record<string, string>,
  field = 'file',
): UploadHandle<T> {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<T>((resolve, reject) => {
    const form = new FormData();
    // textové polia pred súborom — multer ich má k dispozícii hneď
    for (const [k, v] of Object.entries(extra ?? {})) form.append(k, v);
    form.append(field, file);
    xhr.open('POST', `${API_URL}${path}`);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status === 401 && typeof window !== 'undefined') {
        setToken(null);
        window.location.href = '/prihlasenie';
      }
      let body: { message?: string | string[] } = {};
      try {
        body = JSON.parse(xhr.responseText || '{}');
      } catch {
        // nie JSON
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as T);
        return;
      }
      const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
      if (xhr.status === 413) reject(new Error('Súbor je príliš veľký'));
      else reject(new Error(msg ?? `Chyba servera (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Sieťová chyba pri nahrávaní — skúste znova (ideálne cez Wi-Fi)'));
    xhr.onabort = () => reject(new Error('Nahrávanie zrušené'));
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}
