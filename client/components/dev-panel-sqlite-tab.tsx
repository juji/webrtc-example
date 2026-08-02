"use client";

import { useEffect, useState } from "react";
import { useDbStore } from "@/lib/db-store";

// Dev-only debug view — browse the PrimssgDB SQLite data without any external
// viewer package (none fit: the only npm candidate bundles its own, conflicting
// sql.js runtime — see plans/sqlite-migration). Runs debugQuery() against the
// live connection directly. Uses the app's shared useDbStore connection rather
// than its own instance — only one PrimssgDBWasm may hold the SAHPool-locked
// DB per tab, so a second instance here would race the app's own connection.
export function SqliteTab() {
  const db = useDbStore((s) => s.db);
  const connected = useDbStore((s) => s.connected);
  const locked = useDbStore((s) => s.locked);
  const connect = useDbStore((s) => s.connect);
  const [sql, setSql] = useState("SELECT * FROM keys");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    connect();
  }, [connect]);

  async function runQuery() {
    setError(null);
    try {
      const result = await db.debugQuery(sql);
      setColumns(result.columns);
      setRows(result.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setColumns([]);
      setRows([]);
    }
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-sm text-zinc-500">
        {locked ? "Already open in another tab — close it and reload" : connected ? "Connected" : "Connecting…"}
      </p>

      <div className="flex flex-wrap gap-2">
        {["keys", "contacts", "conversations", "messages"].map((table) => (
          <button
            key={table}
            onClick={() => setSql(`SELECT * FROM ${table}`)}
            className="rounded-full border border-black/10 px-3 py-1 text-sm dark:border-white/10"
          >
            {table}
          </button>
        ))}
      </div>

      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        rows={3}
        className="w-full rounded-lg border border-black/10 bg-transparent p-2 font-mono text-sm dark:border-white/10"
      />
      <button
        onClick={runQuery}
        disabled={!connected}
        className="w-fit rounded-full px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        style={{ backgroundColor: "#ea580c" }}
      >
        Run
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {columns.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c} className="border-b border-black/10 px-2 py-1 text-left dark:border-white/10">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                // biome-ignore lint: query result rows have no stable id
                <tr key={i}>
                  {row.map((cell, j) => (
                    // biome-ignore lint: same as above
                    <td key={j} className="border-b border-black/5 px-2 py-1 dark:border-white/5">
                      {formatCell(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value instanceof Uint8Array) return `<${value.byteLength} bytes>`;
  if (value === null || value === undefined) return "NULL";
  return String(value);
}
