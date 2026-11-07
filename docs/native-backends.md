# 原生后端与项目归类（0.15.2.9）

设置 → 助手中现有五个选项：Claude Code、Codex、pi、Antigravity、DeepSeek Harness。新增两个选项启动用户安装的原生 ACP CLI；插件不会把 DeepSeek 模型 API 当作 Harness 的替代。

0.15.2.8 修复真实 XPI 资源加载和 Windows 等待进程生命周期；见 [安装链路验证](xpi-projects-validation.md)。

0.15.2.9 优化 Antigravity 续聊准备，减少本地服务等待和重复同步；原生模型请求的等待另见 [性能检查](antigravity-latency.md)。

## Codex

项目、原会话 ID 及会话名称使用本机 `codex app-server` 的原生接口同步。Codex 桌面侧栏另有本地项目目录，因此仅写入 app-server 项目并不会自动显示在侧栏。

升级并重启 Zotero，打开文献助手后，**首次请完全退出 Codex 桌面，等待约 5 秒再重新打开**。插件排队的辅助进程会在桌面退出后合并侧栏目录、原生项目 ID 映射及已知会话归属；已有目录名称、顺序和无关配置保留。后续同项目的新会话使用已有登记，不需每次重启。新增项目名称或工作目录时可能再次等待桌面退出。

队列位于 `$CODEX_HOME/integrations/zotero-agent/`，首次备份为 `$CODEX_HOME/.codex-global-state.json.zotero-agent.bak`。未设置 `CODEX_HOME` 时使用 `~/.codex`。辅助进程不会关闭客户端；等待最多 4 小时，超时后可在历史页点击同步重试。桌面文件格式检查不通过时显示错误，保留原文件。Zotero 使用的 CLI 与桌面须指向同一 Codex home。

## Claude Code

Claude Code 的原生项目按工作目录组织，历史存放在 `~/.claude/projects/<编码目录>/`；新对话的目录使用设置中的项目子目录，旧会话保留原始目录以确保原 ID 可续聊。改名使用官方 SDK `renameSession`，随后用 `listSessions({dir})` 重新确认原生项目归属与名称，确认后才显示同步成功。

