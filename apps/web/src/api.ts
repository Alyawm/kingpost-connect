// The sync server's API, as the web viewer uses it. Types mirror `kp_sync::protocol`.

export type Role = 'owner' | 'editor' | 'viewer';

export interface ServerInfo {
  name: string;
  version: string;
  open_signup: boolean;
  first_user: boolean;
}

export interface UserInfo {
  id: number;
  email: string;
  name: string;
  is_admin: boolean;
}

export interface Session {
  token: string;
  user: UserInfo;
}

export interface ProjectSummary {
  id: string;
  name: string;
  role: Role;
  created_at: string;
}

export interface Change {
  id: string;
  hlc: string;
  device: string;
  tbl: string;
  pk: unknown[];
  op: 'upsert' | 'delete';
  row?: Record<string, unknown> | null;
}

export interface SeqChange {
  seq: number;
  change: Change;
}

export interface ChangePage {
  changes: SeqChange[];
  more: boolean;
}

export interface FileNotice {
  rel_path: string;
  sha256: string;
  kind: string;
  size: number;
  user: string;
  published_at: string;
  imported_at: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'kingpost.web.token';

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

let token: string | null = readToken();

export function setToken(value: string | null): void {
  token = value;
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Without storage the sign-in lasts until the page closes.
  }
}

export function hasToken(): boolean {
  return token !== null;
}

/** API address relative to the page, so the viewer works behind a proxy's sub-path too. */
function url(path: string): string {
  return new URL(`api/v1${path}`, document.baseURI).toString();
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(url(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'The server cannot be reached. Check the network and try again.');
  }
  if (!response.ok) {
    let message = `The server answered ${response.status}.`;
    try {
      const error = (await response.json()) as { error?: string };
      if (error.error) message = error.error.charAt(0).toUpperCase() + error.error.slice(1) + '.';
    } catch {
      // Not JSON: keep the status message.
    }
    if (response.status === 401) setToken(null);
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  info: () => request<ServerInfo>('GET', '/server'),
  login: (email: string, password: string) =>
    request<Session>('POST', '/auth/login', { email, password }),
  register: (email: string, name: string, password: string) =>
    request<Session>('POST', '/auth/register', { email, name, password }),
  logout: () => request<void>('POST', '/auth/logout'),
  me: () => request<UserInfo>('GET', '/me'),
  projects: () => request<ProjectSummary[]>('GET', '/projects'),
  changes: (project: string, after: number, limit = 2000) =>
    request<ChangePage>('GET', `/projects/${project}/changes?after=${after}&limit=${limit}`),
  files: (project: string) => request<FileNotice[]>('GET', `/projects/${project}/files`),
  push: (project: string, device: string, changes: Change[]) =>
    request<{ accepted: number; known: number }>('POST', `/projects/${project}/changes`, {
      device,
      changes,
    }),
  hello: (project: string, device: string, machine: string) =>
    request<void>('POST', `/projects/${project}/hello`, { device, machine }),

  /** Downloads a file's content, reporting progress from 0 to 1. */
  async blob(
    project: string,
    sha256: string,
    onProgress?: (fraction: number) => void,
  ): Promise<Uint8Array> {
    const response = await fetch(url(`/projects/${project}/blobs/${sha256}`), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok || !response.body) {
      if (response.status === 401) setToken(null);
      throw new ApiError(response.status, `The file could not be downloaded (${response.status}).`);
    }
    const total = Number(response.headers.get('content-length')) || 0;
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      received += value.length;
      if (total) onProgress?.(received / total);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return bytes;
  },
};
