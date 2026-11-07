# 0.15.2.8：真实 Zotero / XPI 项目同步验证

2026-11-07。本机已安装 0.15.2.7，多个后端的历史记录均出现 `NS_ERROR_FAILURE [nsIURI.username]`。实际原因是 `Zotero.File.getContentsFromURLAsync()` 使用 HTTP 请求，不能正确处理包含 `chat@zotero-mcp.xpi` 的 jar URL。此前 Node、浏览器和原生后端检查没有经过这条打包资源加载路径。

修复使用系统主体的 Gecko `nsIChannel` 读取 UTF-8 本地资源，避免 HTTP 凭据解析。测试必须从 `jar:file:.../chat@zotero-mcp.xpi!/` 启动，不能用解包目录代理代替。

真实集成检查还发现，Gecko 在 Windows 上为每个 Subprocess 创建 job，并在辅助命令结束后终止其中的所有子进程。Node 的 `detached` 不会离开该 job。因此 Codex 等待进程即使已启动，也可能在用户退出桌面前就被终止。修复使用 `CREATE_BREAKAWAY_FROM_JOB | CREATE_NO_WINDOW`；Gecko 的 job 明确允许 breakaway。检查会在辅助命令结束后读取工作进程 PID，并用另一次真实 Gecko Subprocess 确认其仍然存活。

运行 `npm run test:xpi-projects`，可通过 `ZMC_ZOTERO_BIN` 指定 Zotero 程序，`ZMC_CLAUDE_BRIDGE_DIR` 指向本机已安装的 Claude bridge（仅复用 SDK 源码）。脚本创建唯一 `.dev-xpi-projects-*` 目录，明确固定 Zotero profile、空白文献库，以及 Codex/Gemini/Claude/dsh 数据目录；不操作用户文献库，不调用模型。

测试经实际 `PanelHost.syncSession` 验证：

- Codex：真实 app-server 接收原会话归属，侧栏登记排队，等待进程在辅助命令退出后仍存活。
- Antigravity：原生项目 ID 和合成摘要的中文改名均确认成功。
- Claude Code：官方 SDK 确认原生目录项目及中文名称。
- dsh：配套脚本成功从 XPI 提取并执行，队列写入成功，尚无原生宿主时明确保持待处理。

导出的三个配套脚本均逐字节比对源码。机器可读报告位于 `test-output/xpi-projects-report.json`。该报告区分原生确认与待重启登记，不宣称所有待处理客户端侧栏已完成刷新。
