// Account limits live outside the transcript. Polling never blocks Send or starts an agent session.
// The meter is a small gauge in the composer's toolbar: the ring is the remaining share of the tightest quota window,
// hover or focus shows a one-line tooltip ("每周 · 剩余 61%"), and a click opens the full breakdown.
import type { AccountUsage, BackendId } from "../types.ts";
import type { TranscriptState } from "./transcript.ts";
import { conversationUsage } from "./usage-model.ts";
import { env, fmtTokens, h, setKids, svg } from "./dom.ts";

interface UsageContext {
  backend: BackendId;
  auth: "subscription" | "api-key";
  model?: string;
  /** Changing executable configuration invalidates the old account snapshot too. */
  executable: string;
  showCost: boolean;
  transcript: TranscriptState;
}

type Window = AccountUsage["windows"][number];

export class UsageMeter {
  readonly el: HTMLElement;
  private host: HTMLElement;
  private button: HTMLButtonElement;
  private arc = svg("circle", { cx: "8", cy: "8", r: "6.25", pathLength: "100", class: "umeter__arc", "stroke-dasharray": "0 100" });
  private summary = h("span.umeter__summary");
  private tip: HTMLElement;
  private pop: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private refreshButton: HTMLButtonElement | null = null;
  private context?: UsageContext;
  private account?: AccountUsage;
  private error = "";
  private loading = false;
  private generation = 0;
  private disposed = false;
  private timer: number;
  private stats = conversationUsage({ messages: [], running: null, notices: 0 });
  private signature = "";
  private read: (backend: BackendId, auth: "subscription" | "api-key", model?: string) => Promise<AccountUsage>;
  private opening: () => void;
  private lastAttempt = 0;
  private retryAt = 0;

  constructor(host: HTMLElement, read: (backend: BackendId, auth: "subscription" | "api-key", model?: string) => Promise<AccountUsage>, opening: () => void) {
    this.host = host;
    this.read = read;
    this.opening = opening;
    this.button = h("button.umeter__button", {
      type: "button", "aria-label": "额度与用量", "aria-haspopup": "dialog", "aria-expanded": "false",
      onclick: () => this.pop ? this.close(true) : this.open(),
      onpointerenter: () => this.showTip(),
      onpointerleave: () => this.hideTip(),
      onfocus: () => { if (this.button.matches(":focus-visible")) this.showTip(); },
      onblur: () => this.hideTip(),
      onkeydown: (e: KeyboardEvent) => { if (e.key === "Escape" && !this.tip.hidden) { e.preventDefault(); e.stopPropagation(); this.hideTip(); } },
    }, svg("svg", { viewBox: "0 0 16 16", "aria-hidden": "true" },
      svg("circle", { cx: "8", cy: "8", r: "6.25", class: "umeter__track" }), this.arc,
      svg("rect", { x: "5.7", y: "5.7", width: "4.6", height: "4.6", rx: "1.1", class: "umeter__core", transform: "rotate(45 8 8)" }))) as HTMLButtonElement;
    this.el = h("div.umeter", null, this.button);
    this.tip = h("div.utip", { hidden: true, "aria-hidden": "true" }, this.summary);
    host.appendChild(this.tip);
    this.timer = env.win.setInterval(() => {
      if (!env.doc.hidden && this.el.getClientRects().length) {
        this.paint(); // Mark elapsed reset times as stale even when offline.
        if (this.context && (this.context.auth === "subscription" || this.context.backend === "pi" || this.context.backend === "deepseek-harness")) void this.refresh();
      }
    }, 60_000);
  }

  set(context: UsageContext): void {
    if (this.disposed) return;
    const old = this.context;
    this.context = context;
    this.stats = conversationUsage(context.transcript);
    if (!old || old.backend !== context.backend || old.auth !== context.auth || old.executable !== context.executable || (context.backend === "pi" || context.backend === "deepseek-harness") && old.model !== context.model) {
      this.generation++;
      this.account = undefined;
      this.error = "";
      this.loading = false;
      this.lastAttempt = this.retryAt = 0;
      void this.refresh();
    }
    const signature = JSON.stringify([this.stats, context.showCost]);
    if (signature !== this.signature) { this.signature = signature; this.paint(); }
  }

