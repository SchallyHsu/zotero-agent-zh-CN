import { test } from "node:test";
import assert from "node:assert/strict";
import { conversationUsage } from "../../src/ui/usage-model.ts";
import { applyEvent, emptyTranscript } from "../../src/ui/transcript.ts";

test("usage totals count reported completed turns, retain partial fields and do not reuse an earlier last turn", () => {
  let tr = emptyTranscript();
  tr = applyEvent(tr, { t: "turn_end", turn: "a", stop: "end_turn", usage: { inputTokens: 10, outputTokens: 0, costUsd: 0 } });
  tr = applyEvent(tr, { t: "turn_end", turn: "b", stop: "cancelled", usage: { outputTokens: 7 } });
  tr = applyEvent(tr, { t: "turn_start", turn: "streaming" });
  assert.deepEqual(conversationUsage(tr), { total: { inputTokens: 10, outputTokens: 7, costUsd: 0 }, last: { outputTokens: 7 }, turns: 2, reported: 2 });
  tr = applyEvent(tr, { t: "turn_end", turn: "streaming", stop: "error" });
  assert.equal(conversationUsage(tr).last, undefined);
  assert.equal(conversationUsage(tr).turns, 3);
  assert.equal(conversationUsage(tr).reported, 2);
});

test("missing and invalid data stays unknown rather than displaying a zero", () => {
  const tr = applyEvent(emptyTranscript(), { t: "turn_end", turn: "a", stop: "end_turn", usage: { inputTokens: -1, outputTokens: NaN, costUsd: Infinity } });
  assert.deepEqual(conversationUsage(tr).total, {});
  assert.equal(conversationUsage(tr).reported, 0);
});
