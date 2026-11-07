# dsh 原生项目修复验证（0.15.2.6）

2026-11-07，Windows，Node.js 24.15.0，官方 `@deepseek-ai/dsh 0.2.2-rc.1`，浏览器使用 Microsoft Edge。全部测试使用临时 `DSH_HOME`，不读取真实 dsh 配置、项目或凭据，不启动模型推理。

真实回归由 `scripts/verify-dsh-projects.mjs` 执行：

1. 创建一个普通原生会话，启动 dsh Web，使项目注册表完成初始化；保存该项目作为不相关数据基线。
2. 关闭 Web 宿主，通过原生 ACP 在新目录创建会话；确认其存在于原生持久会话中，却不在已经初始化的项目注册表里，复现本次问题。
3. 安装带有原配置备份的本地配套扩展，提交项目登记，重新启动真实 Web 宿主。
4. 验证扩展通过 `WorkspaceRegistry` 创建项目并附加已知 Zotero 会话；旧原生项目保持一致。
5. 在 Web 宿主运行中创建新的 ACP 会话，验证它进入同一原生项目，不产生重复项目；重复登记不重写原生记录。
6. 用浏览器打开 dsh 自己打印的认证 URL，确认真实侧栏可见 `Zotero Agent`，保存截图。
7. 重启 Web 宿主，确认原项目 ID 与会话归属持久保留。

单元测试额外覆盖用户 home patch 保留与备份、重复安装、无效配置拒绝覆盖、已知会话范围、不相关同目录会话排除，以及原生会话尚不可见时不能误报成功。

相关单元测试 **151 项通过、0 失败**；`npm test`、类型检查和 XPI 构建通过。界面回归还覆盖等待原生确认的状态刷新。

复现前安装开发依赖及 dsh CLI。`ZMC_DSH_EXECUTABLE` 可指定原生 CLI；`ZMC_DSH_ENTRY` 可指定 npm 包的 `lib/bin.js` 供开发验证。设置 `BROWSER_EXECUTABLE` 为浏览器路径后运行 `npm run test:native-dsh-projects`，会包含真实侧栏检查；报告和截图保存到 `test-output/`。

该检查不替代真实 Zotero 用户配置中的升级安装验收，也不宣称 Antigravity 原生项目同步或 dsh 会话改名同步已实现。
