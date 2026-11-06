# Zotero Agent 简体中文（非官方）

基于 [54yyyu/zotero-mcp](https://github.com/54yyyu/zotero-mcp) 的 Zotero Agent 插件制作的**非官方简体中文衍生版**。主要工作是界面汉化和汉化层刷新性能优化；原插件的模型接入、文献读取、对话、工具调用等核心功能来自原项目及其贡献者。

**上游版本：** [v0.15.2](https://github.com/54yyyu/zotero-mcp/tree/v0.15.2/plugin) · **上游提交：** [`dfec70c8b772e697476e0b42c1264441cf518686`](https://github.com/54yyyu/zotero-mcp/commit/dfec70c8b772e697476e0b42c1264441cf518686) · **本版：** `0.15.2.3`

本项目不是 Zotero 或 Zotero MCP 官方发布，不代表原作者背书。请先了解原项目，并将通用功能问题与本仓库的汉化问题区分开。

## 下载与安装

1. 从 [Releases](https://github.com/SchallyHsu/zotero-agent-zh-CN/releases) 下载 `zotero-agent-zh-CN-0.15.2.3.xpi`，校验文件为 `SHA256SUMS.txt`。
2. 打开 Zotero → **工具 → 插件**，点击齿轮，选择“从文件安装插件”，选取 `.xpi`；按提示重新启动 Zotero。
3. 从工具栏“文献助手”按钮打开侧栏，完成原插件要求的 `zotero-cli` 和模型后端配置。详细要求见 [上游插件文档](https://github.com/54yyyu/zotero-mcp/blob/v0.15.2/docs/chat-plugin.md)。

插件保留原 ID `chat@zotero-mcp`，因此会替换已安装的官方插件，不能与其并行安装。安装前可正常退出 Zotero，并备份原 `.xpi`；需要恢复时重新安装官方版本。本项目不会提供或更改你的账号配置。

**兼容性：** 上游声明支持 Zotero 7+，实际桌面验证环境为 Windows 11 / Zotero 10.0.7；其他平台及版本尚未逐一实测。

**更新行为：** 保留上游自动更新地址。未来官方版本更新可能将界面恢复为英文；本仓库没有独立的自动更新服务。

## 汉化内容

- 对话主页、输入提示、菜单、按钮、历史记录、运行状态及设置页。
- 模型、推理强度、权限等界面说明，以及上下文用量、工具步骤、技能和提示词管理的界面标签。
- Zotero 工具栏、设置页入口和阅读器翻译弹窗的界面文案。
- 中文日期格式和常见中文字体回退。

论文题名、DOI、文献搜索结果、用户与助手的正文、输入框已有内容、存储的提示词、模型/权限 ID 和命令输出不做界面翻译。第三方返回的未知错误和部分动态名称可能保留英文。界面汉化也不等于自动翻译论文全文。

![对话主页预览：使用合成测试数据](docs/images/home.png)

<details>
<summary>中文设置页预览（合成测试数据）</summary>

![设置页预览](docs/images/settings.png)

</details>

## 性能改动

最初的本地汉化层会在回复更新时重复遍历正文。本版跳过正文子树，保留复制按钮的界面翻译；合并重复的 DOM 更新，仅处理发生改变的属性，避免翻译自身再次触发扫描，并对常用标签设置有限大小的缓存。

在同一台电脑的无界面 Edge 中，每轮模拟 400 段正文的 50 次更新、各运行三次：旧汉化层累计回调耗时中位数为 **382.5 ms**，优化后为 **4.0 ms**。这是特定合成负载下的汉化层开销，不代表整个 Zotero 的加速比例，也未测量模型或网络耗时。原始结果见 [性能记录](docs/performance-results.json)，可使用下方命令复测。

## 从源码构建

需要 Node.js 24+、npm，以及可在命令行运行的 `zip`。构建方式沿用上游；安装开发依赖时请使用锁文件。

```bash
git clone https://github.com/SchallyHsu/zotero-agent-zh-CN.git
cd zotero-agent-zh-CN
npm ci
npm run typecheck
npm run build
```

生成的安装包为 `dist/zotero-agent.xpi`。完整源码、构建脚本、锁文件、许可证与来源说明均在本仓库中；下载对应的 `zh-CN-v0.15.2.3` 源码标签可获得该发布版的源码。

## 验证与开发预览

```bash
npx playwright install chromium
npm test
npm run test:performance
```

`npm test` 会执行类型检查、构建预览并运行界面检查；单独构建预览可运行 `npm run preview`。预览入口为 `preview/dist/index.html`。界面检查覆盖主页、设置、历史、状态、深色主题、动态文案、正文保护、输入值与权限 ID；仅使用合成数据，不读取 Zotero 文献库。生成的报告和截图位于 `test-output/`，不会提交到版本库。

如需使用已安装的 Edge/Chrome，可设置进程环境变量 `BROWSER_EXECUTABLE` 为其可执行文件路径，再运行界面与性能检查。界面检查和性能比较不需要连接模型服务。

默认 `npm test` 聚焦本次汉化改动；保留的上游完整测试可运行 `npm run test:upstream`，但在本机遇到符号链接权限和跨平台路径断言失败，未宣称全套测试通过。完整边界见 [验证记录](docs/VALIDATION.md)。

## 来源、修改与许可证

1. 原项目为 **[54yyyu/zotero-mcp](https://github.com/54yyyu/zotero-mcp)**。本仓库提取其 `plugin/` 目录，保留原实现、素材、测试与构建文件；来源信息见 [UPSTREAM.json](UPSTREAM.json)。
2. **插件目录明确使用 AGPL-3.0-or-later**。本插件及其汉化、优化改动按同一许可发布，全文见 [LICENSE](LICENSE)。原仓库根目录的 MIT 声明另行保存在 [LICENSES/upstream-root-MIT.txt](LICENSES/upstream-root-MIT.txt)，它不替代插件的 AGPL 许可。
3. 修改日期、文件范围及新旧版本关系见 [NOTICE.md](NOTICE.md) 与 [CHANGELOG.md](CHANGELOG.md)。原作者声明和许可证予以保留；本仓库不将原插件宣称为独立原创。
4. 安装包包含 AGPL 许可证、修改声明、源码获取地址及 [第三方组件声明](THIRD_PARTY_NOTICES.md)，并保留 KaTeX、Marked 的完整 MIT 声明。重新分发时请一并保留相应文件并遵守适用许可。

欢迎将通用改进反馈给上游；界面翻译或本仓库构建问题可在这里提 Issue。请勿在 Issue 中粘贴 API 密钥、账号凭据、私人文献或对话记录。
