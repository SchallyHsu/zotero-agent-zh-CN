// PanelHost: what ui/ gets. This is the only place that knows both the UI's needs and Zotero's APIs.
import type { AgentRuntime, BackendId, Catalog, ContextChip, PanelHost, Spawner } from "../types.ts";
import { CALLOUT_GUIDE, DRAWING_GUIDE, FORMAT_GUIDE, TOOL_SHEET, buildBrief, createRuntime, prepareWorkspace, resumeCommand } from "../agent/index.ts";
import { ContextTracker } from "./context.ts";
import { describeContext } from "./describe.ts";
import { dropChips } from "./drop.ts";
import { createDoctor, findCli } from "./doctor.ts";
import * as keychain from "./keychain.ts";
import { saveNote } from "./note.ts";
import { pageChip, pageHit } from "./page.ts";
import { createPapers } from "./paper.ts";
import { openTarget } from "./open.ts";
import { chipForHit, search } from "./search.ts";
import { createGeckoSpawner } from "./spawn-gecko.ts";
import { createSettingsHost } from "./settings-host.ts";
import { syncSessionMetadata } from "../agent/session-metadata.ts";
import { paperFromChips } from "../ui/session-model.ts";
import { cleanEnv, findBinary } from "../agent/env.ts";
import { readPackagedText } from "./resource.ts";
import { libraryKey } from "./chat-sync.ts";

export interface HostBundle {
  host: PanelHost;
  spawner: Spawner;
  context: ContextTracker;
  /** chooseImage without the picker: the in-Zotero test imports a file through it. */
  importImage(path: string): Promise<{ name: string; dataUrl: string }>;
  /** The user is about to write (the composer has focus): start preparing the focused PDF's text. */
  prefetchPaper(): void;
  /** A catalog this panel has read, for Zotero's Settings pane, which must not start an agent to show one. */
  knownCatalog(b: BackendId): Catalog | undefined;
  dispose(): void;
}

