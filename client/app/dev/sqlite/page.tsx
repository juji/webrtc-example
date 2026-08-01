"use client";

import { PrimssgDBWasm } from "primssg-db";
import { useEffect, useRef, useState } from "react";

// Dev-only debug page — browse the PrimssgDB SQLite data without any external
// viewer package (none fit: the only npm candidate bundles its own, conflicting
// sql.js runtime — see plans/sqlite-migration). Runs debugQuery() against the
// live connection directly.
export default function DevSqlitePage() {
  const dbRef = useRef<PrimssgDBWasm | null>(null);
  const [connected, setConnected] = useState(false);
  const [sql, setSql] = useState("SELECT * FROM keys");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const db = new PrimssgDBWasm();
    dbRef.current = db;
    db.connect().then(() => setConnected(true));
    return () => {
      db.disconnect();
    };
  }, []);

  async function runQuery() {
    if (!dbRef.current) return;
    setError(null);
    try {
      const result = await dbRef.current.debugQuery(sql);
      setColumns(result.columns);
      setRows(result.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setColumns([]);
      setRows([]);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">/dev/sqlite</h1>
      <p className="text-sm text-zinc-500">{connected ? "Connected" : "Connecting…"}</p>

      <div className="flex flex-wrap gap-2">
        {["keys", "contacts", "conversations"].map((table) => (
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
