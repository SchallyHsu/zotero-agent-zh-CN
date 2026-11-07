import { test } from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "../../src/agent/runtime.ts";
import { BACKENDS, resumeCommand } from "../../src/agent/backends.ts";
import { withDefaults } from "../../src/zotero/defaults.ts";
import type { BackendId, ChatEvent, Proc, Spawner } from "../../src/types.ts";

function native(backend: "antigravity" | "deepseek-harness", override?: string) {
  const messages: any[] = [], spawned: { command: string; args: string[]; env: Record<string, string> }[] = [];
  let stdout: (l: string) => void = () => {};
  let onExit!: (n: number) => void;
  const exited = new Promise<number>((r) => { onExit = r; });
  let promptId: number | null = null;
  const options = [{ id: "model", name: "Model", category: "model", currentValue: "provider/model-a", options: [{ group: "provider", options: [{ value: "provider/model-a", name: "Model A" }, { value: "provider/model-b", name: "Model B" }] }] },
    { id: "reasoning_effort", name: "Reasoning", category: "thought_level", currentValue: "high", options: [{ value: "high", name: "High" }, { value: "low", name: "Low" }] }];
  const emit = (v: unknown) => queueMicrotask(() => stdout(JSON.stringify(v)));
  const proc: Proc = { pid: 1, exited, onStdoutLine(cb) { stdout = cb; }, onStderr() {}, kill: async () => { onExit(0); }, write(line) {
    const m = JSON.parse(line); messages.push(m);
    if (!m.method && m.id === 1000) {
      assert.equal(m.result.outcome.optionId, "allow");
      emit({ method: "session/update", params: { sessionId: "native-id", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Native backend reply" } } } });
      emit({ id: promptId, result: { stopReason: "end_turn" } }); return;
    }
    if (m.method === "session/prompt") {
      promptId = m.id;
      emit({ id: 1000, method: "session/request_permission", params: { sessionId: "native-id", toolCall: { toolCallId: "tool", title: "Read fixture", kind: "read" }, options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }, { optionId: "reject", name: "Reject", kind: "reject_once" }] } }); return;
    }
    if (m.id === undefined) return;
    const result = m.method === "initialize" ? { protocolVersion: 1, agentCapabilities: { loadSession: false, sessionCapabilities: { resume: {}, close: {} }, promptCapabilities: { image: true } } }
      : m.method === "session/new" || m.method === "session/resume" ? { sessionId: "native-id", configOptions: options }
      : m.method === "session/set_config_option" ? { configOptions: options.map(o => o.id === m.params.configId ? { ...o, currentValue: m.params.value } : o) } : {};
    emit({ id: m.id, result });
  } };
  const spawner: Spawner = { windows: true,
    baseEnv: async () => ({ PATH: "C:\\tools", SystemRoot: "C:\\Windows", GEMINI_API_KEY: "fixture-parent-key" }),
    run: async (_command, args) => {
      if (args[0] === "-e") return { code: 0, stdout: `${override}\n`, stderr: "" };
      const name = args[0];
      return { code: name === "node" || name === BACKENDS[backend].cli!.name || name === override ? 0 : 1,
        stdout: name === "node" ? "C:\\tools\\node.exe\r\n" : name === BACKENDS[backend].cli!.name || name === override ? `${override || `C:\\tools\\${name}.cmd`}\r\n` : "", stderr: "" };
    },
    spawn: async (command, args, o) => { spawned.push({ command, args, env: o.env }); return proc; },
  };
  return { runtime: createRuntime({ spawner, bridgeDir: "C:\\unused", executable: () => override }), messages, spawned };
}

for (const backend of ["antigravity", "deepseek-harness"] as const) {
  test(`${backend}: native launch, grouped models, effort, permissions and graceful close`, async () => {
    const h = native(backend);
    const detected = await h.runtime.detect();
    assert.equal(detected.find(b => b.id === backend)?.available, true, "native agents must work without npm bridges");
    const s = await h.runtime.start({ backend, cwd: "C:\\papers", brief: "Zotero fixture", auth: "subscription" });
    assert.deepEqual(h.spawned[0]!.args, BACKENDS[backend].directArgs);
    assert.deepEqual(s.models().map(m => m.id), ["provider/model-a", "provider/model-b"]);
    assert.equal(s.supportsImages, true);
    assert.deepEqual(s.modes(), []);
    await s.setModel("provider/model-b");
    await s.setEffort("low");
    assert(h.messages.some(m => m.params?.configId === "reasoning_effort" && m.params.value === "low"));
    const events: ChatEvent[] = [];
    s.on(e => { events.push(e); if (e.t === "permission") s.respondPermission(e.id, "allow"); });
    await s.prompt({ text: "fixture question" });
    assert(events.some(e => e.t === "text" && e.delta === "Native backend reply"));
    assert(events.some(e => e.t === "turn_end" && e.stop === "end_turn"));
    if (backend === "antigravity") assert.equal(h.spawned[0]!.env.GEMINI_API_KEY, undefined, "subscription mode strips API keys");
    await s.close();
    assert(h.messages.some(m => m.method === "session/close"));
  });
  test(`${backend}: resume uses session/resume and a path with spaces remains one executable`, async () => {
    const path = "C:\\Program Files\\Agent Tools\\native.exe";
    const h = native(backend, path);
    const s = await h.runtime.start({ backend, cwd: "C:\\papers", brief: "fixture", resumeSessionId: "native-id" });
    assert.equal(h.spawned[0]!.command, path);
    assert(h.messages.some(m => m.method === "session/resume" && m.params.sessionId === "native-id"));
    assert(!h.messages.some(m => m.method === "session/load"));
    await s.close();
  });
  test(`${backend}: unverified tool-free translation is rejected before any prompt`, async () => {
    const h = native(backend);
    await assert.rejects(h.runtime.start({ backend, cwd: "C:\\papers", brief: "fixture", locked: true }), /translation mode/);
    assert.equal(h.spawned.length, 0);
  });
}

test("Antigravity resumes a pre-created App project conversation and still sends the Zotero brief once", async () => {
  const h = native("antigravity");
  const s = await h.runtime.start({ backend: "antigravity", cwd: "C:\\papers", brief: "Zotero first prompt brief", resumeSessionId: "prepared-native-id", freshNativeSession: true, antigravityStorage: { geminiDir: "C:\\Gemini Store" } });
  assert.deepEqual(h.spawned[0]!.args, ["acp", "--gemini-dir", "C:\\Gemini Store", "--app-data-dir", "antigravity"]);
  assert(h.messages.some(m => m.method === "session/resume" && m.params.sessionId === "prepared-native-id"));
  s.on(ev => { if (ev.t === "permission") s.respondPermission(ev.id, "allow"); });
  await s.prompt({ text: "fixture question" });
  assert(JSON.stringify(h.messages.find(m => m.method === "session/prompt")?.params).includes("Zotero first prompt brief"));
  await s.close();
});

test("old preferences acquire independent settings for both new backends", () => {
  const s = withDefaults({ model: { "claude-code": "legacy" } as any });
  assert.equal(s.model["claude-code"], "legacy");
  for (const b of ["antigravity", "deepseek-harness"] as BackendId[]) { assert.equal(s.model[b], ""); assert.equal(s.effort[b], ""); }
  assert.equal(resumeCommand("deepseek-harness", "C:/papers", "native-id"), null);
});
