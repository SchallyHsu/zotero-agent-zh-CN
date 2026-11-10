// The conversation: the transcript state, the agent session behind it, and saving. No DOM here; the panel
// renders `tr` whenever `onChange` fires.
import type { AgentSession, ChatEvent, ContextChip, PanelHost, PanelSettings, SavedSession } from "../types.ts";
import { clip, errMessage, env } from "./dom.ts";
import { summary } from "./context.ts";
import { chipHash, planContext } from "./economy.ts";
import { Persister } from "./persist.ts";
import { applyEvent, emptyTranscript, promptFor, replay } from "./transcript.ts";
import type { TranscriptState } from "./transcript.ts";
import { DEFAULT_PROJECT } from "./session-model.ts";

export interface ChatDeps {
  host: PanelHost;
  /** The transcript or the busy state changed: render (the panel batches). */
  onChange(): void;
  /** Why sending is impossible right now, or null. */
  blockReason(): string | null;
  /** A turn ended (for the screen-reader announcement). */
  turnEnded(stop: string): void;
  /** The session died or failed to start: look at the setup again. */
  setupFailed(): void;
  /** The session or its choices changed (the pickers show them). */
  sessionChanged(): void;
  /** What the agent reads for what the user typed (`/skill rest` becomes a plain instruction), in the agent's folder `cwd`. */
  expand(text: string, cwd: string): Promise<string>;
  /** Which chips count as already shown changed (a send, a new chat, a compaction): repaint the composer's chips. */
  shownChanged(): void;
}

export class Chat {
  tr: TranscriptState = emptyTranscript();
  session: AgentSession | null = null;
  starting: Promise<AgentSession> | null = null;
  saved: SavedSession | null = null;
  sending = false;
  /** A `/compact` the user asked for is running (sending is set too). */
  compacting = false;
  /** The chips the last message carried, marked `repeat` when only named (the context popover lists them). */
  lastContext: ContextChip[] = [];
  private resume: SavedSession | null = null;
  private unsub: (() => void) | null = null;
  private gen = 0;
  private cwd = "";
  /** Chips this agent session has already read (id -> fingerprint): unchanged ones are not sent again. */
  private sent = new Map<string, string>();
  /** Chips this chat has shown in a sent message (id -> fingerprint): the composer stops showing them (isShown). */
  private shown = new Map<string, string>();
  private persister: Persister;
  private writes: Promise<void> = Promise.resolve();
  private cloudRefresh: Promise<boolean> | null = null;
  private remoteDeleted = false;
  private d: ChatDeps;

  constructor(deps: ChatDeps) {
    this.d = deps;
    this.persister = new Persister((ev) => this.write(ev));
  }

  /**
   * Already shown in a message of this chat. Where the user is (the open paper, a selected item or collection) counts
   * once per item, whatever page they are on; what they point at (a selection, an area, a picture) until it changes.
   */
  isShown(c: ContextChip): boolean {
    const h = this.shown.get(c.id);
    return h !== undefined && (c.kind === "reader" || c.kind === "item" || c.kind === "collection" || h === chipHash(c));
  }

  get busy(): boolean { return this.sending || this.tr.running !== null; }

  /** Fold an event into the transcript, ask for a render, and save it. */
  dispatch(ev: ChatEvent, persist = true): void {
    if (ev.t === "notice" && ev.compacted) { this.sent.clear(); this.shown.clear(); this.d.shownChanged(); } // the summary may have dropped what was sent
    this.tr = applyEvent(this.tr, ev);
    this.d.onChange();
    if (persist && (this.saved || ev.t === "user")) this.persister.push(ev);
  }

  private write(ev: ChatEvent): void {
    if (!this.saved) return;
    this.saved = { ...this.saved, updatedAt: Date.now(), ...(this.session ? { agentSessionId: this.session.sessionId } : {}) };
    const saved = this.saved;
    this.writes = this.writes.then(() => this.d.host.appendEvent(saved, ev)).catch(() => {
      this.dispatch({ t: "notice", level: "error", message: "Couldn't save this chat. Check available disk space before closing Zotero." }, false);
    });
  }

