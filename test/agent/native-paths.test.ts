import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findCli, BACKENDS } from "../../src/agent/backends.ts";
import { createNodeSpawner } from "../node-spawner.ts";

test("real Windows executable lookup accepts a custom path with spaces and rejects absent/unsupported files", { skip: process.platform !== "win32" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "zmc native path "));
  const path = join(dir, "dsh.cmd");
  writeFileSync(path, "@echo off\r\n");
  const env = { ...process.env, PATH: process.env.PATH || process.env.Path || "" } as Record<string, string>;
  const spawner = { ...createNodeSpawner({ baseEnv: env }), windows: true };
  try {
    assert.equal(await findCli(spawner, env, BACKENDS["deepseek-harness"], path), path);
    assert.equal(await findCli(spawner, env, BACKENDS["deepseek-harness"], join(dir, "absent.exe")), null);
    assert.equal(await findCli(spawner, env, BACKENDS.antigravity, join(dir, "wrong.ps1")), null);
  } finally {
    const target = resolve(dir);
    assert(target.startsWith(resolve(tmpdir())) && target.includes("zmc native path "));
    rmSync(target, { recursive: true, force: true });
  }
});
