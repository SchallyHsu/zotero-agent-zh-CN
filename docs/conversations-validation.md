# 项目与文章会话验证（0.15.2.4）

验证日期：2026-11-07。环境：Windows，Node.js 24.15.0，Playwright 使用已安装的 Microsoft Edge。

已通过：

- TypeScript 类型检查、XPI 构建和 `git diff --check`。
- `node --test test/ui/*.test.ts test/agent/session-metadata.test.ts`：129 项通过，0 失败。
- 原有中文界面检查：正文和输入值保护、动态文案、设置读取不修改值、深色模式，无页面脚本错误。
- `scripts/verify-conversations.cjs`：默认项目与设置保存、改名后续聊、两篇文章的会话隔离与恢复、草稿保留、同文多会话、快速切换、回复完成后再切换、恢复最近打开的旧会话、关闭自动恢复、历史分组和搜索。
- `npm run test:native-codex`：真实安装的 Codex CLI，隔离 `CODEX_HOME`，中文名称持久保存，两个不同工作目录的原生会话复用一个项目，两段会话均有正确项目归属。

测试数据均为合成数据。真实 Codex 检查仅运行本地会话和元数据接口，没有启动模型推理，也没有读取真实 Codex 历史或 Zotero 文献库。

本次未将新 XPI 安装到真实 Zotero 用户配置中进行交互验收。Claude Code / pi 的 SDK 改名适配已实现，但未进行真实后端验收。Codex 的项目接口为实验接口，较旧客户端可能不支持；同步失败会保留本地名称，并在历史记录显示重试入口。

复现：安装开发依赖，设置 `BROWSER_EXECUTABLE` 指向 Edge/Chrome（或安装 Playwright Chromium），运行 `npm test`、上面的 129 项测试命令、`npm run test:native-codex` 和 `npm run build`。完整上游测试的既有平台限制仍见原验证文档；本记录不宣称完整上游测试通过。