这一适配对应 **Claude Code 原生目录项目**，不创建 Claude 网页版 Projects。无需额外原生扩展；SDK 随原 ACP bridge 安装。已在独立 `CLAUDE_CONFIG_DIR` 中使用真实官方 SDK 验证中文改名及项目读取。接口依据：[官方会话管理示例](https://platform.claude.com/cookbook/claude-agent-sdk-05-building-a-session-browser)。

## Antigravity

1. 安装 [Antigravity CLI](https://antigravity.google/docs/cli/acp/)，在终端确认 `agy acp --help` 可用。
2. 运行 `agy acp --login`，完成登录。
3. 在插件设置中选择 **Antigravity**。程序在 PATH 中时，“助手程序路径”留空；否则填写 `agy.exe` 等程序的绝对路径，不附加 `acp` 参数或两侧引号。
4. 默认复用 CLI 登录。需要 Gemini API key 时可切换为 API 密钥模式，密钥保存在 Zotero 系统登录管理器中，通过 `GEMINI_API_KEY` 传给子进程。订阅模式会排除继承的 Gemini/Google API key。

连接参数是 `agy acp`；会话和模型来自该 CLI。仅安装 Antigravity 桌面编辑器并不保证 PATH 中有 `agy`。配置依据：[Google 官方 ACP 指南](https://antigravity.google/docs/ide/extensions/acp/)。

### 原生项目和会话名称

原生项目需要同时安装 **Antigravity App** 与 `agy`。插件通过 App 本机元数据服务创建或复用设置中的项目，先在项目内创建原生会话，再让 `agy acp` 接续；ACP 与桌面共享 `~/.gemini/antigravity` 会话存储。App 已运行时复用其本机服务，未运行时可短暂启动已安装的元数据服务，操作完成后退出，不发送模型请求。

早期插件生成的会话位于 `~/.gemini/antigravity-cli`，桌面不能直接读取。升级会为本插件已知的旧会话制作 SQLite 一致性快照，再调用原生分叉接口在指定项目中接续；原文件和原会话保持不变，重复执行复用同一分叉。Zotero 侧保留原对话记录，更新其后端续聊 ID。原生名称写入会话摘要；空会话尚无摘要时显示待处理，第一条回复完成后重试确认。

缺少 App 时，CLI 聊天仍能使用，历史页会显示原生同步不可用的原因。非标准 App 安装目录可用环境变量 `ZOTERO_AGENT_ANTIGRAVITY_SERVER` 指向其 `language_server` 程序；`ZOTERO_AGENT_GEMINI_DIR` 可设置 Gemini 数据根目录，ACP 会使用相同路径。原生项目语义见 [官方 Projects 说明](https://antigravity.google/docs/projects?tab=cli)。

## DeepSeek Harness

1. 使用 Node.js **24.9+**，安装官方 CLI：`npm i -g @deepseek-ai/dsh`。
2. 运行 `dsh web` 或使用 Harness 自身配置，完成服务商与凭据设置。
3. 确认 `dsh --profile acp --help` 可用，在插件中选择 **DeepSeek Harness**。
4. 在 PATH 中时程序路径留空；自定义安装时填写 `dsh.cmd`（Windows）或 `dsh` 的绝对路径。

插件启动 `dsh --profile acp`，读取后端提供的分组模型及推理强度；不硬编码生产环境模型列表。续聊使用 `session/resume`，关闭使用 `session/close`，保留原生会话 ID 和工作目录。官方协议说明：[DeepSeek Harness ACP](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/README.md)、[ACP 应用配置](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/acp-app/README.md)。

### dsh 原生项目自动归类

0.15.2.6 起会自动安装配套扩展。升级 Zotero 插件并重启 Zotero 后，打开文献助手让它登记现有 dsh 历史，或发送第一条 dsh 消息，然后**完全退出并重新打开 dsh Desktop / dsh Web 宿主一次**。之后在 dsh 原生“工作区”侧栏可看到设置中的项目名称，默认 `Zotero Agent`；新会话无需再手动归类。

扩展位于 `$DSH_HOME/integrations/zotero-agent/projects.mjs`，通过 `$DSH_HOME/cordis.patch.yml` 中标记为 `BEGIN/END Zotero Agent native projects` 的块，仅在 `web` 和 `desktop` 宿主加载。已有 home patch 首次修改前备份为 `cordis.patch.yml.zotero-agent.bak`；其他设置保留。未设置 `DSH_HOME` 时使用 `~/.dsh`。Zotero 与 dsh 客户端需使用同一 DSH home。

项目写入由 dsh 原生 `WorkspaceRegistry` 执行，会发送侧栏更新；外部辅助程序只提交元数据，不直接覆盖 `workspace.json`。已有 Zotero dsh 会话按原 ID 回填，不复制对话正文。只登记本插件已知的会话，保留无关项目与会话。原生工作区按真实目录匹配；目录已有用户自定义项目名称时保留该名称。

首次扩展尚未加载时，历史页显示等待图标；重开 dsh 后，打开历史页或点击刷新按钮可更新确认状态。该功能目前同步项目归属，**对话重命名仍只在 Zotero 插件内保存**。原生 API 依据：[DSH WorkspaceRegistry](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/workspace/workspace/README.md)。

## 功能范围

| 功能 | Antigravity | DeepSeek Harness |
|---|---|---|
| 对话、工具步骤、权限确认、取消 | 支持 ACP 标准接口 | 支持 ACP 标准接口 |
| 模型与推理强度 | 读取已登录账号的实际选项 | 读取已配置服务商的实际选项 |
| 图片 | 仅后端声明支持时发送 | 仅后端声明支持时发送 |
| 历史记录、文章分组、自动恢复、本地改名 | 支持 | 支持 |
| 原生客户端项目／名称同步 | 安装 App 后支持项目归属及原生名称；旧 CLI 会话以原生分叉接续 | 配套扩展同步原生项目归属；会话名称留在插件内 |
| 阅读器选中文本翻译 | 暂未启用 | 暂未启用 |

阅读器翻译使用独立的无工具会话。两个新后端尚无经过验证的隔离配置，插件会给出明确提示；主对话不受影响。

## 本次验证

- 类型检查；两个后端的模拟 ACP 流程、权限确认、分组模型、推理强度、自定义路径与续聊测试。
- 用真实 Windows 进程验证带空格的程序路径，不依赖 `where.exe` 解析盘符路径。
- 浏览器验证五个后端选项、中文说明、窄侧栏布局、设置存储，以及两种后端的合成对话和文章关联。
- 0.15.2.5 的相关单元测试为 146 项；本次追加原生项目与配置保留检查，结果见 [原生项目验收](dsh-projects-validation.md)。
- 在临时 `DSH_HOME` 中使用官方 **@deepseek-ai/dsh 0.2.2-rc.1** 实际完成握手、新建持久会话、模型发现、关闭、第二个进程恢复同一会话；未提交模型推理请求。
- 本机现已安装 `agy 1.5.2`，已在隔离配置中验证原生项目、旧会话接续、中文改名与真实 ACP 续聊；未调用真实模型，真实 Zotero 升级后的交互仍需安装验收。
- dsh 原生项目已通过真实 Web 宿主和浏览器侧栏验收，并验证重启后仍保留；未调用模型。

源码回归：`npm test`。真实 DeepSeek 控制面检查可运行 `npm run test:native-dsh`，通过环境变量 `ZMC_DSH_EXECUTABLE` 指定 CLI；它使用临时配置，不提交模型推理。

0.15.2.7 的 Codex、Claude Code 与 Antigravity 验证范围、隔离方式及具体限制见 [本次原生项目验证](project-clients-validation.md)。
