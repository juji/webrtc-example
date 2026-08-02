"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { loginOrRegister } from "@/lib/api";
import { useSessionStore } from "@/lib/session-store";

export default function Home() {
  const router = useRouter();
  const user = useSessionStore((s) => s.user);
  const hasHydrated = useSessionStore((s) => s.hasHydrated);
  const setUser = useSessionStore((s) => s.setUser);
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (hasHydrated && user) router.replace("/chat");
  }, [hasHydrated, user, router]);

  if (!hasHydrated || user) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await loginOrRegister(username);
      setUser(user);
      router.push("/chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : "something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-black/10 bg-white p-8 dark:border-white/10 dark:bg-zinc-900"
      >
        <h1 className="text-xl font-semibold">
          Enter a username
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          New usernames are registered automatically. Existing ones just log you in.
        </p>
        <input
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="username"
          className="rounded border border-black/10 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/10 dark:focus:border-white/40"
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={loading || !username.trim()}
          className="rounded bg-foreground px-4 py-2 font-medium text-background disabled:opacity-50"
        >
          {loading ? "..." : "Continue"}
        </button>
      </form>
    </div>
  );
}
