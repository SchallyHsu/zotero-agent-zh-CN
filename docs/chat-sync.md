# 聊天同步 / Chat sync — 0.15.2.14 预发布测试版

## 使用

1. 各台电脑安装 [Release](https://github.com/SchallyHsu/zotero-agent-zh-CN/releases/tag/zh-CN-v0.15.2.14) 中的 `zotero-agent-zh-CN-0.15.2.14.xpi`，并各自完成模型后端登录。这是预发布测试版。
2. 打开插件“设置 → 聊天同步”，填写同一个 WebDAV **现有目录**地址、用户名和密码，打开“跨设备同步聊天”，点击“保存并同步”。Zotero 账号中已有的附件同步设置不会自动启用聊天同步。
3. 在另一台电脑填写相同配置。出现“聊天已同步”后，从历史打开同一段聊天接着聊。也可以点击“立即同步”。

插件会在指定目录下新建 `zotero-agent-chat/v1.json`，不操作 Zotero 附件。允许复用同一 WebDAV 服务。服务必须支持强 ETag 和 `If-Match` / `If-None-Match` 条件写入；不支持时显示原因，保留本地记录。目录地址不允许嵌入密码、查询参数或片段；密码单独保存在 Zotero 登录管理器中。普通 HTTPS WebDAV 可使用；HTTP 留给局域网或回环测试。

每轮完成后上传，打开聊天、返回窗口及发送前同步；插件打开期间每 30 秒检查。同步以完整回复为单位，其他设备看到更新可能需要等待一次轮询。离线允许继续聊天，状态栏显示连接错误或待同步，重连后补传。

## 续聊和冲突

例如 A 聊了 10 轮，B 同步后再聊 3 轮，A 再发送时会先拉取新增内容，并在同一段插件聊天中重建本机模型会话，带入双方历史。各设备的后端会话 ID、工作目录及模型账号保留在各自设备。跨设备接续按正常模型请求计费，历史上下文会占用词元。

通常轮流使用时只有一段聊天。两台设备从同一旧历史同时继续，产生不同消息时，双方完整记录会保留在独立分支，历史标题带 `[fork]`。选择想继续的分支即可；不会把并行回答拼成虚假的先后关系。发生分支时主聊天可能切换到合并选出的版本，另一版本仍可在历史中找到。

删除会同步到其他设备；删除期间另一台设备产生的离线新内容会保留成 `[fork]`。设置中的“清空历史”也会传播删除。重置设置会关闭同步并保留聊天及密码；删除标记保留用于避免旧设备把聊天恢复出来。

## 范围与边界

- 同步用户消息、助手正文、插件记录的思考/工具步骤与工具结果、标题、项目、论文引用和 PDF 选区原文与坐标。WebDAV 服务可读取这些内容，当前没有额外的端到端加密。
- 论文关联使用 Zotero 用户/群组标识和 item key，在目标设备映射本地 libraryID。请使用同一 Zotero 账号并先同步文献库；缺少对应库时保留记录，引用不能直接定位。未登录 Zotero 的个人库没有跨设备稳定账号标识。
- PDF 和其他文献附件仍通过 Zotero 自己的文献同步处理。已有聊天存储只有图片说明，没有截图或粘贴图片字节；此版跨设备上下文不恢复那些图片。
- 模型接续使用保存的用户文字、选区、助手正文和工具结果；不会把历史授权当成新授权，也不会把历史思考过程重放为模型推理。
- 超过 100,000 字符的接续上下文先传最近部分，并提供完整本地文本文件路径供模型按需读取。此版不生成额外的模型摘要，也不迁移后端内部状态。
- 当前使用一个带条件写入的 JSON 文档，UTF-8 大小上限 32 MiB，适合个人聊天记录；尚未实现分块增量传输或后台常驻同步。插件窗口关闭、Zotero 退出期间不保证轮询。
- 本版面向能够运行此桌面插件的设备。手机或 iPad 需要额外客户端入口。

## 验证

```powershell
npm run typecheck
npm run preview
$env:BROWSER_EXECUTABLE = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm test
npm run test:xpi-chat-sync
```

测试包括两个隔离磁盘存储及各自后端会话的 A→B→A 接续、真实回环 HTTP/WebDAV、重复同步、条件写入竞争、离线补传、分支收敛、删除期间的离线编辑、选区坐标与本地库 ID 映射、异常远端格式及弱 ETag 拒绝。

真实 Zotero/XPI 测试使用独立配置、独立文献库和合成登录凭据，验证 Gecko 网络请求、登录管理器、远端新增轮次导入、上下文重建材料和历史显示。界面测试覆盖中英文、默认关闭、密码遮罩和配置保存。没有连接用户实际 WebDAV，也没有调用真实模型；真实两台电脑及具体 WebDAV 服务仍需要配置后验证。

## English quick start

Install the accompanying XPI on each desktop. Open **Settings → Chat sync**, enter the same existing WebDAV folder URL and credentials, enable sync, then select **Save and sync**. Open the same conversation from History on another device. Completed rounds sync after replies, on window focus, on opening a conversation and before sending, with a 30-second polling interval while the plugin is open.

Chats use `zotero-agent-chat/v1.json` under the configured folder. Strong ETags and conditional writes are required. Native model sessions and credentials remain local. Remote additions rebuild model context in the same plugin chat. Concurrent offline continuations become complete `[fork]` branches; deletion tombstones prevent resurrection. PDFs sync separately through Zotero. Historical pasted images are not restored. Long context is bounded with a full local transcript file available to the model.

Validation uses synthetic data, two isolated stores, loopback WebDAV, browser tests and an isolated real Zotero/XPI. No real provider inference or user WebDAV server was used. This build is distributed as a prerelease for testing.
