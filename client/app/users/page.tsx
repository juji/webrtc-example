"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { searchUsers, type User } from "@/lib/api";
import { useSessionStore } from "@/lib/session-store";
import { useRequireSession } from "@/lib/use-require-session";

export default function UsersPage() {
  const router = useRouter();
  const user = useRequireSession();
  const logout = useSessionStore((s) => s.logout);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);

  useEffect(() => {
    if (!user) return;
    searchUsers(query, user.username).then(setResults);
  }, [query, user]);

  if (!user) return null;

  function handleLogout() {
    logout();
    router.push("/");
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">
          Hi, {user.username}
        </h1>
        <button
          onClick={handleLogout}
          className="text-sm text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          Log out
        </button>
      </div>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search users..."
        className="rounded border border-black/10 bg-transparent px-3 py-2 text-black outline-none focus:border-black/40 dark:border-white/10 dark:text-zinc-50 dark:focus:border-white/40"
      />
      <ul className="flex flex-col gap-2">
        {results.map((u) => (
          <li key={u.id}>
            <button
              onClick={() => router.push(`/chat/${u.username}`)}
              className="w-full rounded border border-black/10 px-3 py-2 text-left text-black hover:bg-black/5 dark:border-white/10 dark:text-zinc-50 dark:hover:bg-white/5"
            >
              {u.username}
            </button>
          </li>
        ))}
        {results.length === 0 && (
          <li className="text-sm text-zinc-500">No users found.</li>
        )}
      </ul>
    </div>
  );
}
