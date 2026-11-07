// Native project/session management; never submits a model prompt. Antigravity
// legacy sessions continue via a native fork that preserves the original.
import type { SavedSession, Spawner } from "../types.ts";
import { cleanEnv, findBinary } from "./env.ts";
import { JsonRpcPeer } from "./jsonrpc.ts";
import { backendOf, findCli } from "./backends.ts";

const SDK_RENAME = String.raw`
const {createRequire}=require('node:module');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const [bridgeDir,backend,id,title,cwd]=process.argv.slice(1);
(async()=>{
 const req=createRequire(path.join(bridgeDir,'node_modules',backend==='claude-code'?'@agentclientprotocol/claude-agent-acp':'pi-acp','package.json'));
 if(backend==='claude-code') {
  const sdk=await import(pathToFileURL(req.resolve('@anthropic-ai/claude-agent-sdk')).href);
  if(typeof sdk.renameSession!=='function') throw Error('This Claude Code SDK does not support renaming. Update its ACP bridge.');
  await sdk.renameSession(id,title,{dir:cwd});
  const info=(await sdk.listSessions({dir:cwd})).find(s=>s.sessionId===id);
  if(!info) throw Error('Claude Code did not confirm this session in its native project.');
  if(info.customTitle!==title && info.summary!==title) throw Error('Claude Code did not confirm the native conversation title.');
  console.log(JSON.stringify({backendProjectId:'claude-code:'+path.resolve(cwd),syncPending:false}));
 } else {
  const sdk=await import(pathToFileURL(req.resolve('@earendil-works/pi-coding-agent')).href);
  const sessions=await sdk.SessionManager.list(cwd);
  const info=sessions.find(s=>s.id===id || s.path===id);
  if(!info) throw Error('pi session not found');
  sdk.SessionManager.open(info.path).appendSessionInfo(title);
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});`;

export async function syncSessionMetadata(spawner: Spawner, bridgeDir: string, session: SavedSession, options: { dshHelper?: string; dshRequestFile?: string; antigravityHelper?: string; nativeRequestFile?: string; codexExecutable?: string } = {}): Promise<{ agentSessionId?: string; backendProjectId?: string; backendProjectRoots?: string[]; syncPending?: boolean; syncReason?: string }> {
  if (!session.agentSessionId) throw new Error("The conversation has not started yet; metadata will sync after the first reply.");
  const env = cleanEnv(await spawner.baseEnv());
  if (session.backend === "antigravity") {
    if (!options.antigravityHelper || !options.nativeRequestFile) throw new Error("The Antigravity project helper is missing. Reinstall the plugin.");
    const node = await findBinary(spawner, env, "node");
    if (!node) throw new Error("Node.js not found");
    const r = await spawner.run(node, [options.antigravityHelper, "--request-file", options.nativeRequestFile], { env, timeoutMs: 60_000 });
    if (r.code !== 0) throw new Error(r.stderr.trim().slice(-600) || "Antigravity native project registration failed");
    const result = JSON.parse(r.stdout.trim().split(/\r?\n/).pop() || "{}");
    if (typeof result.backendProjectId !== "string" || typeof result.agentSessionId !== "string" || typeof result.syncPending !== "boolean") throw new Error("Antigravity returned no native ownership confirmation");
    return { agentSessionId: result.agentSessionId, backendProjectId: result.backendProjectId, syncPending: result.syncPending, syncReason: result.syncReason };
  }
  if (session.backend === "deepseek-harness") {
    if (!options.dshHelper) throw new Error("The DSH project integration helper is missing. Reinstall the plugin.");
    const node = await findBinary(spawner, env, "node");
    if (!node) throw new Error("Node.js not found");
    const payload = JSON.stringify({ agentSessionId: session.agentSessionId, cwd: session.cwd, projectName: session.projectName || "Zotero Agent" });
    const args = options.dshRequestFile ? [options.dshHelper, "--request-file", options.dshRequestFile] : [options.dshHelper, payload];
    const r = await spawner.run(node, args, { env, timeoutMs: 15_000 });
    if (r.code !== 0) throw new Error(r.stderr.trim().slice(-600) || "DSH project registration failed");
    const result = JSON.parse(r.stdout.trim().split(/\r?\n/).pop() || "{}");
    if (typeof result.backendProjectId !== "string" && result.syncPending !== true) throw new Error("DSH project registration returned no confirmation");
    return result;
  }
  if (session.backend !== "codex") {
    const node = await findBinary(spawner, env, "node");
    if (!node) throw new Error("Node.js not found");
    const r = await spawner.run(node, ["-e", SDK_RENAME, bridgeDir, session.backend, session.agentSessionId, session.title, session.cwd], { env, timeoutMs: 15_000 });
    if (r.code !== 0) throw new Error(r.stderr.trim().slice(-600) || "The backend could not rename this conversation.");
    if (session.backend === "claude-code") {
      const result = JSON.parse(r.stdout.trim().split(/\r?\n/).pop() || "{}");
      if (typeof result.backendProjectId !== "string" || result.syncPending !== false) throw new Error("Claude Code returned no native project confirmation");
      return result;
    }
    return {};
  }
  const codex = await findCli(spawner, env, backendOf("codex"), options.codexExecutable);
  if (!codex) throw new Error("Codex not found");
  const proc = await spawner.spawn(codex, ["app-server"], { env, cwd: session.cwd });
  const peer = new JsonRpcPeer(proc);
  const timer = setTimeout(() => { peer.close("Metadata sync timed out"); void proc.kill(); }, 20_000);
  try {
    await peer.request("initialize", { clientInfo: { name: "zotero_agent_metadata", version: "1.0.0" }, capabilities: { experimentalApi: true, requestAttestation: false } });
    peer.notify("initialized");
    await peer.request("thread/name/set", { threadId: session.agentSessionId, name: session.title });
    if (!session.projectName) return {};
    type Project = { id: string; name: string; roots: { path: string }[]; metadata: Record<string, string> };
    let project: Project | undefined;
    let cursor: string | null = null;
    do {
      const page: { data: Project[]; nextCursor: string | null } = await peer.request("project/list", { cursor, limit: 100 });
      project = page.data.find((p) => p.metadata?.source === "zotero-agent" && (p.metadata.zoteroAgentProjectName || p.name) === session.projectName);
      cursor = page.nextCursor;
    } while (!project && cursor);
    if (!project) {
      const result = await peer.request<{ project: Project }>("project/create", {
        name: session.projectName, roots: [{ path: session.cwd }],
        metadata: { source: "zotero-agent", zoteroAgentProjectName: session.projectName },
        idempotencyKey: `zotero-agent:${session.projectName}`,
      });
      project = result.project;
    }
    // Old conversations retain their original cwd. They join the same named project instead of
    // creating duplicate projects when a chat folder changed or a legacy chat is resumed.
    const pathKey = (p: string) => spawner.windows ? p.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase() : p;
    if (!project.roots.some((r) => pathKey(r.path) === pathKey(session.cwd))) {
      const roots = [...project.roots, { path: session.cwd }];
      await peer.request("project/update", { projectId: project.id, roots });
      project.roots = roots;
    }
    await peer.request("thread/metadata/update", { threadId: session.agentSessionId, projectId: project.id });
    return { backendProjectId: project.id, backendProjectRoots: project.roots.map(r => r.path) };
  } finally {
    clearTimeout(timer);
    peer.close();
    await proc.kill();
  }
}