export function createHost(opts: { id: string; version: string; rootURI?: string; win: any; dataDir: string }): HostBundle {
  const { win, dataDir } = opts;
  const sh = createSettingsHost(opts);
  const { settings, store, images, skills, chatFolder, defaultFolder } = sh;
  const spawner = createGeckoSpawner();
  const context = new ContextTracker(opts.id);
  context.start(win);
  const base = createRuntime({ spawner, bridgeDir: PathUtils.join(dataDir, "bridges"), executable: (b) => settings().agentExecutables?.[b],
    accountUsageHelper: async () => { await nativeHelper("antigravity-project-integration.mjs"); return nativeHelper("account-usage.mjs"); } });
  const known = new Map<BackendId, Catalog>();
  // Wherever zotero-cli is, the agent's shell must find it: its folder goes on the agent's PATH.
  const runtime: AgentRuntime = {
    ...base,
    catalog: (b) => base.catalog(b).then((c) => { known.set(b, c); return c; }),
    async start(o) {
      const cli = await findCli(spawner, await spawner.baseEnv());
      let start = o;
      if (o.backend === "antigravity" && !o.ephemeral && !o.locked) {
        try {
          const previous = o.resumeSessionId ? (await store.sessions()).find(s => s.backend === "antigravity" && s.agentSessionId === o.resumeSessionId && s.cwd === o.cwd
            && s.projectName === o.projectName && s.backendSyncVersion === 2 && !s.syncPending && !s.syncError && s.backendSyncedProjectName === o.projectName) : undefined;
          const native = await invokeNativeHelper("antigravity-project-integration.mjs", { agentSessionId: o.resumeSessionId, cwd: o.cwd, projectName: o.projectName, title: o.sessionTitle,
            operation: "resume", confirmedProjectId: previous?.backendProjectId });
          if (!native.agentSessionId || !native.geminiDir) throw new Error("Antigravity returned no prepared native session");
          start = { ...o, resumeSessionId: native.agentSessionId, antigravityStorage: { geminiDir: native.geminiDir }, freshNativeSession: !o.resumeSessionId };
        } catch (e) { Zotero.logError(e); } // CLI-only installations retain chat; sync reports the native App requirement.
      }
      return base.start(cli ? { ...start, path: [cli.slice(0, cli.lastIndexOf("/")), ...(start.path ?? [])] } : start);
    },
  };
  const doctor = createDoctor({ win, spawner, runtime, settings });
  const papers = createPapers({ dataDir, defaultFolder, chatFolder });
  // The context settings decide what the tracker hands over, wherever they were changed.
  const offSettings = sh.host.onSettingsChange(() => context.refresh());
  let syncChain: Promise<unknown> = Promise.resolve();
  const helpers = new Map<string, Promise<string>>();
  function nativeHelper(asset: string): Promise<string> {
    let helper = helpers.get(asset);
    if (helper) return helper;
    helper = (async () => {
      if (!opts.rootURI) throw new Error("Native integration asset URI is unavailable; reinstall the plugin.");
      const source = await readPackagedText(opts.rootURI, `assets/${asset}`);
      const path = PathUtils.join(dataDir, asset);
      await IOUtils.makeDirectory(dataDir, { createAncestors: true, ignoreExisting: true });
      await IOUtils.writeUTF8(path, source, { tmpPath: `${path}.tmp` });
      return path;
    })().catch((e) => { helpers.delete(asset); throw e; });
    helpers.set(asset, helper); return helper;
  }
  async function invokeNativeHelper(asset: string, payload: unknown): Promise<any> {
    const helper = await nativeHelper(asset);
    const env = cleanEnv(await spawner.baseEnv());
    const node = await findBinary(spawner, env, "node");
    if (!node) throw new Error("Node.js not found");
    const request = PathUtils.join(dataDir, `native-project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.json`);
    try {
      await IOUtils.writeUTF8(request, JSON.stringify(payload));
      const r = await spawner.run(node, [helper, "--request-file", request], { env, timeoutMs: 60_000 });
      if (r.code !== 0) throw new Error(r.stderr.trim().slice(-600) || "Native project registration failed");
      return JSON.parse(r.stdout.trim().split(/\r?\n/).pop() || "{}");
    } finally { await IOUtils.remove(request, { ignoreAbsent: true }).catch(() => {}); }
  }

  const host: PanelHost = {
    ...sh.host,
    runtime,
    currentContext() {
      const s = settings();
      if (!s.followFocus) return [];
      return context.current(win)
        .filter((c) => s.attachSelection || c.kind !== "selection")
        .map((c) => (c.kind === "area" && !s.attachAreas ? { ...c, image: undefined } : c));
    },
    onContextChange: (cb) => context.on(cb),
    async search(q) {
      const reader = context.activeReader(win);
      const page = reader ? pageHit(reader, q) : null;
      const hits = await search(win, q, reader?._item ?? null);
      return page ? [page, ...hits] : hits;
    },
    async chipFor(hit) {
      if (hit.kind === "page") return pageChip(win, context.activeReader(win), hit);
      let text: string | undefined;
      if (hit.kind === "annotation" && hit.ref.annotationKey) {
        const a = Zotero.Items.getByLibraryAndKey(hit.ref.libraryID, hit.ref.annotationKey);
        text = a?.annotationText || a?.annotationComment || undefined;
      }
      return chipForHit(hit, text);
    },
    open: (target) => openTarget(win, target),
    dropChips: (data) => dropChips(context, data),
    paperContext: (chips, ready) => papers.context(chips, ready),
    describeContext: (chips: ContextChip[]) => describeContext(chips),

    async setSettings(patch) { await sh.host.setSettings(patch); context.refresh(); },
    async resetSettings() { await sh.host.resetSettings(); context.refresh(); },

    sessions: () => store.sessions(),
    currentPaper() {
      const p = paperFromChips(context.current(win));
      if (!p) return null;
      const item = Zotero.Items.getByLibraryAndKey(p.libraryID, p.itemKey);
      return { ...p, libraryKey: libraryKey(p.libraryID), title: item?.getDisplayTitle() || p.title };
    },
    async saveSession(s) { return store.saveSession(s); },
    async renameSession(id, title) {
      const s = await store.renameSession(id, title);
      sh.cloud.dirty();
      return s.agentSessionId ? host.syncSession(s) : s;
    },
    syncSession(s) {
      const run = syncChain.then(async () => {
        const all = await store.sessions();
        const current = all.find((x) => x.id === s.id);
        if (!current) return s; // deleted while waiting: never recreate it
        if (!current.syncError && !current.syncPending && current.backendSyncVersion === 2 && current.backendSyncedTitle === current.title && current.backendSyncedProjectName === (current.projectName || "")) return current;
        let patch: Partial<typeof current>;
        let requestFile: string | undefined;
        try {
          let dshOptions: { dshHelper?: string; dshRequestFile?: string; antigravityHelper?: string; nativeRequestFile?: string; codexExecutable?: string } = { codexExecutable: settings().agentExecutables?.codex };
          if (current.backend === "deepseek-harness") {
            const helper = await nativeHelper("dsh-project-integration.mjs");
            requestFile = PathUtils.join(dataDir, `dsh-project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.json`);
            await IOUtils.writeUTF8(requestFile, JSON.stringify({ agentSessionId: current.agentSessionId, cwd: current.cwd, projectName: current.projectName,
              relatedSessionIds: all.filter(x => x.backend === "deepseek-harness" && x.cwd === current.cwd && x.agentSessionId).map(x => x.agentSessionId) }));
            dshOptions = { dshHelper: helper, dshRequestFile: requestFile };
          }
          if (current.backend === "antigravity") {
            const helper = await nativeHelper("antigravity-project-integration.mjs");
            requestFile = PathUtils.join(dataDir, `agy-project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.json`);
            await IOUtils.writeUTF8(requestFile, JSON.stringify({ agentSessionId: current.agentSessionId, cwd: current.cwd, projectName: current.projectName, title: current.title }));
            dshOptions = { antigravityHelper: helper, nativeRequestFile: requestFile };
          }
          let result = await syncSessionMetadata(spawner, PathUtils.join(dataDir, "bridges"), current, dshOptions);
          if (current.backend === "codex" && result.backendProjectId) {
            const sidebar = await invokeNativeHelper("codex-desktop-projects.mjs", { backendProjectId: result.backendProjectId, projectName: current.projectName || "Zotero Agent", roots: result.backendProjectRoots || [current.cwd],
              sessionIds: all.filter(x => x.backend === "codex" && x.projectName === current.projectName && x.agentSessionId).map(x => x.agentSessionId) });
            result = { ...result, ...sidebar };
          }
          const { syncReason, backendProjectRoots: _roots, ...metadata } = result;
          patch = { ...metadata, backendSyncVersion: 2, backendSyncedTitle: current.title, backendSyncedProjectName: current.projectName || "",
            syncError: result.syncPending ? (syncReason || "等待 dsh 原生项目归类：首次启用扩展后请完全退出并重新打开 dsh 客户端；之后会自动同步。") : "" };
        }
        catch (e) { patch = { syncError: String((e as Error).message || e) }; }
        finally { if (requestFile) await IOUtils.remove(requestFile, { ignoreAbsent: true }).catch(() => {}); }
        return (await store.patchSession(s.id, patch)) ?? current;
      });
      syncChain = run.catch(() => {});
      return run;
    },
    loadEvents: (id) => store.loadEvents(id),
    appendEvent: (s, ev) => store.appendEvent(s, ev),
    async deleteSession(id) { await store.deleteSession(id); sh.cloud.dirty(); },
    async saveFile(name, data, mime) {
      const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
      const ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1]?.toLowerCase() ?? "";
      fp.init(win.browsingContext, "Save", Ci.nsIFilePicker.modeSave);
      fp.defaultString = name;
      if (ext) { fp.appendFilter(`${ext.toUpperCase()} (${mime})`, `*.${ext}`); fp.defaultExtension = ext; }
      const result: number = await new Promise((r) => fp.open(r));
      if (result !== Ci.nsIFilePicker.returnOK && result !== Ci.nsIFilePicker.returnReplace) return null;
      let path: string = fp.file.path;
      if (ext && !path.toLowerCase().endsWith(`.${ext}`)) path += `.${ext}`;
      if (typeof data === "string") await IOUtils.writeUTF8(path, data);
      else await IOUtils.write(path, data);
      return path;
    },
    saveNote: (note) => saveNote(win, context, note),
    resumeCommand: (s) => resumeCommand(s.backend, s.cwd, s.agentSessionId),

    doctor,
    async prepareSession(resumeIn, backend) {
      const env = await spawner.baseEnv();
      const zoteroCli = await findCli(spawner, env);
      // A chat being resumed runs in the folder it started in; agents look a session up by its folder.
      const dir = resumeIn || chatFolder();
      const cwd = await prepareWorkspace(spawner, dir, { ...(zoteroCli ? { zoteroCli } : {}), refresh: !resumeIn && !settings().chatFolder });
      const s = settings();
      // The skills that are on go into the agent's folder (Claude and Codex also find them there by themselves).
      await skills.sync(cwd, (await skills.host.list()).filter((k) => !s.skills?.[k.name]?.off).map((k) => k.name)).catch((e) => Zotero.logError(e));
      const b = backend ?? s.backend;
      const key = s.auth[b] === "api-key" ? await keychain.getApiKey(b) : null;
      const varName = keychain.API_KEY_ENV[b];
      return { cwd, brief: `${buildBrief()}\n\n${TOOL_SHEET}\n\n${DRAWING_GUIDE}\n\n${CALLOUT_GUIDE}\n\n${FORMAT_GUIDE}`, env: key && varName ? { [varName]: key } : {} };
    },
  };
  // Upgrade histories created before native registration, using their saved ids.
  void store.sessions().then((all) => {
    for (const s of all) {
      if (!s.agentSessionId || !s.cwd) continue;
      if (["codex", "claude-code", "antigravity", "deepseek-harness"].includes(s.backend)) void host.syncSession(s).catch(e => Zotero.logError(e));
    }
  }).catch(e => Zotero.logError(e));
  return { host, spawner, context, prefetchPaper: () => papers.prefetch(host.currentContext()), importImage: images.importImage, knownCatalog: (b) => known.get(b), dispose: () => { offSettings(); sh.dispose(); context.stop(); } };
}
