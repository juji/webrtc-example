import type { PrimssgDB } from "./primssg-db";

// Every PrimssgDB method (minus connect/disconnect, which the worker handles
// on its own lifecycle) becomes one request/response pair over postMessage.
// "debugQuery" is not part of PrimssgDB — it's a dev-only raw-SQL escape hatch
// used solely by the /dev/sqlite page, reached only through a concrete
// PrimssgDBWasm reference, never through the PrimssgDB interface real callers use.
type MethodName = Exclude<keyof PrimssgDB, "connect" | "disconnect"> | "debugQuery";

export type WorkerRequest = {
  id: number;
  method: MethodName;
  args: unknown[];
};

export type DebugQueryResult = { columns: string[]; rows: unknown[][] };

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
