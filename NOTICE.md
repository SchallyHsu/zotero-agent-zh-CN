# Modification notice / 修改说明

Modification date: **2026-11-06**. Maintained and published by **SchallyHsu**.
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
  declare local version 0.15.2.3, source homepage and portable verification scripts.
- Modified `scripts/build.mjs`: include attribution, source location and third-party
  notices in the installable XPI alongside the AGPL license.
- Added Chinese README, changelog, upstream provenance, license notices, UI and
  performance checks and preview screenshots using synthetic data.
- Added Playwright as a development-only dependency and updated its lockfile.
- Added a shell-independent upstream test enumerator and documented Windows test
  limitations. Adjusted `test/budget.test.ts` ceilings to account for the Chinese
  dictionary and bundled redistribution notices; the startup-script budget is unchanged.

The rest of the plugin source is retained from the upstream tag. All modifications
to the plugin and the accompanying new source files are provided under
**AGPL-3.0-or-later**. Original notices are not removed or superseded.

Version 0.15.2.3 packages the same UI-performance changes as the local 0.15.2.2
build, with public-distribution attribution, licensing and portable verification.
The original plugin ID and upstream automatic-update address remain unchanged;
installing this build replaces the original plugin, and a future official update
may restore the English UI.
