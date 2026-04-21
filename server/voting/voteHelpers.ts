import type { Session } from "../types.js";

export function voterNames(
  pids: Set<string>,
  sessions: Map<string, Session>
): string[] {
  return Array.from(pids).map((pid) => sessions.get(pid)?.name || "Unknown");
}

export function currentVoteOf(
  pid: string,
  yes: Set<string>,
  no: Set<string>
): "yes" | "no" | null {
  if (yes.has(pid)) return "yes";
  if (no.has(pid)) return "no";
  return null;
}
