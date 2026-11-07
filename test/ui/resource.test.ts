import { test } from "node:test";
import assert from "node:assert/strict";
import { readPackagedText } from "../../src/zotero/resource.ts";

test("packaged helpers use a UTF-8 Gecko channel for jar URLs containing @, never HTTP URI credentials", async () => {
  const g = globalThis as any;
  const old = { Zotero: g.Zotero, ChromeUtils: g.ChromeUtils, Ci: g.Ci };
  const uri = "jar:file:///C:/Zotero Profile/extensions/chat@zotero-mcp.xpi!/assets/codex-desktop-projects.mjs";
  const channel = { uri, get username(): never { throw Error("nsIURI.username must not be queried"); } };
  try {
    g.Ci = { nsILoadInfo: { SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL: 1 }, nsIContentPolicy: { TYPE_OTHER: 2 } };
    g.ChromeUtils = { importESModule(name: string) { assert.equal(name, "resource://gre/modules/NetUtil.sys.mjs"); return { NetUtil: { newChannel(options: any) { assert.deepEqual(options, { uri, loadUsingSystemPrincipal: true, securityFlags: 1, contentPolicyType: 2 }); return channel; } } }; } };
    g.Zotero = { File: { getContentsAsync: async (source: any, encoding: string) => { assert.equal(source, channel); assert.equal(encoding, "UTF-8"); return "// 原生项目脚本"; }, getContentsFromURLAsync: () => { throw Error("Wrong HTTP transport"); } }, HTTP: { request: () => { throw Error("Wrong HTTP transport"); } } };
    assert.equal(await readPackagedText("jar:file:///C:/Zotero Profile/extensions/chat@zotero-mcp.xpi!/", "assets/codex-desktop-projects.mjs"), "// 原生项目脚本");
  } finally { Object.assign(g, old); }
});