  async ensureSession(): Promise<AgentSession> {
    if (this.session) return this.session;
    if (this.starting) return this.starting;
    const gen = this.gen;
    const host = this.d.host;
    const p = (async () => {
      const set = host.getSettings();
      const backend = this.resume?.backend ?? this.saved?.backend ?? set.backend;
      const prep = await host.prepareSession(this.resume?.cwd, backend);
      if (gen !== this.gen) throw new Error("cancelled");
      const sess = await host.runtime.start({
        backend, cwd: prep.cwd, brief: prep.brief, env: prep.env,
        projectName: this.saved?.projectName || set.projectName || DEFAULT_PROJECT,
        sessionTitle: this.saved?.title,
        ...(set.model[backend] ? { model: set.model[backend] } : {}),
        ...(set.mode[backend] ? { mode: set.mode[backend] } : {}),
        ...(set.effort[backend] ? { effort: set.effort[backend] } : {}),
        ...(backend !== "pi" ? { auth: set.auth[backend] } : {}),
        ...(this.resume?.agentSessionId ? { resumeSessionId: this.resume.agentSessionId } : {}),
      });
      if (gen !== this.gen) { void sess.close().catch(() => {}); throw new Error("cancelled"); }
      this.cwd = prep.cwd;
      this.session = sess;
      this.sent.clear(); // a new or resumed session: everything goes in full once (DESIGN.md "Context budget")
      this.resume = null;
      const turnNamespace = envId("turn");
      this.unsub = sess.on((ev) => {
        if ("turn" in ev) ev = { ...ev, turn: `${turnNamespace}_${ev.turn}` };
        this.dispatch(ev);
        if (ev.t === "turn_end") { this.d.turnEnded(ev.stop); this.persister.flush(); }
      });
      return sess;
    })();
    this.starting = p;
    p.then(() => {}, () => {}).finally(() => { if (this.starting === p) this.starting = null; this.d.sessionChanged(); this.d.onChange(); });
    return p;
  }

  async closeSession(): Promise<void> {
    const s = this.session;
    this.unsub?.();
    this.unsub = null;
    this.session = null;
    this.starting = null;
    this.gen++;
    if (s) await s.close().catch(() => {});
    this.d.sessionChanged();
  }

  async send(text: string, used: ContextChip[]): Promise<void> {
    if (this.busy || this.d.blockReason()) return;
    let gen = this.gen;
    const host = this.d.host;
    this.sending = true;
    this.d.onChange();
    // Fetch and reconcile before adding the new user message, so replay never duplicates that message.
    if (host.chatSync && host.getSettings().chatSync?.enabled) {
      if (!await this.refreshFromSync(true, true)) { if (gen === this.gen) { this.sending = false; this.d.onChange(); } return; }
      gen = this.gen;
      if (this.remoteDeleted) { this.sending = false; this.d.onChange(); return; }
    }
    if (!this.saved) {
      const paper = host.currentPaper();
      this.saved = { id: envId("s"), title: clip(text, 60), backend: host.getSettings().backend, cwd: this.cwd, agentSessionId: this.session?.sessionId ?? "", updatedAt: Date.now(), lastOpenedAt: Date.now(), projectName: host.getSettings().projectName || DEFAULT_PROJECT, ...(paper ? { paper } : {}) };
    }
    const turnSessionId = this.saved.id;
    try { host.chatSync?.beginTurn(turnSessionId); }
    catch (e) { this.sending = false; this.dispatch({ t: "notice", level: "warn", message: errMessage(e) }, false); return; }
    let history = "";
    if (this.saved.needsContextReplay) {
      try {
        history = await host.chatSync?.continuation(this.saved.id) || "";
        if (!history) throw Error("Couldn't load the shared conversation context. Try syncing again before continuing.");
      } catch (e) {
        host.chatSync?.endTurn(turnSessionId); this.sending = false;
        this.dispatch({ t: "notice", level: "error", message: errMessage(e) }, false); return;
      }
    }
    if (gen !== this.gen) { host.chatSync?.endTurn(turnSessionId); return; }
    // The bubble shows what the composer showed: context already in this chat is only named to the agent, not shown again.
    const fresh = used.filter((c) => !this.isShown(c));
    for (const c of used) this.shown.set(c.id, chipHash(c));
    this.d.shownChanged();
    this.dispatch({ t: "user", id: envId("u"), text, chips: fresh.map(summary) });
    try {
      const starting = this.ensureSession();
      // The focused paper's metadata and full-text file, prepared while the session starts (never longer than 1.5 s after).
      const paper = host.paperContext(used, starting).catch(() => [] as ContextChip[]);
      const sess = await starting;
      if (gen !== this.gen) return;
      const saved = await host.saveSession({ ...this.saved!, agentSessionId: sess.sessionId, cwd: this.cwd || this.saved!.cwd });
      if (gen !== this.gen) return;
      this.saved = saved;
      if (saved.backend === "deepseek-harness") this.syncMetadata();
      let ctx = { text: "", images: [] as { mime: string; data: string }[] };
      const extra = await paper;
      if (gen !== this.gen) return;
      try {
        const next = new Map(this.sent);
        const plan = planContext([...used, ...extra], next);
        ctx = host.describeContext(plan);
        this.sent = next;
        this.lastContext = plan;
      } catch { /* the question still goes */ }
      if (ctx.images.length && !sess.supportsImages) this.dispatch({ t: "notice", level: "warn", message: "This agent doesn't take images, so the pictures were left out of that message." });
      const said = await this.d.expand(text, this.cwd);
      if (gen !== this.gen) return;
      await sess.prompt({
        text: [history, ctx.text, said].filter(Boolean).join("\n\n"),
        ...(sess.supportsImages && ctx.images.length ? { images: ctx.images } : {}),
      });
      if (history && this.saved && gen === this.gen) this.saved = await host.saveSession({ ...this.saved, needsContextReplay: false });
    } catch (e) {
      if (gen === this.gen) { this.sending = false; await this.fail(e); }
    } finally {
      this.persister.flush();
      await this.writes;
      host.chatSync?.endTurn(turnSessionId);
      if (gen === this.gen) {
        this.sending = false;
        this.persister.flush();
        this.syncMetadata();
        this.d.onChange();
        if (host.getSettings().chatSync?.enabled) void this.refreshFromSync();
      }
    }
  }

