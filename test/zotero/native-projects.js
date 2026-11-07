// Runs inside a packaged XPI in an isolated real Zotero profile. No library
// fixtures or model prompts: exercise PanelHost -> jar resource -> real helper.
async function main(ctx) {
  const { Zotero, IOUtils, PathUtils } = ctx;
  const fixtures = JSON.parse(await IOUtils.readUTF8(ctx.env("ZMC_XPI_PROJECT_FIXTURES")));
  const check = (value, message) => { if (!value) throw Error(message); };
  check(PathUtils.normalize(Zotero.Profile.dir) === PathUtils.normalize(fixtures.profile), "Unexpected Zotero profile; stop");
  check(PathUtils.normalize(Zotero.DataDirectory.dir) === PathUtils.normalize(fixtures.data), "Unexpected Zotero library directory; stop");
  check(ctx.plugin.init.rootURI.startsWith("jar:") && ctx.plugin.init.rootURI.includes("chat@zotero-mcp.xpi"), "Must run the packaged XPI with @ in its URL");
  const bundle = ctx.plugin.panel().bundle;
  const host = bundle.host;
  await host.setSettings({ welcomed: false, followFocus: false, chatFolder: fixtures.cwd });
  const results = [];
  for (const session of fixtures.sessions) {
    ctx.log("Syncing packaged host", session.backend);
    await host.saveSession(session);
    const synced = await host.syncSession(session);
    check(!String(synced.syncError || "").includes("nsIURI.username"), `${session.backend}: XPI resource read failed`);
    check(synced.backendSyncVersion === 2, `${session.backend}: helper did not complete: ${synced.syncError || "no native result"}`);
    if (session.backend === "codex") check(synced.backendProjectId && synced.syncPending, "Codex backend confirmation and deferred sidebar registration");
    if (session.backend === "codex") {
      const workerFile = PathUtils.join(ctx.env("CODEX_HOME"), "integrations", "zotero-agent", "sidebar-worker.json");
      const worker = await ctx.waitFor(async () => { try { const w = JSON.parse(await IOUtils.readUTF8(workerFile)); return w.pid ? w : null; } catch { return null; } }, "persistent Codex worker", 10000);
      await ctx.sleep(500);
      const alive = await bundle.spawner.run(fixtures.node, ["-e", 'process.kill(Number(process.argv[1]),0);console.log("alive")', String(worker.pid)], { env: await bundle.spawner.baseEnv(), timeoutMs: 5000 });
      check(alive.code === 0 && alive.stdout.includes("alive"), "Codex worker was terminated with Gecko's helper process job");
    }
    if (session.backend === "antigravity" || session.backend === "claude-code") check(synced.backendProjectId && !synced.syncPending && !synced.syncError, `${session.backend}: native ownership/title not confirmed: ${synced.syncError}`);
    if (session.backend === "antigravity") {
      const originalRun = bundle.spawner.run;
      let fastResume = false;
      bundle.spawner.run = async (command, args, options) => {
        const result = await originalRun(command, args, options);
        if (args[0]?.endsWith("antigravity-project-integration.mjs")) {
          try { fastResume ||= JSON.parse(result.stdout.trim()).metadataReused === true; } catch {}
        }
        return result;
      };
      let resumed;
      try {
        resumed = await host.runtime.start({ backend: "antigravity", cwd: session.cwd, resumeSessionId: synced.agentSessionId, projectName: session.projectName, sessionTitle: session.title, brief: "Synthetic no-prompt resume check", auth: "api-key", env: { GEMINI_API_KEY: "zotero-isolated-invalid-key" } });
        check(fastResume, "Confirmed Antigravity resume must use the local storage fast path");
        check(resumed.sessionId === synced.agentSessionId, "Fast resume must retain the original native session id");
      } finally { bundle.spawner.run = originalRun; if (resumed) await resumed.close(); }
    }
    if (session.backend === "deepseek-harness") check(synced.syncPending, "DSH should queue until its native host loads");
    results.push({ backend: synced.backend, agentSessionId: synced.agentSessionId, backendProjectId: synced.backendProjectId, syncPending: synced.syncPending, syncError: synced.syncError });
  }
  return { rootURI: ctx.plugin.init.rootURI, profile: Zotero.Profile.dir, data: Zotero.DataDirectory.dir, results };
}
