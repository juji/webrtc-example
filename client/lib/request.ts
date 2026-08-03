const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

// Thin wrapper around fetch for calls to our own server: prefixes SERVER_URL,
// always sends the session cookie, and throws with the server's { error }
// message on non-2xx so callers don't each repeat that boilerplate.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, { credentials: "include", ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `${init?.method ?? "GET"} ${path} failed`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

function withBody<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  return request<T>(path, {
    method,
    headers: { "Content-Type": "application/json", ...init?.headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...init,
  });
}

export function GET<T>(path: string, init?: RequestInit): Promise<T> {
  return request(path, init);
}

export function POST<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  return withBody<T>("POST", path, body, init);
}

export function PUT<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  return withBody<T>("PUT", path, body, init);
}

export function PATCH<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  return withBody<T>("PATCH", path, body, init);
}
