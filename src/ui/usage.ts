// Account limits live outside the transcript. Polling never blocks Send or starts an agent session.
// The meter is a small gauge in the composer's toolbar: the ring is the remaining share of the tightest quota window,
// hover or focus shows a one-line tooltip ("每周 · 剩余 61%"), and a click opens the full breakdown.
import type { AccountUsage, BackendId } from "../types.ts";
import type { TranscriptState } from "./transcript.ts";
import { conversationUsage } from "./usage-model.ts";
import { env, fmtTokens, h, setKids, svg } from "./dom.ts";
import { getUiLanguage } from "./localize.ts";

function enQuotaText(s: string): string {
  return s
    .replace(/(\d+)\s*小时/g, "$1h")
    .replace(/(\d+)\s*天/g, "$1d")
    .replace(/(\d+)\s*分钟/g, "$1m")
    .replace(/主要额度/g, "Primary")
    .replace(/次要额度/g, "Secondary")
    .replace(/OAuth 应用/g, "OAuth apps")
    .replace(/高级请求/g, "Premium requests")
    .replace(/代码补全/g, "Completions")
    .replace(/聊天/g, "Chat")
    .replace(/模型额度/g, "Model quota")
    .replace(/充值余额/g, "Top-up balance")
    .replace(/赠送余额/g, "Granted balance")
    .replace(/账户余额请在服务商控制台查看。/g, "Check account balance in your provider console.")
    .replace(/账户余额/g, "Account balance")
    .replace(/不限量/g, "Unlimited")
    .replace(/此模型未提供账号额度查询。/g, "Quota lookup is not available for this model.")
    .replace(/此后端暂未接入账号额度查询；下方显示后端已报告的对话用量。/g, "Account quota is not available for this backend; reported conversation usage is shown below.")
    .replace(/此后端暂(?:未接入|不支持)账号额度查询。/g, "Quota lookup is not supported for this backend.")
    .replace(/请选择具体的 dsh 模型后查看对应账号额度。/g, "Choose a specific dsh model to look up its account quota.")
    .replace(/当前 dsh 模型路由无法确定账号，请选择具体服务商模型后重试。/g, "This dsh model route has no identifiable account; choose a concrete provider model and retry.")
    .replace(/未找到 DeepSeek Harness 账号登录，请先在 dsh 中登录。/g, "DeepSeek Harness is not signed in; sign in to dsh first.")
    .replace(/未找到 DeepSeek API 密钥[^。]*。/g, "No DeepSeek API key found; configure DEEPSEEK_API_KEY in dsh, then retry.")
    .replace(/当前账号未返回可用的订阅额度数据。/g, "No subscription quota data returned for this account.")
    .replace(/服务商未返回有效额度数据。/g, "No valid quota data returned by the provider.")
    .replace(/API 模式的账户余额和限额请在服务商控制台查看；下方显示后端已报告的对话用量。费用仅为后端估算。/g, "Check API balances and limits in your provider console; reported conversation usage is shown below.")
    .replace(/暂时无法刷新额度。/g, "Couldn't refresh quota right now.")
    .replace(/暂时无法获取(?:订阅)?额度，请检查(?:[^，]+)?登录状态和网络后刷新。/g, "Couldn't load quota. Check your sign-in and network, then refresh.");
}

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
    const signature = JSON.stringify([this.stats, context.showCost, getUiLanguage(this.el)]);
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
    const en = getUiLanguage(this.el) === "en";
    this.opening();
    this.hideTip();
    this.body = h("div.upop__body");
    this.refreshButton = h("button.btn.btn--sm.btn--quiet", { type: "button", onclick: () => void this.refresh(true) }, en ? "Refresh" : "刷新") as HTMLButtonElement;
    this.pop = h("div.menu.upop", { role: "dialog", "aria-label": en ? "Quota and usage details" : "额度与用量详情", tabindex: "-1",
      onkeydown: (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(true); } } },
      h("div.cpop__head", null, h("span.cpop__title", null, en ? "Quota & usage" : "额度与用量"), this.refreshButton), this.body);
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
    const en = getUiLanguage(this.el) === "en";
    const fmt = (s: string) => en ? enQuotaText(s) : s;
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
    const tokens = known ? (en ? `This chat ${fmtTokens((t.inputTokens ?? 0) + (t.outputTokens ?? 0))} tokens` : `本对话 ${fmtTokens((t.inputTokens ?? 0) + (t.outputTokens ?? 0))} Tokens`) : (en ? "Waiting for usage data" : "等待用量数据");
    const money = (b: NonNullable<AccountUsage["balances"]>[number]) => `${b.currency ? `${b.currency} ` : ""}${fmt(b.remaining)}`;
    const head = tight ? `${fmt(tight.label)} · ${expired(tight) ? (en ? "Pending refresh" : "待刷新") : (en ? `${pct(left(tight))} left` : `剩余 ${pct(left(tight))}`)}` : balances[0] ? `${fmt(balances[0].label)} · ${money(balances[0])}` : "";
    this.summary.textContent = head ? `${stale ? (en ? "Cached · " : "上次数据 · ") : ""}${head}` : this.loading ? (en ? "Checking quota…" : "额度查询中…") : billing === "api-key" ? tokens : (en ? "Quota unavailable" : "额度暂不可用");

    // The gauge: remaining share of the tightest live window; a full ring for a known balance; an empty track otherwise.
    const fill = tight && !expired(tight) ? left(tight) : !tight && balances.length ? 100 : 0;
    this.arc.setAttribute("stroke-dasharray", `${Number(fill.toFixed(1))} 100`);
    this.el.dataset.level = !stale && tight && !expired(tight) ? (left(tight) <= 10 ? "low" : left(tight) <= 30 ? "warm" : "") : "";
    this.el.dataset.state = this.loading && !a ? "loading" : tight || balances.length ? (stale || (tight && expired(tight)) ? "stale" : "ok") : "none";
    this.button.setAttribute("aria-label", en ? `Quota & usage: ${this.summary.textContent}. Show details` : `额度与用量：${this.summary.textContent}。点击查看详情`);
    this.placeTip();
    if (!this.body) return;

    const titleEl = this.pop?.querySelector(".cpop__title");
    if (titleEl) titleEl.textContent = en ? "Quota & usage" : "额度与用量";
    this.pop?.setAttribute("aria-label", en ? "Quota and usage details" : "额度与用量详情");
    if (this.refreshButton) { this.refreshButton.disabled = this.loading; this.refreshButton.textContent = this.loading ? (en ? "Refreshing…" : "刷新中…") : (en ? "Refresh" : "刷新"); }
    const time = (ms: number) => new Date(ms).toLocaleString(en ? "en-US" : "zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const row = (label: string, value: string) => [h("dt", null, label), h("dd", null, value)];
    const tok = (n: number | undefined) => n === undefined ? (en ? "Not reported" : "未报告") : fmtTokens(n);
    const usd = (n: number | undefined) => n === undefined ? (en ? "Not reported" : "未报告") : `$${n.toFixed(4)}`;
    const level = (w: Window) => expired(w) || stale ? "" : left(w) <= 10 ? "low" : left(w) <= 30 ? "warm" : "";
    const billingLabel = en ? { subscription: "Subscription", "api-key": "API key", account: "Account balance" }[billing] : { subscription: "订阅账号", "api-key": "API 模式", account: "账号余额" }[billing];
    setKids(this.body,
      h("div.upop__caption", null, `${c.backend}${a?.provider ? ` / ${a.provider}` : ""} · ${billingLabel}${a?.plan ? ` · ${a.plan}` : ""}`),
      windows.length ? h("div.upop__windows", null, windows.map(w => h("div.upop__window", { dataset: { stale: String(stale || expired(w)), level: level(w) } },
        h("div.cpop__head", null, h("span.upop__label", null, fmt(w.label)), h("strong.upop__pct", null, expired(w) ? (en ? "Pending refresh" : "等待刷新") : (en ? `${pct(left(w))} left` : `剩余 ${pct(left(w))}`))),
        h("div.upop__bar", { role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(left(w))), "aria-label": en ? `${fmt(w.label)} remaining quota` : `${w.label}剩余额度` },
          h("span.upop__fill", { style: `width:${expired(w) ? 0 : left(w)}%` })),
        h("p.cpop__why", null, en
          ? `${expired(w) ? "Reset time reached; refresh to check new quota" : `${pct(w.usedPercent)} used`}${w.resetsAt ? ` · Resets ${time(w.resetsAt)}` : " · Reset time not reported"}`
          : `${expired(w) ? "已到重置时间，刷新后确认新额度" : `已用 ${pct(w.usedPercent)}`}${w.resetsAt ? ` · ${time(w.resetsAt)} 重置` : " · 重置时间未报告"}`))))
        : !balances.length ? h("p.cpop__why", null, this.loading ? (en ? "Checking account quota…" : "正在查询账号额度…") : fmt(a?.message || this.error) || (en ? "No quota data available." : "暂无额度数据。")) : null,
      balances.length ? h("dl.cpop__facts.upop__balances", null, balances.map(b => row(fmt(b.label), money(b)))) : null,
      this.error && (windows.length || balances.length) ? h("p.upop__error", { role: "status" }, en ? `${fmt(this.error)} Showing the last fetched snapshot.` : `${this.error} 当前显示上次成功获取的数据。`) : null,
      a && (windows.length || balances.length) ? h("p.cpop__why", null, en ? `${stale ? "Cached" : "Updated"} ${time(a.checkedAt)} · Account quota includes usage across all clients` : `${stale ? "上次数据" : "更新于"} ${time(a.checkedAt)} · 账号额度包含其他客户端的使用`) : null,
      h("dl.cpop__facts", null,
        row(en ? "Last turn in / out" : "本轮输入 / 输出", `${tok(this.stats.last?.inputTokens)} / ${tok(this.stats.last?.outputTokens)} Tokens`),
        row(en ? "This chat in / out" : "本对话输入 / 输出", `${tok(t.inputTokens)} / ${tok(t.outputTokens)} Tokens`),
        row(en ? "Turns reporting tokens" : "已报告 Token 的轮次", `${this.stats.reported} / ${this.stats.turns}`),
        billing !== "subscription" && c.showCost ? [row(en ? "Last turn est. cost" : "本轮估算费用", usd(this.stats.last?.costUsd)), row(en ? "This chat est. cost" : "本对话估算费用", usd(t.costUsd))] : null),
      h("p.cpop__why", null, en ? "Chat usage only counts tokens reported by the backend; token counts do not represent remaining subscription quota." : "对话用量仅统计后端已报告的数据；Token 数不代表订阅剩余额度。"));
    this.placePop();
  }
}
