// Account limits live outside the transcript. Polling never blocks Send or starts an agent session.
import type { AccountUsage, BackendId } from "../types.ts";
import type { TranscriptState } from "./transcript.ts";
import { conversationUsage } from "./usage-model.ts";
import { env, fmtTokens, h, setKids } from "./dom.ts";

interface UsageContext {
  backend: BackendId;
  auth: "subscription" | "api-key";
  model?: string;
  /** Changing executable configuration invalidates the old account snapshot too. */
  executable: string;
  showCost: boolean;
  transcript: TranscriptState;
}

export class UsageMeter {
  readonly el: HTMLElement;
  private button: HTMLButtonElement;
  private summary = h("span.umeter__summary");
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

  constructor(read: (backend: BackendId, auth: "subscription" | "api-key", model?: string) => Promise<AccountUsage>, opening: () => void) {
    this.read = read;
    this.opening = opening;
    this.button = h("button.umeter__button", { type: "button", "aria-label": "额度与用量", "aria-haspopup": "dialog", "aria-expanded": "false",
      onclick: () => this.pop ? this.close(true) : this.open() }, h("span", null, "额度与用量"), this.summary) as HTMLButtonElement;
    this.el = h("div.umeter", null, this.button);
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
  inside(path: EventTarget[]): boolean { return path.includes(this.el); }

  close(focus = false): void {
    this.pop?.remove();
    this.pop = this.body = null;
    this.refreshButton = null;
    this.button.setAttribute("aria-expanded", "false");
    if (focus) this.button.focus();
  }

  dispose(): void { this.disposed = true; this.generation++; env.win.clearInterval(this.timer); this.close(); }

  private open(): void {
    this.opening();
    this.body = h("div.upop__body");
    this.refreshButton = h("button.btn.btn--sm.btn--quiet", { type: "button", onclick: () => void this.refresh(true) }, "刷新") as HTMLButtonElement;
    this.pop = h("div.menu.upop", { role: "dialog", "aria-label": "额度与用量详情", tabindex: "-1",
      onkeydown: (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(true); } } },
      h("div.cpop__head", null, h("span.cpop__title", null, "额度与用量"), this.refreshButton), this.body,
      h("button.btn.btn--sm.btn--quiet", { type: "button", onclick: () => this.close(true) }, "关闭"));
    this.el.appendChild(this.pop);
    this.button.setAttribute("aria-expanded", "true");
    this.paint();
    this.pop.focus();
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
    const expired = (w: AccountUsage["windows"][number]) => w.resetsAt !== undefined && w.resetsAt <= now;
    const remaining = (used: number) => `${Number(Math.max(0, 100 - used).toFixed(1))}%`;
    const short = windows.slice(0, 2).map(w => `${w.label} ${expired(w) ? "待刷新" : `剩余 ${remaining(w.usedPercent)}`}`).join(" · ");
    const t = this.stats.total;
    const known = t.inputTokens !== undefined || t.outputTokens !== undefined;
    const tokens = known ? `${fmtTokens((t.inputTokens ?? 0) + (t.outputTokens ?? 0))} Tokens` : "等待用量数据";
    const balanceText = balances.slice(0, 2).map(b => `${b.label} ${b.currency ? `${b.currency} ` : ""}${b.remaining}`).join(" · ");
    this.summary.textContent = short || balanceText ? `${stale ? "上次数据 · " : ""}${short || balanceText}` : this.loading ? "查询中…" : billing === "api-key" ? tokens : "额度暂不可用";
    this.button.title = this.summary.textContent;
    this.el.dataset.level = !stale && windows.some(w => !expired(w) && w.usedPercent >= 90) ? "low" : "";
    if (!this.body) return;
    if (this.refreshButton) { this.refreshButton.disabled = this.loading; this.refreshButton.textContent = this.loading ? "刷新中…" : "刷新"; }
    const time = (ms: number) => new Date(ms).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const row = (label: string, value: string) => [h("dt", null, label), h("dd", null, value)];
    const tok = (n: number | undefined) => n === undefined ? "未报告" : fmtTokens(n);
    const money = (n: number | undefined) => n === undefined ? "未报告" : `$${n.toFixed(4)}`;
    setKids(this.body,
      h("div.upop__caption", null, `${c.backend}${a?.provider ? ` / ${a.provider}` : ""} · ${{ subscription: "订阅账号", "api-key": "API 模式", account: "账号余额" }[billing]}${a?.plan ? ` · ${a.plan}` : ""}`),
      windows.length ? windows.map(w => h("div.upop__window", { dataset: { stale: String(stale || expired(w)) } },
        h("div.cpop__head", null, h("span", null, w.label), h("strong", null, expired(w) ? "等待刷新" : `剩余 ${remaining(w.usedPercent)}`)),
        h("progress", { max: "100", value: String(100 - w.usedPercent), "aria-label": `${w.label}剩余额度` }),
        h("p.cpop__why", null, `${expired(w) ? "已到重置时间，刷新后确认新额度" : `已用 ${Number(w.usedPercent.toFixed(1))}%`}${w.resetsAt ? ` · ${time(w.resetsAt)} 重置` : " · 重置时间未报告"}`)))
        : !balances.length ? h("p.cpop__why", null, this.loading ? "正在查询账号额度…" : a?.message || this.error || "暂无额度数据。") : null,
      balances.length ? h("dl.cpop__facts", null, balances.map(b => row(b.label, `${b.currency ? `${b.currency} ` : ""}${b.remaining}`))) : null,
      this.error && (windows.length || balances.length) ? h("p.upop__error", { role: "status" }, `${this.error} 当前显示上次成功获取的数据。`) : null,
      a && (windows.length || balances.length) ? h("p.cpop__why", null, `${stale ? "上次数据" : "更新于"} ${time(a.checkedAt)} · 账号额度包含其他客户端的使用`) : null,
      h("dl.cpop__facts", null,
        row("本轮输入 / 输出", `${tok(this.stats.last?.inputTokens)} / ${tok(this.stats.last?.outputTokens)} Tokens`),
        row("本对话输入 / 输出", `${tok(t.inputTokens)} / ${tok(t.outputTokens)} Tokens`),
        row("已报告 Token 的轮次", `${this.stats.reported} / ${this.stats.turns}`),
        billing !== "subscription" && c.showCost ? [row("本轮估算费用", money(this.stats.last?.costUsd)), row("本对话估算费用", money(t.costUsd))] : null),
      h("p.cpop__why", null, "对话用量仅统计后端已报告的数据；Token 数不代表订阅剩余额度。"));
  }
}