  async refresh(force = false): Promise<void> {
    const c = this.context;
    if (!c || this.loading || this.disposed) return;
    if (!force && (Date.now() < this.retryAt || Date.now() - this.lastAttempt < (c.backend === "claude-code" ? 300_000 : 30_000))) return;
    this.lastAttempt = Date.now();
    const generation = this.generation;
    this.loading = true;
    this.error = "";
    this.paint();
    try {
      const result = await this.read(c.backend, c.auth, c.model);
      if (this.disposed || generation !== this.generation) return;
      this.retryAt = result.retryAt ?? 0;
      if (result.status === "unavailable" && this.account?.status === "available") this.error = result.message ?? "暂时无法刷新额度。";
      else this.account = result;
    } catch {
      if (this.disposed || generation !== this.generation) return;
      this.error = "暂时无法获取额度，请检查登录状态和网络后刷新。";
    } finally {
      if (!this.disposed && generation === this.generation) { this.loading = false; this.paint(); }
    }
  }

  get isOpen(): boolean { return this.pop !== null; }
  inside(path: EventTarget[]): boolean { return path.includes(this.el) || (!!this.pop && path.includes(this.pop)); }

  close(focus = false): void {
    this.pop?.remove();
    this.pop = this.body = null;
    this.refreshButton = null;
    this.button.setAttribute("aria-expanded", "false");
    if (focus) this.button.focus();
  }

  dispose(): void { this.disposed = true; this.generation++; env.win.clearInterval(this.timer); this.close(); this.tip.remove(); }

  // ───────────────────────────── tooltip ─────────────────────────────

  private showTip(): void {
    if (this.pop || !this.summary.textContent) return;
    this.tip.hidden = false;
    this.placeTip();
  }

  private hideTip(): void { this.tip.hidden = true; }

  /** Above the gauge, inside the composer: centred on it, but never past either edge. */
  private placeTip(): void {
    if (this.tip.hidden) return;
    const b = this.button, w = this.tip.offsetWidth;
    const top = this.el.offsetTop + b.offsetTop, cx = this.el.offsetLeft + b.offsetLeft + b.offsetWidth / 2;
    this.tip.style.bottom = `${this.host.offsetHeight - top + 6}px`;
    this.tip.style.left = `${Math.max(4, Math.min(cx - w / 2, this.host.clientWidth - w - 4))}px`;
  }

  // ───────────────────────────── popover ─────────────────────────────

