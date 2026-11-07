# Zotero Agent (Unofficial Bilingual / Simplified Chinese Derivative)

[简体中文](README.md) | **English**

**0.15.2.11** replaces the top "Quota & Usage" text bar with a compact **circular gauge + rounded-diamond icon** on the right side of the composer toolbar (showing remaining quota on the outer ring, a dark pill tooltip on hover, and a detailed popover on click with per-window remaining percentages, reset times, account balances, and per-turn / per-chat token counts), and adds a live **Language (`中文` / `English`)** toggle under **Settings → Appearance** that switches the entire panel UI without restarting Zotero. Supports Codex, Claude Code, Antigravity, DeepSeek Harness (`dsh`), and per-provider quota routing for `pi` / `dsh` models. See [Account Quota & Usage (`docs/account-usage.md`)](docs/account-usage.md) and [Changelog (`CHANGELOG.md`)](CHANGELOG.md).

An **unofficial derivative** of the Zotero Agent plugin from [54yyyu/zotero-mcp](https://github.com/54yyyu/zotero-mcp). This repository adds bilingual UI support (Simplified Chinese & English), project and per-paper conversation management, native backend integrations (Antigravity CLI & DeepSeek Harness), account quota & usage gauges, and localization performance optimizations. Core agent sessions, library access, chat, and tool calls come from the upstream project and its contributors.

**Upstream release:** [v0.15.2](https://github.com/54yyyu/zotero-mcp/tree/v0.15.2/plugin) · **Upstream commit:** [`dfec70c8b772e697476e0b42c1264441cf518686`](https://github.com/54yyyu/zotero-mcp/commit/dfec70c8b772e697476e0b42c1264441cf518686) · **This build:** `0.15.2.11`

This project is not an official Zotero or Zotero MCP release and does not imply endorsement by the original author.

## Download & Installation

1. Download `zotero-agent-zh-CN-0.15.2.11.xpi` from [Releases](https://github.com/SchallyHsu/zotero-agent-zh-CN/releases/tag/zh-CN-v0.15.2.11) (checksums in `SHA256SUMS.txt`).
2. In Zotero, open **Tools → Plugins**, click the gear icon, choose **Install Plugin From File…**, select the `.xpi` file, and restart Zotero if prompted.
3. Open the side panel from the toolbar button and complete the `zotero-cli` and backend setup as described in the [upstream plugin documentation](https://github.com/54yyyu/zotero-mcp/blob/v0.15.2/docs/chat-plugin.md).
4. To switch the interface language between **Chinese (`中文`)** and **English**, open **Settings (gear icon) → Appearance → Language**.

This build keeps the upstream add-on ID `chat@zotero-mcp`, so installing it replaces the official plugin in place. You can reinstall the official `.xpi` at any time.

**Compatibility:** Upstream targets Zotero 7+. Desktop verification for this derivative was conducted on Windows 11 with Zotero 10.0.7.

## Key Additions Over Upstream `v0.15.2`

### 1. Live Bilingual Interface (`中文` / `English`)
- **Settings → Appearance → Language**: Switch live between **Simplified Chinese (`中文`)** and **English** without restarting Zotero.
- Paper titles, DOIs, library search hits, user/assistant prose, input values, saved prompts, model/permission IDs, and command outputs are strictly protected and never altered by UI localization.

### 2. Quota & Usage Gauge
- A compact circular gauge + rounded-diamond icon in the composer toolbar shows the remaining share of the tightest active quota window (`≤ 30%` amber warning, `≤ 10%` red alert).
- Hover or focus displays a dark pill summary (e.g. `5h · 73% left` / `5小时 · 剩余 73%`).
- Clicking opens the detailed breakdown popover:
  - **Codex / Claude Code / Antigravity**: Subscription rate-limit windows, remaining percentage, plan name, and local reset time.
  - **DeepSeek Harness (`dsh`)**: Native account top-up and granted balances, or third-party provider quotas when a `<provider>/<model>` is selected.
  - **`pi`**: Queries the active model's provider credentials (`anthropic`, `openai-codex`, `github-copilot`, `google-gemini-cli`, `google-antigravity`, `deepseek`).
  - **Conversation Usage**: Input/output tokens for the last turn and current conversation, turns reporting tokens, and optional estimated API cost.

### 3. Projects & Per-Paper Conversations
- **Settings → Projects and conversations**: Group new chats under a named project (default `Zotero Agent`) and link them to the paper you are reading.
- **Automatic Resume**: Opening a paper automatically restores your most recent conversation for that paper and backend (can be toggled in Settings).
- **Native Client Synchronization**:
  - **Codex**: Syncs project folders and thread titles via `codex app-server` and registers projects in the Codex desktop sidebar after desktop exit.
  - **Claude Code / `pi`**: Organizes conversations by project folder and syncs session titles.
  - **Antigravity**: Creates and resumes native App project conversations shared with `agy acp`, migrating legacy CLI sessions via consistent snapshots.
  - **DeepSeek Harness (`dsh`)**: Attaches sessions to native `WorkspaceRegistry` projects through a local companion extension.

## Building from Source

Requires Node.js 24+, npm, and `zip` on `PATH`:

```bash
git clone https://github.com/SchallyHsu/zotero-agent-zh-CN.git
cd zotero-agent-zh-CN
npm ci
npm run typecheck
npm run build
```

The installable add-on is written to `dist/zotero-agent.xpi`.

## Verification & Development Preview

```bash
npx playwright install chromium
npm test
npm run test:performance
```

`npm test` runs TypeScript type-checking, builds the standalone preview (`preview/dist/index.html`), and runs unit + headless browser suites covering UI localization, live language switching, per-paper conversation lifecycle, native backend adapters, and quota/usage gauges using synthetic test data.

## License & Attribution

Distributed under **AGPL-3.0-or-later** (see [LICENSE](LICENSE), [NOTICE.md](NOTICE.md), [SOURCE.txt](SOURCE.txt), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). Original plugin design and implementation credit belongs to [54yyyu/zotero-mcp](https://github.com/54yyyu/zotero-mcp).
