export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";
export const SIGNALING_URL = SERVER_URL.replace(/^http/, "ws");

export type User = {
  id: number;
  username: string;
  createdAt: string;
};

export async function loginOrRegister(username: string): Promise<User> {
  const res = await fetch(`${SERVER_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "login failed");
  const { user } = await res.json();
  return user;
}

export async function searchUsers(query: string, exclude: string): Promise<User[]> {
  const params = new URLSearchParams({ q: query, exclude });
  const res = await fetch(`${SERVER_URL}/users?${params}`);
  const { users } = await res.json();
  return users;
}