  private open(): void {
    this.opening();
    this.hideTip();
    this.body = h("div.upop__body");
    this.refreshButton = h("button.btn.btn--sm.btn--quiet", { type: "button", onclick: () => void this.refresh(true) }, "刷新") as HTMLButtonElement;
    this.pop = h("div.menu.upop", { role: "dialog", "aria-label": "额度与用量详情", tabindex: "-1",
      onkeydown: (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(true); } } },
      h("div.cpop__head", null, h("span.cpop__title", null, "额度与用量"), this.refreshButton), this.body);
    this.host.appendChild(this.pop);
    this.button.setAttribute("aria-expanded", "true");
    this.paint();
    this.pop.focus();
  }

  /** Straight above the gauge, right-aligned in the composer (as the context popover is); it never grows past the top. */
  private placePop(): void {
    const pop = this.pop;
    if (!pop) return;
    pop.style.bottom = `${this.host.offsetHeight - (this.el.offsetTop + this.button.offsetTop) + 4}px`;
    pop.style.maxHeight = `${Math.max(140, Math.min(460, this.el.getBoundingClientRect().top - 12))}px`;
  }

  private paint(): void {
    const c = this.context;
    if (!c) return;
    const a = this.account;
    const windows = a?.windows ?? [];
    const balances = a?.balances ?? [];
    const managed = c.backend === "pi" || c.backend === "deepseek-harness";
    const billing = a?.billing ?? (a?.status === "api-key" ? "api-key" : managed ? "account" : c.auth);
    const now = Date.now();
    const stale = !!this.error || !!(a && now - a.checkedAt >= 120_000);
    const expired = (w: Window) => w.resetsAt !== undefined && w.resetsAt <= now;
    const left = (w: Window) => Math.min(100, Math.max(0, 100 - w.usedPercent));
    const pct = (n: number) => `${Number(n.toFixed(1))}%`;
    // The window that runs out first is the one that limits the next message.
    const live = windows.filter(w => !expired(w));
    const tight = live.length ? live.reduce((m, w) => left(w) < left(m) ? w : m) : windows[0];
    const t = this.stats.total;
    const known = t.inputTokens !== undefined || t.outputTokens !== undefined;
    const tokens = known ? `本对话 ${fmtTokens((t.inputTokens ?? 0) + (t.outputTokens ?? 0))} Tokens` : "等待用量数据";
    const money = (b: NonNullable<AccountUsage["balances"]>[number]) => `${b.currency ? `${b.currency} ` : ""}${b.remaining}`;
    const head = tight ? `${tight.label} · ${expired(tight) ? "待刷新" : `剩余 ${pct(left(tight))}`}` : balances[0] ? `${balances[0].label} · ${money(balances[0])}` : "";
    this.summary.textContent = head ? `${stale ? "上次数据 · " : ""}${head}` : this.loading ? "额度查询中…" : billing === "api-key" ? tokens : "额度暂不可用";

    // The gauge: remaining share of the tightest live window; a full ring for a known balance; an empty track otherwise.
    const fill = tight && !expired(tight) ? left(tight) : !tight && balances.length ? 100 : 0;
    this.arc.setAttribute("stroke-dasharray", `${Number(fill.toFixed(1))} 100`);
    this.el.dataset.level = !stale && tight && !expired(tight) ? (left(tight) <= 10 ? "low" : left(tight) <= 30 ? "warm" : "") : "";
    this.el.dataset.state = this.loading && !a ? "loading" : tight || balances.length ? (stale || (tight && expired(tight)) ? "stale" : "ok") : "none";
    this.button.setAttribute("aria-label", `额度与用量：${this.summary.textContent}。点击查看详情`);
    this.placeTip();
    if (!this.body) return;

    if (this.refreshButton) { this.refreshButton.disabled = this.loading; this.refreshButton.textContent = this.loading ? "刷新中…" : "刷新"; }
    const time = (ms: number) => new Date(ms).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const row = (label: string, value: string) => [h("dt", null, label), h("dd", null, value)];
    const tok = (n: number | undefined) => n === undefined ? "未报告" : fmtTokens(n);
    const usd = (n: number | undefined) => n === undefined ? "未报告" : `$${n.toFixed(4)}`;
    const level = (w: Window) => expired(w) || stale ? "" : left(w) <= 10 ? "low" : left(w) <= 30 ? "warm" : "";
    setKids(this.body,
      h("div.upop__caption", null, `${c.backend}${a?.provider ? ` / ${a.provider}` : ""} · ${{ subscription: "订阅账号", "api-key": "API 模式", account: "账号余额" }[billing]}${a?.plan ? ` · ${a.plan}` : ""}`),
      windows.length ? h("div.upop__windows", null, windows.map(w => h("div.upop__window", { dataset: { stale: String(stale || expired(w)), level: level(w) } },
        h("div.cpop__head", null, h("span.upop__label", null, w.label), h("strong.upop__pct", null, expired(w) ? "等待刷新" : `剩余 ${pct(left(w))}`)),
        h("div.upop__bar", { role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(left(w))), "aria-label": `${w.label}剩余额度` },
          h("span.upop__fill", { style: `width:${expired(w) ? 0 : left(w)}%` })),
        h("p.cpop__why", null, `${expired(w) ? "已到重置时间，刷新后确认新额度" : `已用 ${pct(w.usedPercent)}`}${w.resetsAt ? ` · ${time(w.resetsAt)} 重置` : " · 重置时间未报告"}`))))
        : !balances.length ? h("p.cpop__why", null, this.loading ? "正在查询账号额度…" : a?.message || this.error || "暂无额度数据。") : null,
      balances.length ? h("dl.cpop__facts.upop__balances", null, balances.map(b => row(b.label, money(b)))) : null,
      this.error && (windows.length || balances.length) ? h("p.upop__error", { role: "status" }, `${this.error} 当前显示上次成功获取的数据。`) : null,
      a && (windows.length || balances.length) ? h("p.cpop__why", null, `${stale ? "上次数据" : "更新于"} ${time(a.checkedAt)} · 账号额度包含其他客户端的使用`) : null,
      h("dl.cpop__facts", null,
        row("本轮输入 / 输出", `${tok(this.stats.last?.inputTokens)} / ${tok(this.stats.last?.outputTokens)} Tokens`),
        row("本对话输入 / 输出", `${tok(t.inputTokens)} / ${tok(t.outputTokens)} Tokens`),
        row("已报告 Token 的轮次", `${this.stats.reported} / ${this.stats.turns}`),
        billing !== "subscription" && c.showCost ? [row("本轮估算费用", usd(this.stats.last?.costUsd)), row("本对话估算费用", usd(t.costUsd))] : null),
      h("p.cpop__why", null, "对话用量仅统计后端已报告的数据；Token 数不代表订阅剩余额度。"));
    this.placePop();
  }
}
