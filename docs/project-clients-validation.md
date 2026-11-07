# 原生项目同步验证：0.15.2.7

2026-11-07，Windows / Node.js 24.15.0。本机 Codex CLI 0.166.0，Codex 桌面 26.1103.4239.0，agy 1.5.2，官方 Claude Agent SDK 0.3.286。检查使用临时 Codex、Gemini 和 Claude 配置目录，不调用模型，不修改真实客户端项目或对话。

相关单元测试 **157 项通过、0 失败**；`npm test` 的类型、界面及会话回归和 XPI 构建通过。

## Codex

`npm run test:native-codex` 使用真实 app-server 创建合成持久会话，确认中文名称、原会话 ID、多个工作目录复用单一项目以及 `thread/read.projectId` 的持久值。

另外检查已安装桌面程序的实际项目缓存格式，确认 app-server 项目不会自动进入 `local-projects` 侧栏目录。辅助程序单元检查覆盖：客户端运行时不写入，退出后再次检查进程和原文件内容，备份、合并本地项目、`local:<CODEX_HOME>` 项目映射以及 `{projectKind,projectId}` 形式的会话归属；无关配置、顺序、自定义名称和会话保留，重复登记不重写文件。

真实桌面进程的检测已在本机验证。自动写入与保留检查在隔离的桌面目录中执行；本轮未关闭当前用户的 Codex 桌面，也未宣称已替用户完成侧栏升级验收。安装后首次完全退出、等待约 5 秒再打开是必要步骤。

## Antigravity

`scripts/verify-project-clients.mjs` 使用已安装 App 的真实元数据服务：创建项目和原生会话，检查持久 `metadata.projectId`；复制真实格式的空会话快照到隔离旧 CLI 存储，然后执行一致性导入及原生分叉，确认重复迁移不会再次分叉，源 SQLite 文件逐字节保持不变。

中文改名测试为该空会话写入一条合成的原生摘要行，随后通过真实 `UpdateConversationAnnotations` 修改，再重启服务，用 `GetAllCascadeTrajectories` 确认原生摘要中的中文名称。这样可以验证名称持久化而不调用模型。生产代码对尚无摘要的空会话保持待处理，首条真实回复完成后再确认。

测试还实际启动 `agy acp`，在独立 Gemini 目录中通过 `session/resume` 接续预创建的 App 会话，验证原 ID 和项目归属；使用无效测试 API key，仅做握手和续聊，没有提交提示或推理请求。协议单元测试另外覆盖 ACP 的 App 数据目录参数和预创建新会话仍发送一次 Zotero 上下文说明。

元数据服务使用自身绑定的随机端口，并通过包含匹配进程 ID 和本地令牌的发现文件确认就绪；避免预占、释放端口与原生其他监听器之间的竞争。辅助进程退出时只清理自身的发现文件。

## Claude Code

在独立 `CLAUDE_CONFIG_DIR` 中创建一份合成 JSONL 历史，调用真实已安装 bridge 的官方 SDK 完成中文改名，再用原生目录查询确认同一会话归属及名称。不会把 Claude Code 的目录项目描述成 Claude 网页版 Projects，也未宣称测试了未安装的 Claude 桌面界面。

## 复现与报告

先安装开发依赖及对应本机客户端。设置 `ZMC_CLAUDE_BRIDGE_DIR` 为包含已安装 `claude-agent-acp` 的 bridge 目录后运行 `npm run test:native-project-clients`；可用 `ZMC_AGY_EXECUTABLE` 指定 agy。非标准 App 路径用 `ZOTERO_AGENT_ANTIGRAVITY_SERVER` 指定。

机器可读结果保存在 `test-output/project-clients-native-report.json` 与 `test-output/native-sync-report.json`。常规类型、界面和协议回归运行 `npm test`；dsh 的实际原生侧栏验证仍由独立 `npm run test:native-dsh-projects` 执行。
