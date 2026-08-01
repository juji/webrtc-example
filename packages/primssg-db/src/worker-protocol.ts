import type { PrimssgDB } from "./primssg-db";

// Every PrimssgDB method (minus connect/disconnect, which the worker handles
// on its own lifecycle) becomes one request/response pair over postMessage.
type MethodName = Exclude<keyof PrimssgDB, "connect" | "disconnect">;

export type WorkerRequest = {
  id: number;
  method: MethodName;
  args: unknown[];
};

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
