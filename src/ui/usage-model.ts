import type { Usage } from "../types.ts";
import type { TranscriptState } from "./transcript.ts";

const valid = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Sum only reported fields, including real zeroes. Missing data never becomes a fabricated zero. */
export function conversationUsage(tr: TranscriptState): { total: Usage; last?: Usage; turns: number; reported: number } {
  const total: Usage = {};
  let last: Usage | undefined, turns = 0, reported = 0;
  for (const m of tr.messages) {
    if (m.role !== "assistant" || !m.done) continue;
    turns++;
    last = m.usage;
    const u = m.usage;
    if (!u) continue;
    if (valid(u.inputTokens) || valid(u.outputTokens)) reported++;
    for (const k of ["inputTokens", "outputTokens", "costUsd"] as const) {
      if (valid(u[k])) total[k] = (total[k] ?? 0) + u[k];
    }
  }
  return { total, last, turns, reported };
}