  private syncMetadata(): void {
    if (!this.saved?.agentSessionId) return;
    void this.d.host.syncSession(this.saved).then((updated) => {
      if (this.saved?.id === updated.id) {
        this.saved = { ...this.saved, agentSessionId: updated.agentSessionId, backendProjectId: updated.backendProjectId, backendSyncVersion: updated.backendSyncVersion, syncPending: updated.syncPending, syncError: updated.syncError };
        this.d.onChange();
      }
    }).catch(() => {});
  }

  /** Summarise the conversation now (the bridge's own /compact, when it has a verified one); a notice tells the result. */
  async compact(): Promise<void> {
    const s = this.session;
    if (!s?.canCompact || this.busy) return;
    this.sending = this.compacting = true;
    this.d.onChange();
    try {
      await s.compact();
    } catch (e) {
      await this.fail(e);
    } finally {
      this.sending = this.compacting = false;
      this.persister.flush();
      this.d.onChange();
    }
  }

  private async fail(e: unknown): Promise<void> {
    const msg = errMessage(e);
    if (msg === "cancelled") return;
    const running = this.tr.running;
    if (running) this.dispatch({ t: "turn_end", turn: running, stop: "error" });
    this.dispatch({ t: "notice", level: "error", message: this.session ? `The agent stopped: ${msg}` : `Couldn't start the agent: ${msg}`, hint: "Check Status for what is missing, then send again." });
    // A rejected prompt means the bridge is gone: the next send starts a fresh one and resumes this chat.
    if (this.session) this.resume = this.saved;
    await this.closeSession();
    this.d.setupFailed();
  }

  async stop(): Promise<void> {
    const s = this.session;
    if (!s) return;
    // A question nobody answered is cancelled with the turn.
    const live = this.tr.messages.find((m) => m.role === "assistant" && m.id === this.tr.running);
    if (live && live.role === "assistant") for (const b of live.blocks) if (b.type === "permission" && b.resolved === undefined) s.respondPermission(b.id, null);
    try { await s.cancel(); } catch { /* the turn_end tells the story */ }
  }

  /** Ask again: the same text and chips as the message an answer replies to. */
  retry(assistantId: string): void {
    const u = promptFor(this.tr, assistantId);
    if (!u || this.busy) return;
    void this.send(u.text, u.chips.map((c) => ({ ...c, auto: false, pinned: false })));
  }

  answerPermission(turn: string, permId: string, optionId: string): void {
    const m = this.tr.messages.find((x) => x.role === "assistant" && x.id === turn);
    const b = m && m.role === "assistant" ? m.blocks.find((x) => x.type === "permission" && x.id === permId) : undefined;
    if (!b || b.type !== "permission") return;
    this.session?.respondPermission(permId, optionId);
    this.dispatch({ t: "permission", turn, id: b.id, title: b.title, kind: b.kind, ...(b.input !== undefined ? { input: b.input } : {}), options: b.options, resolved: optionId, ...(b.name ? { name: b.name } : {}) });
  }

