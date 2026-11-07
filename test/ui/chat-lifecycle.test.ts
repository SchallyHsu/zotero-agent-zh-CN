import { test } from "node:test";
import assert from "node:assert/strict";
import { Chat } from "../../src/ui/chat.ts";
import { FakeHost } from "../../src/ui/fake-host.ts";
import { env } from "../../src/ui/dom.ts";

env.win = globalThis as unknown as typeof env.win;
function makeChat(host: FakeHost) {
  return new Chat({ host, onChange() {}, blockReason: () => null, turnEnded() {}, setupFailed() {}, sessionChanged() {}, shownChanged() {}, expand: async (t) => t });
}

test("a saved chat resumes its original backend and folder after settings change", async () => {
  const h = new FakeHost({ speed: 0, noHistory: true });
  const c = makeChat(h);
  h.sim.nextAnswer = "first reply";
  await c.send("first question", h.currentContext());
  const saved = c.saved!;
  assert.equal(saved.paper?.itemKey, h.currentPaper()?.itemKey);
  await h.setSettings({ backend: "codex", chatFolder: "/different", projectName: "Different" });
  await c.load(saved);
  h.sim.nextAnswer = "continued";
  await c.send("continue", h.currentContext());
  assert.equal(c.session?.backend, "claude-code");
  assert.equal(c.saved?.cwd, saved.cwd);
  assert.equal(c.saved?.agentSessionId, saved.agentSessionId);
  assert.equal(c.saved?.projectName, "Zotero Agent");
  assert.equal(c.saved?.lastOpenedAt! >= saved.lastOpenedAt!, true);
  await c.reset();
});

test("a failed prompt releases the busy state and the next send resumes the conversation", async () => {
  const h = new FakeHost({ speed: 0, noHistory: true });
  const c = makeChat(h);
  h.sim.startFails = "prompt";
  await c.send("question", h.currentContext());
  assert.equal(c.busy, false);
  const id = c.saved!.id;
  h.sim.nextAnswer = "recovered";
  await c.send("try again", h.currentContext());
  assert.equal(c.saved!.id, id);
  assert.equal(c.busy, false);
  await c.reset();
});

test("a delayed session start cannot overwrite a new chat", async () => {
  const h = new FakeHost({ speed: 0, noHistory: true });
  const c = makeChat(h);
  const start = h.runtime.start;
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const ready = new Promise<void>((r) => { entered = r; });
  h.runtime.start = async (o) => { entered(); await gate; return start(o); };
  const sending = c.send("old question", h.currentContext());
  await ready;
  await c.reset();
  release();
  await sending;
  assert.equal(c.saved, null);
  assert.equal(c.session, null);
  assert.equal(c.busy, false);
  assert.equal(c.tr.messages.length, 0);
  assert.equal(h.sim.prompts.length, 0);
});

test("a DSH project is queued before a long reply completes", async () => {
  const h = new FakeHost({ speed: 0, noHistory: true });
  await h.setSettings({ backend: "deepseek-harness" });
  const c = makeChat(h);
  let calls = 0;
  h.syncSession = async s => { calls++; return { ...s, syncPending: true }; };
  const original = h.runtime.start;
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(r => { enter = r; });
  const gate = new Promise<void>(r => { release = r; });
  h.runtime.start = async o => {
    const s = await original(o), prompt = s.prompt.bind(s);
    s.prompt = async input => { enter(); await gate; await prompt(input); };
    return s;
  };
  h.sim.nextAnswer = "done";
  const sending = c.send("question", h.currentContext());
  await entered;
  assert.equal(c.busy, true);
  assert.equal(calls, 1);
  release(); await sending; await c.reset();
});

test("Antigravity defers metadata refresh until after the reply instead of starting a second service before first output", async () => {
  const h = new FakeHost({ speed: 0, noHistory: true });
  await h.setSettings({ backend: "antigravity" });
  const c = makeChat(h);
  let calls = 0;
  h.syncSession = async s => { calls++; return s; };
  const start = h.runtime.start;
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(r => { enter = r; }), gate = new Promise<void>(r => { release = r; });
  h.runtime.start = async o => { const s = await start(o), prompt = s.prompt.bind(s); s.prompt = async input => { enter(); await gate; await prompt(input); }; return s; };
  h.sim.nextAnswer = "done";
  const sending = c.send("question", h.currentContext());
  await entered;
  assert.equal(calls, 0);
  release(); await sending;
  assert.equal(calls, 1);
  await c.reset();
});
