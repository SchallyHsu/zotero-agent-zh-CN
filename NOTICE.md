# Modification notice / 修改说明

Modification dates: **2026-11-06 – 2026-11-10**. Maintained and published by **SchallyHsu**.
Release update: **2026-11-10**, version **0.15.2.13**: resolve DeepSeek Harness
ACP model selectors (`["provider","model"]`), route quota lookups to the selected
`deepseek-account` or `deepseek-official` credentials, keep legacy selector forms
working, and never send a grant to a non-matching issuer. Added selector parsing
and provider-dispatch regression tests against real read-only account queries.
Release update: **2026-11-09**, version **0.15.2.12**: show original
selected text in the composer and transcript, preserve full passages and PDF
selection geometry in history, and navigate with a temporary highlight on click.
Older transcripts use text matching. Added browser, unit and isolated real-XPI
checks. Update bilingual documentation, source provenance and release artifacts.
Local development update: **2026-11-07**, version **0.15.2.4**: named projects,
native backend session-title/project synchronization, per-paper history and resume,
legacy metadata migration, settings, localization and regression checks.
Local development update: **2026-11-07**, version **0.15.2.5**: native ACP
integrations for Antigravity CLI and DeepSeek Harness, grouped model options,
resume/close lifecycle, executable-path settings and compatibility checks. No
Google or DeepSeek executable or SDK is bundled with this plugin.
Local development update: **2026-11-07**, version **0.15.2.6**: an original
local DSH companion extension registers Zotero conversations with the native
WorkspaceRegistry inside Web/Desktop hosts. Managed configuration changes are
backed up; acknowledgements distinguish queued requests from native ownership.
Local development update: **2026-11-07**, version **0.15.2.7**: original native
Antigravity project/session preparation and legacy snapshot/fork integration;
Codex desktop sidebar registration queued until desktop exit with a state backup;
Claude Code native directory/title confirmation and versioned history backfill.
The helpers use installed client services and do not bundle their executables.
Local development update: **2026-11-07**, version **0.15.2.8**: packaged helper
assets load through Gecko channels rather than HTTP; the Windows Codex waiting
worker explicitly breaks away from the parent Gecko process job. Added real
Zotero/XPI integration checks with isolated libraries and native metadata homes.
Release update: **2026-11-07**, version **0.15.2.10**: add an account
quota and conversation usage display; read-only Codex app-server and Antigravity
native queries; original Claude, pi and DSH compatibility adapters with provider
credential isolation, stale/reset handling and synthetic plus native verification.
Local development update: **2026-11-07**, version **0.15.2.9**: remove an idle
shutdown timer from the Antigravity helper, resume confirmed App conversations
through validated local storage, bound stale daemon discovery, and defer redundant
metadata work until after the reply. Added local latency measurement and native
XPI fast-resume verification. Model and reasoning preferences are preserved.
Release update: **2026-11-08**, version **0.15.2.11**: replace the top quota
text bar with a compact circular gauge + diamond icon in the composer toolbar,
hover pill tooltip and anchored detail popover; add a live Chinese/English UI
language setting (`appearance.language`); update verification and size budget.
The 0.15.2.4 through 0.15.2.9 development updates were first distributed together
in release **0.15.2.9**, source tag **zh-CN-v0.15.2.9**. Release **0.15.2.10**
(**zh-CN-v0.15.2.10**) added the quota display; the current release is
**0.15.2.13**, source tag **zh-CN-v0.15.2.13**.
This repository is an **unofficial derivative**, not the original Zotero MCP
project and not an official Zotero product. Original implementation credit belongs
to the [Zotero MCP contributors](https://github.com/54yyyu/zotero-mcp/graphs/contributors).

Extracted from `54yyyu/zotero-mcp` **v0.15.2**, commit
`dfec70c8b772e697476e0b42c1264441cf518686`, directory `plugin/`.
The extracted plugin's complete source, build scripts, lockfile, assets, original
AGPL license, tests and preview fixtures are included here.

## Changes relative to upstream

- Added `src/ui/zh-CN.json` and `src/ui/localize.ts`: Simplified Chinese UI labels,
  protected user/document content, bounded label cache, deduplicated DOM updates,
  selective attribute translation and pruning of conversation subtrees.
- Modified `src/ui/{dom,index,pane,parts,styles}.ts`: attach/detach localization,
  display dates and animated labels in Chinese, add CJK font fallbacks.
- Modified `src/zotero/{inject,plugin,translate-view}.ts` and `prefpane.xhtml`:
  localize the toolbar, settings and translation popup labels.
- Modified `addon.json` and `package.json`: identify this unofficial derivative,
  declare its local version, source homepage and portable verification scripts.
- Modified `scripts/build.mjs`: include attribution, source location and third-party
  notices in the installable XPI alongside the AGPL license.
- Added Chinese README, changelog, upstream provenance, license notices, UI and
  performance checks and preview screenshots using synthetic data.
- Added Playwright as a development-only dependency and updated its lockfile.
- Added project-name settings, per-paper conversation groups and automatic resume,
  local title editing, legacy metadata migration and native backend synchronization
  in `src/{agent,ui,zotero}/` and `src/types.ts`, with regression checks.
- Added native ACP integrations for Antigravity CLI and DeepSeek Harness, plus
  original companion helpers in `assets/` for native project/session integration
  and Codex desktop sidebar registration. Client executables and SDKs are not bundled.
- Added local Gecko resource loading, Windows waiting-worker lifecycle fixes,
  Antigravity preparation optimizations, native integration checks and documentation.
- Added a shell-independent upstream test enumerator and documented Windows test
  limitations. Adjusted `test/budget.test.ts` ceilings to account for the Chinese
  dictionary and bundled redistribution notices; the startup-script budget is unchanged.

Unmodified plugin source is retained from the upstream tag. All modifications
to the plugin and the accompanying new source files are provided under
**AGPL-3.0-or-later**. Original notices are not removed or superseded.

Version 0.15.2.3 packages the same UI-performance changes as the local 0.15.2.2
build, with public-distribution attribution, licensing and portable verification.
The original plugin ID and upstream automatic-update address remain unchanged;
installing this build replaces the original plugin, and a future official update
may restore the English UI.
