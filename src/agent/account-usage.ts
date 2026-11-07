// Read-only account queries. No thread/session creation, model calls or credential-file reads.
import type { AccountUsage, BackendId, Spawner } from "../types.ts";
import { backendOf, findCli } from "./backends.ts";
import { cleanEnv, stripApiKeys } from "./env.ts";
import { JsonRpcError, JsonRpcPeer } from "./jsonrpc.ts";

const obj = (v: unknown): Record<string, unknown> | undefined => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function duration(mins: unknown, fallback: string): string {
  if (!finite(mins) || mins <= 0) return fallback;
  if (mins % 1440 === 0) return `${mins / 1440}天`;
  if (mins % 60 === 0) return `${mins / 60}小时`;
  return `${mins}分钟`;
}

/** Supports old single-bucket and new multi-bucket app-server responses; absent/invalid fields stay unknown. */
export function codexAccountUsage(value: unknown, checkedAt = Date.now()): AccountUsage {
  const root = obj(value);
  const multi = obj(root?.rateLimitsByLimitId);
  const single = obj(root?.rateLimits);
  const buckets = new Map<string, Record<string, unknown>>();
  if (multi) for (const [id, v] of Object.entries(multi)) { const b = obj(v); if (b) buckets.set(id, b); }
  if (single) {
    const id = typeof single.limitId === "string" ? single.limitId : "codex";
    if (!buckets.has(id)) buckets.set(id, single);
  }
  const windows: AccountUsage["windows"] = [];
  let plan: string | undefined;
  for (const [id, b] of buckets) {
    if (!plan && typeof b.planType === "string") plan = b.planType;
    const name = typeof b.limitName === "string" && b.limitName.trim() ? b.limitName.trim() : id;
    for (const key of ["primary", "secondary"] as const) {
      const w = obj(b[key]);
      if (!w || !finite(w.usedPercent) || w.usedPercent < 0) continue;
      const label = duration(w.windowDurationMins, key === "primary" ? "主要额度" : "次要额度");
      windows.push({ id: `${id}/${key}`, label: id === "codex" ? label : `${name} · ${label}`,
        usedPercent: Math.min(100, w.usedPercent),
        ...(finite(w.resetsAt) && w.resetsAt > 0 && w.resetsAt < 8.64e12 ? { resetsAt: w.resetsAt * 1000 } : {}) });
    }
  }
  return { status: windows.length ? "available" : "unavailable", checkedAt, windows, ...(plan ? { plan } : {}),
    ...(!windows.length ? { message: "当前账号未返回可用的订阅额度数据。" } : {}) };
}

export async function readAccountUsage(spawner: Spawner, backend: BackendId, auth: "subscription" | "api-key", executable?: string, timeoutMs = 12_000): Promise<AccountUsage> {
  const result = (status: AccountUsage["status"], message: string): AccountUsage => ({ status, message, checkedAt: Date.now(), windows: [] });
  if (auth === "api-key") return result("api-key", "API 模式的账户余额和限额请在服务商控制台查看；下方显示后端已报告的对话用量。费用仅为后端估算。" );
  if (backend !== "codex") return result("unsupported", "此后端暂未接入账号额度查询；下方显示后端已报告的对话用量。" );
  const env = cleanEnv(stripApiKeys(await spawner.baseEnv(), backendOf(backend).apiKeyVars));
  const cli = await findCli(spawner, env, backendOf(backend), executable);
  if (!cli) return result("unavailable", "未找到 Codex，请在设置中检查可执行文件路径。" );
  const proc = await spawner.spawn(cli, ["app-server"], { env });
  const peer = new JsonRpcPeer(proc);
  const timer = setTimeout(() => { peer.close("Account usage timed out"); void proc.kill().catch(() => {}); }, timeoutMs);
  try {
    await peer.request("initialize", { clientInfo: { name: "zotero_agent_usage", version: "1.0.0" } });
    peer.notify("initialized");
    return codexAccountUsage(await peer.request("account/rateLimits/read"));
  } catch (e) {
    return result("unavailable", e instanceof JsonRpcError && e.rpc.code === -32601
      ? "当前 Codex 版本不支持额度查询，请更新 Codex 后重试。"
      : "暂时无法获取订阅额度，请检查 Codex 登录状态和网络后刷新。" );
  } finally {
    clearTimeout(timer);
    peer.close();
    await proc.kill();
  }
}
