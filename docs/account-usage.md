# 额度与用量（0.15.2.11）

输入框底部工具栏右侧的“额度与用量”环形仪表图标实时显示最紧迫额度窗口的剩余比例，悬停显示胶囊摘要提示（如 `5小时 · 剩余 73%`），点击展开详情弹窗。它与旁边的上下文圆环分别表示账号配额和当前对话的上下文占用。

| 接入方式 | 当前显示 |
| --- | --- |
| Codex 订阅 | 真实额度窗口的剩余百分比、套餐（后端提供时）、重置时间 |
| Claude Code 订阅 | 5 小时、7 天，以及服务端提供的 Sonnet／Opus 等独立额度和重置时间 |
| Antigravity 账号 | 本地原生服务返回的模型额度组及各窗口；旧服务退回逐模型额度 |
| DeepSeek Harness 原生账号 | 当前账号的充值余额、赠送余额及原币种，保留精确的小数字符串 |
| pi / dsh 的第三方模型 | 按当前模型服务商匹配本后端自己的凭据：Claude、ChatGPT/Codex、GitHub Copilot、Gemini CLI、Google Antigravity；DeepSeek API 可显示账户余额 |
| 其他 API 密钥 | 已报告的 Token；开启“显示词元与费用”后显示后端估算费用。未提供查询接口的账户额度到服务商控制台查看 |

显示的额度属于账号，包含其他客户端的使用。窗口名称按服务端返回的时长生成，并不固定假设 5 小时／7 天；多额度桶分别展示。百分比不转换成可用对话次数，Token 不转换成订阅额度，订阅模式不展示 API 美元估算。

查询失败时保留上次成功数据并明确标记；超过两分钟的数据也标为“上次数据”。到重置时间后显示“待刷新”，需要服务端确认新额度。没有返回 Token 的轮次不会被当作零，详情给出已报告轮次，累计值仅包含已报告数据。Token 来自插件已有的 `turn_end.usage` 事件；后端若不报告，详情会显示“未报告”。pi 和 dsh 自行按模型管理登录方式，因此即使旧设置的认证偏好为 API，也会按实际服务商凭据查询。

## 数据来源与运行方式

Codex 使用 [官方 app-server 文档](https://developers.openai.com/codex/app-server#6-rate-limits-chatgpt) 的 `initialize` → `initialized` → `account/rateLimits/read`，复用本机 Codex 的登录和可执行文件设置，兼容 `rateLimits` 及 `rateLimitsByLimitId`。`resetsAt` 从 Unix 秒转换为毫秒后按本地时区显示。

其他后端通过单独的 Node 辅助进程查询：Claude 复用 `CLAUDE_CONFIG_DIR/.credentials.json` 或默认目录、macOS 默认登录的钥匙串；pi 使用 `PI_CODING_AGENT_DIR/auth.json`（默认 `~/.pi/agent`）；dsh 使用 `DSH_HOME/.credentials.yaml`（默认 `~/.dsh`），并复用已安装 dsh 的 YAML 解析库。辅助进程仅在内存中读取当前服务商凭据，不改写凭据、不自行刷新令牌、不执行凭据配置中的 shell 命令；输出仅含标准化额度，凭据不会传入 UI、聊天记录或查询日志。登录过期时提示在原客户端刷新登录。

Antigravity 复用原生本地服务 `RetrieveUserQuotaSummary` 和 `GetUserStatus`；无运行中的服务时沿用已有的短期原生服务启动方式。Claude 和部分 pi／dsh 服务商使用当前客户端兼容接口，它们并非稳定的公共额度 API，服务商升级可能导致暂不可用。对应接口失败、缺少登录或不支持的模型路由会明确提示，不跨后端借用别的账号数据，也不从历史日志猜测余额。自定义 DSH 平台域名、GitHub Enterprise、无法确认的模型路由及其他未列出的服务商暂不查询。

所有网络目标限定为对应服务商固定域名，拒绝携带凭据的重定向；dsh 原生余额要求 grant 的 issuer 与 DeepSeek 平台相符。不创建模型对话、不提交推理。Codex RPC 最长等待 12 秒，其他后端网络调用各 8 秒、辅助进程总计最多 30 秒；额度快照只在面板内存中保留。

打开面板及切换模型／服务商时刷新；每轮回复结束及可见面板每分钟检查是否需要刷新。普通查询间隔至少 30 秒，Claude 至少 5 分钟，429 自动等待 5 分钟。手动刷新可立即重试，也可用于在原客户端更换账号后更新数据。查询与聊天独立，失败不会阻止发送；切换后端、认证模式、pi／dsh 模型或可执行文件配置时废弃旧查询。关闭面板清理轮询。

字段依据：[Claude Code 状态行额度字段](https://code.claude.com/docs/en/statusline#rate-limit-usage)、[Antigravity CLI 额度说明](https://antigravity.google/docs/cli/credits)、[pi 配置与凭据位置](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/configuration.md)、[OpenAI 原生额度请求实现](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs)，以及本机已安装的 `@deepseek-ai/dsh` 0.2.2-rc.1 的 `dsh-deepseek-account-platform`／`dsh-credentials-local`／`dsh-llm-pi-ai` 实现。兼容适配器为本项目实现，不包含第三方客户端源码。

## 验证

`npm test` 包含各后端额度格式、精确余额、缺失／非法字段、超时／回收、服务商和凭据匹配、默认 API 偏好兼容、重定向限制、过期／限流、模式与模型切换竞态、断网继续聊天、320px 深色布局和用量累计回归。界面使用合成数据；截图与报告在 `test-output/usage/`。

`npm run test:native-usage` 是可选真实账号检查，需要本机 Codex 已登录；读取当前账号额度并仅记录成功状态、窗口数量及是否有重置时间，不记录凭据或额度值，不调用模型。报告在 `test-output/usage/native-codex.json`。

`npm run test:native-other-usage` 记录其他本机账号的可用性；通过 `ZMC_PI_USAGE_MODEL` 可指定 pi 当前模型。仅输出状态、额度窗口／余额数量及是否存在重置时间，不输出具体额度或凭据。

2026-11-07 本机验证：完整 `npm test` 通过。真实已登录 Codex 返回两个额度窗口；Antigravity 返回五个有效窗口及重置时间；DeepSeek Harness 返回两项原生账户余额。Claude 本机令牌已过期，实际验证了过期提示，其成功响应使用合成测试；pi 没有已配置账号，按服务商分流、请求和响应使用合成测试，未宣称已验证真实账号。所有检查均不提交模型推理。发布检查没有替换日常使用的 Zotero 安装。
