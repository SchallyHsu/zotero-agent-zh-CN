import { test } from "node:test";
import assert from "node:assert/strict";
import { codexAccountUsage, readAccountUsage } from "../../src/agent/account-usage.ts";
import type { Proc, Spawner } from "../../src/types.ts";
import { createRuntime } from "../../src/agent/runtime.ts";

const bucket = { limitId: "codex", planType: "plus", primary: { usedPercent: 27.5, windowDurationMins: 300, resetsAt: 1_800_000_000 }, secondary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: null } };

test("single and multi bucket limits retain zeroes, reset units and distinct model limits", () => {
  const result = codexAccountUsage({ rateLimits: bucket, rateLimitsByLimitId: { codex: bucket, special: { limitName: "Special", primary: { usedPercent: 101, windowDurationMins: 15 } } } }, 100);
  assert.equal(result.plan, "plus");
  assert.equal(result.windows.length, 3);
  assert.deepEqual(result.windows[0], { id: "codex/primary", label: "5小时", usedPercent: 27.5, resetsAt: 1_800_000_000_000 });
  assert.equal(result.windows[1]?.label, "7天");
  assert.equal(result.windows[1]?.usedPercent, 0);
  assert.equal(result.windows[1]?.resetsAt, undefined);
  assert.equal(result.windows[2]?.label, "Special · 15分钟");
  assert.equal(result.windows[2]?.usedPercent, 100);
  assert.deepEqual(codexAccountUsage({ rateLimits: bucket }, 100).windows, result.windows.slice(0, 2));
});

test("missing, negative, non-finite and malformed usage is unknown, never 100% remaining", () => {
  for (const value of [null, {}, { rateLimits: { primary: {} } }, { rateLimits: { primary: { usedPercent: -1 } } }, { rateLimits: { primary: { usedPercent: NaN } } }, { rateLimits: { primary: { usedPercent: "20" } } }]) {
    const result = codexAccountUsage(value);
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.windows, []);
  }
});

function harness(fail?: string, hang = false) {
  const calls: { method: string; params?: unknown }[] = [];
  let killed = 0;
  let spawned = 0;
  let stdout: (line: string) => void = () => {};
  const proc: Proc = { pid: 1, exited: new Promise(() => {}), onStdoutLine: cb => { stdout = cb; }, onStderr: () => {}, kill: async () => { killed++; },
    write(line) {
      const message = JSON.parse(line);
      calls.push(message);
      if (message.id === undefined || hang) return;
      queueMicrotask(() => stdout(JSON.stringify(message.method === fail ? { id: message.id, error: { code: -32601, message: "unsupported; SECRET should not reach UI" } }
        : { id: message.id, result: message.method === "account/rateLimits/read" ? { rateLimits: bucket } : {} })));
    } };
  const spawner: Spawner = { windows: true,
    baseEnv: async () => ({ PATH: "C:\\bin", OPENAI_API_KEY: "SECRET" }),
    run: async () => ({ code: 0, stdout: "C:\\bin\\codex.exe\r\n", stderr: "" }),
    spawn: async (_command, args, options) => { spawned++; assert.deepEqual(args, ["app-server"]); assert.equal(options.env.OPENAI_API_KEY, undefined); return proc; } };
  return { spawner, calls, killed: () => killed, spawned: () => spawned };
}

test("account query handshakes and closes without creating any model thread/session", async () => {
  const h = harness();
  const result = await readAccountUsage(h.spawner, "codex", "subscription");
  assert.equal(result.status, "available");
  assert.deepEqual(h.calls.map(c => c.method), ["initialize", "initialized", "account/rateLimits/read"]);
  assert.equal(h.killed(), 1);
});

test("API keys and unsupported backends do not start any process", async () => {
  const h = harness();
  assert.equal((await readAccountUsage(h.spawner, "codex", "api-key")).status, "api-key");
  assert.equal((await readAccountUsage(h.spawner, "claude-code", "subscription")).status, "unsupported");
  assert.equal(h.spawned(), 0);
});

test("old CLI and a hung server fail safely and always clean up", async () => {
  const old = harness("account/rateLimits/read");
  const result = await readAccountUsage(old.spawner, "codex", "subscription");
  assert.equal(result.status, "unavailable");
  assert.match(result.message!, /版本不支持/);
  assert(!JSON.stringify(result).includes("SECRET"));
  assert.equal(old.killed(), 1);
  const hung = harness(undefined, true);
  assert.equal((await readAccountUsage(hung.spawner, "codex", "subscription", undefined, 15)).status, "unavailable");
  assert(hung.killed() >= 1);
});

test("provider-managed backends query their helper even with the legacy API auth preference", async () => {
  const inputs: any[] = [];
  const spawner: Spawner = { windows: true, baseEnv: async () => ({ PATH: "C:\\bin" }), spawn: async () => { throw Error("must not start model/ACP"); },
    run: async (_command, args) => {
      if (args[0] === "C:\\helpers\\account-usage.mjs") {
        inputs.push(JSON.parse(args[1]!));
        return { code: 0, stdout: JSON.stringify({ status: "available", checkedAt: 1, windows: [], balances: [{ label: "余额", remaining: "0", currency: "CNY" }] }), stderr: "" };
      }
      return { code: 0, stdout: "C:\\bin\\dsh.cmd\r\n", stderr: "" };
    } };
  const runtime = createRuntime({ spawner, bridgeDir: "unused", nodePath: "C:\\bin\\node.exe", accountUsageHelper: async () => "C:\\helpers\\account-usage.mjs" });
  assert.equal((await runtime.accountUsage!("deepseek-harness", "api-key", '["deepseek-official","deepseek-flash"]')).status, "available");
  assert.equal((await runtime.accountUsage!("pi", "api-key", "anthropic/sonnet")).status, "available");
  assert.deepEqual(inputs, [{ backend: "deepseek-harness", model: '["deepseek-official","deepseek-flash"]', cli: "C:\\bin\\dsh.cmd" }, { backend: "pi", model: "anthropic/sonnet" }]);
});
