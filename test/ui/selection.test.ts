import { test } from "node:test";
import assert from "node:assert/strict";
import type { ContextChip, ChatEvent } from "../../src/types.ts";
import { chipTarget, summary } from "../../src/ui/context.ts";
import { chipHash } from "../../src/ui/economy.ts";
import { replay } from "../../src/ui/transcript.ts";

test("a long selection keeps its full original text and exact position through saved history replay", () => {
  const c: ContextChip = { id: "selection:PDF00001", kind: "selection", label: "Text Selection", auto: true, pinned: false,
    ref: { libraryID: 2, attachmentKey: "PDF00001", pageIndex: 3, pageLabel: "iv", position: { pageIndex: 3, rects: [[1, 2, 3, 4]], nextPageRects: [[5, 6, 7, 8]] } },
    text: "History Settings <script>original text</script> 选区原文\n".repeat(100) };
  const events: ChatEvent[] = [{ t: "user", id: "q", text: "解释一下", chips: [summary(c)] }];
  const msg = replay(JSON.parse(JSON.stringify(events))).messages[0]!;
  assert.equal(msg.role, "user");
  if (msg.role !== "user") return;
  assert.equal(msg.chips[0]!.text, c.text);
  assert.deepEqual(chipTarget(msg.chips[0]!), { ...c.ref, quote: c.text });
  assert.notEqual(chipHash(c), chipHash({ ...c, ref: { ...c.ref, position: { pageIndex: 3, rects: [[9, 10, 11, 12]] } } }), "same words at a different position are a new selection");
});

test("old selection chips gain a quote target; ordinary item chips keep their original target", () => {
  const ref = { libraryID: 1, attachmentKey: "PDF00001", pageIndex: 7 };
  const c = { id: "old", kind: "selection" as const, label: "Text Selection", ref, text: "the original passage" };
  assert.deepEqual(chipTarget(c), { ...ref, quote: c.text });
  assert.equal(chipTarget({ ...c, kind: "item" }), ref);
  assert.equal(chipTarget({ ...c, text: undefined }), ref);
});