  /** Change the model, effort or permission mode: save `id` as that backend's choice ("" = the agent's default) and apply `apply` to the live session, unless it is already on it. */
  async pick(kind: "model" | "effort" | "mode", id: string, apply: string | undefined = id): Promise<void> {
    const s = this.d.host.getSettings();
    const backend = this.session?.backend ?? s.backend;
    const live = this.session;
    const now = kind === "model" ? live?.currentModel() : kind === "effort" ? live?.currentEffort() : live?.currentMode();
    if (live && apply && apply !== now) await (kind === "model" ? live.setModel(apply) : kind === "effort" ? live.setEffort(apply) : live.setMode(apply));
    await this.d.host.setSettings({ [kind]: { ...s[kind], [backend]: id } } as Partial<PanelSettings>);
  }

  /** A new, empty chat. */
  async reset(): Promise<void> {
    if (this.busy) await this.stop();
    this.persister.flush();
    await this.writes;
    await this.closeSession();
    this.tr = emptyTranscript();
    this.saved = null;
    this.cwd = "";
    this.resume = null;
    this.sending = false;
    this.lastContext = [];
    this.shown.clear();
    this.remoteDeleted = false;
    this.d.shownChanged();
    this.d.onChange();
  }

  /** Open a saved chat; the agent is started again (and resumes it) on the next send. */
  async load(s: SavedSession): Promise<void> {
    await this.reset();
    const gen = this.gen;
    if (this.d.host.getSettings().chatSync?.enabled) {
      await this.d.host.chatSync?.sync();
      if (gen !== this.gen) return;
      const latest = (await this.d.host.sessions()).find(x => x.id === s.id);
      if (gen !== this.gen) return;
      if (!latest) { this.remoteDeleted = true; this.dispatch({ t: "notice", level: "warn", message: "This chat was deleted on another device. Start a new chat." }, false); return; }
      s = latest;
    }
    try {
      this.tr = replay(await this.d.host.loadEvents(s.id));
      // A save that ends mid-turn (a crash) must not look like it is still streaming.
      if (this.tr.running) this.tr = applyEvent(this.tr, { t: "turn_end", turn: this.tr.running, stop: "cancelled" });
    } catch (e) {
      this.tr = replay([{ t: "notice", level: "error", message: `Couldn't open that chat: ${errMessage(e)}` }]);
    }
    this.saved = await this.d.host.saveSession({ ...s, lastOpenedAt: Date.now() });
    this.resume = this.saved;
    this.syncMetadata();
    this.d.onChange();
  }

  flush(): void { this.persister.flush(); }

  /** A cloud update must reach the agent's context as well as the visible transcript. */
  refreshFromSync(download = true, beforeSend = false): Promise<boolean> {
    if (!this.d.host.chatSync || !this.d.host.getSettings().chatSync?.enabled || (this.busy && !beforeSend)) return Promise.resolve(true);
    if (this.cloudRefresh) return this.cloudRefresh;
    const gen = this.gen, host = this.d.host, id = this.saved?.id;
    const run = (async () => {
      this.persister.flush(); await this.writes;
      if (download) await host.chatSync!.sync();
      if (gen !== this.gen) return false;
      if (!id) return true;
      const s = (await host.sessions()).find(x => x.id === id);
      if (gen !== this.gen) return false;
      if (!s) {
        this.remoteDeleted = true;
        if (this.session) await this.closeSession();
        this.dispatch({ t: "notice", level: "warn", message: "This chat was deleted on another device. Start a new chat." }, false);
        return true;
      }
      if (s.contentVersion !== this.saved?.contentVersion || s.needsContextReplay) {
        const events = await host.loadEvents(id);
        if (gen !== this.gen) return false;
        if (s.needsContextReplay && (this.session || this.starting)) await this.closeSession();
        const users = new Set(events.flatMap(e => e.t === "user" ? [e.id] : []));
        const branched = this.tr.messages.some(m => m.role === "user" && !users.has(m.id));
        this.tr = replay(events);
        if (this.tr.running) this.tr = applyEvent(this.tr, { t: "turn_end", turn: this.tr.running, stop: "cancelled" });
        if (branched) this.tr = applyEvent(this.tr, { t: "notice", level: "warn", message: "Concurrent replies were preserved as a separate chat marked [fork] in History." });
        this.resume = s;
      }
      this.saved = s;
      this.d.onChange();
      return true;
    })().catch(e => { this.dispatch({ t: "notice", level: "warn", message: errMessage(e) }, false); return false; });
    this.cloudRefresh = run;
    void run.finally(() => { if (this.cloudRefresh === run) this.cloudRefresh = null; });
    return run;
  }
}

// User messages, logical chats and turn namespaces must stay unique across devices and process restarts.
const envId = (prefix: string) => `${prefix}_${env.win.crypto.randomUUID()}`;
