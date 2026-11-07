// Synthetic preview data only. Real quota adapters live in agent/ and assets/.
import type { AccountUsage, BackendId } from "../types.ts";

export function fakeAccountUsage(backend: BackendId, auth: "subscription" | "api-key", model?: string): AccountUsage {
  const base = { checkedAt: Date.now(), windows: [] };
  if (auth === "api-key" && backend !== "pi" && backend !== "deepseek-harness") return { ...base, status: "api-key", message: "账户余额请在服务商控制台查看。" };
  if (backend === "deepseek-harness") return { ...base, status: "available", provider: "DeepSeek", billing: "account", balances: [
    { label: "充值余额", remaining: "23.45", currency: "CNY" }, { label: "赠送余额", remaining: "0.00", currency: "CNY" },
  ] };
  if (backend === "pi" && !model?.includes("/")) return { ...base, status: "unsupported", message: "此模型未提供账号额度查询。" };
  return { ...base, status: "available", plan: backend === "claude-code" ? "Max" : backend === "antigravity" ? "AI Pro" : "plus",
    provider: backend === "pi" ? model?.split("/")[0] : backend,
    windows: [
      { id: `${backend}/primary`, label: backend === "antigravity" ? "Gemini · 5小时" : "5小时", usedPercent: 27, resetsAt: Date.now() + 7_200_000 },
      { id: `${backend}/secondary`, label: backend === "antigravity" ? "Gemini · 7天" : "7天", usedPercent: 8, resetsAt: Date.now() + 345_600_000 },
    ] };
}
