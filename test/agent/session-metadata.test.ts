import { test } from "node:test";
import assert from "node:assert/strict";
import { syncSessionMetadata } from "../../src/agent/session-metadata.ts";
import type { Proc, SavedSession, Spawner } from "../../src/types.ts";

const s: SavedSession = { id: "local", title: "中文 \"name\" $(literal)", backend: "codex", cwd: "C:\\Zotero\\Zotero Agent", agentSessionId: "native-id", projectName: "Zotero Agent", updatedAt: 10 };
function harness(fail?: string, existing = false) {
  const calls: { method: string; params: any }[] = [];
  let killed = false;
  let stdout: (line: string) => void = () => {};
  const proc: Proc = { pid: 1, exited: new Promise(() => {}), onStdoutLine: (cb) => { stdout = cb; }, onStderr: () => {}, kill: async () => { killed = true; },
    write(data) {
      const msg = JSON.parse(data); calls.push(msg);
      if (!msg.id) return;
      const project = { id: "project-1", name: s.projectName, roots: [{ path: existing ? "C:/old" : s.cwd }], metadata: { source: "zotero-agent" } };
      const result = msg.method === "project/list" ? { data: existing ? [project] : [], nextCursor: null } : msg.method === "project/create" ? { project } : {};
      queueMicrotask(() => stdout(JSON.stringify(msg.method === fail ? { id: msg.id, error: { code: -32601, message: "not supported" } } : { id: msg.id, result })));
    } };
  const spawner: Spawner = { windows: true, baseEnv: async () => ({ PATH: "C:\\bin", SystemRoot: "C:\\Windows" }), spawn: async () => proc,
    run: async () => ({ code: 0, stdout: "C:\\bin\\codex.exe\r\n", stderr: "" }) };
  return { spawner, calls, killed: () => killed };
}
test("native sync names the original ACP thread, creates its project idempotently, and never prompts", async () => {
  const h = harness();
  assert.deepEqual(await syncSessionMetadata(h.spawner, "bridges", s), { backendProjectId: "project-1", backendProjectRoots: [s.cwd] });
  assert.deepEqual(h.calls.map((c) => c.method), ["initialize", "initialized", "thread/name/set", "project/list", "project/create", "thread/metadata/update"]);
  assert.equal(h.calls[2]?.params.name, s.title);
  assert.equal(h.calls[4]?.params.idempotencyKey, "zotero-agent:Zotero Agent");
  assert.equal(h.calls[5]?.params.projectId, "project-1");
  assert(h.killed());
});
test("unsupported backend project API reports failure and closes the process", async () => {
  const h = harness("project/create");
  await assert.rejects(syncSessionMetadata(h.spawner, "bridges", s), /not supported/);
  assert(h.killed());
});
test("legacy and new working folders share one named native project", async () => {
  const h = harness(undefined, true);
  await syncSessionMetadata(h.spawner, "bridges", s);
  assert(!h.calls.some((c) => c.method === "project/create"));
  assert.deepEqual(h.calls.find((c) => c.method === "project/update")?.params.roots, [{ path: "C:/old" }, { path: s.cwd }]);
});
test("DSH uses its companion helper, sends only project metadata and keeps pending distinct from success", async () => {
  const calls: string[][] = [];
  let confirmed = false;
  const spawner: Spawner = {
    windows: true, baseEnv: async () => ({ PATH: "C:\\bin", SystemRoot: "C:\\Windows" }),
    spawn: async () => { throw new Error("no ACP or model process should start"); },
    run: async (_command, args) => {
      if (args[0] === "node") return { code: 0, stdout: "C:\\bin\\node.exe\r\n", stderr: "" };
      calls.push(args);
      return { code: 0, stdout: JSON.stringify(confirmed ? { backendProjectId: "dsh-workspace-1", syncPending: false } : { syncPending: true }), stderr: "" };
    },
  };
  const session = { ...s, backend: "deepseek-harness" as const };
  assert.deepEqual(await syncSessionMetadata(spawner, "unused", session, { dshHelper: "C:\\helper.mjs" }), { syncPending: true });
  const payload = JSON.parse(calls[0]![1]!);
  assert.deepEqual(Object.keys(payload).sort(), ["agentSessionId", "cwd", "projectName"]);
  assert.equal(payload.agentSessionId, session.agentSessionId);
  confirmed = true;
  assert.deepEqual(await syncSessionMetadata(spawner, "unused", session, { dshHelper: "C:\\helper.mjs" }), { backendProjectId: "dsh-workspace-1", syncPending: false });
});
