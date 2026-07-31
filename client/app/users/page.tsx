"use client";

import { useRouter } from "next/navigation";
import { useSessionStore } from "@/lib/session-store";
import { useRequireSession } from "@/lib/use-require-session";

export default function UsersPage() {
  const router = useRouter();
  const user = useRequireSession();
  const logout = useSessionStore((s) => s.logout);

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
    </div>
  );
}
