// Context economy in the composer: the fill ring (ring.ts), its tooltip and popover, and the long-chat suggestion. Same
// tokens as styles.ts; the popover is a `.menu`, so it takes the menus' surface, glass included (styles-look.ts).
export const CONTEXT_STYLES = `
.zmc .selection { position: relative; flex: 1 0 100%; min-width: 0; max-width: 100%; border: 1px solid var(--rule); border-left: 3px solid var(--link); border-radius: var(--r1); background: var(--paper); overflow: hidden; }
.zmc .selection__open { display: block; width: 100%; min-width: 0; padding: var(--s2) var(--s3); border: 0; background: none; color: var(--ink); text-align: left; }
.zmc .selection__open:hover { background: var(--tint-hover); }
.zmc .selection__open:focus-visible { outline-offset: -3px; }
.zmc .selection__head { display: flex; align-items: center; gap: var(--s1); padding-right: 20px; color: var(--ink-muted); font-size: var(--fs-1); }
.zmc .selection__head svg { flex: none; width: 14px; height: 14px; }
.zmc .selection__page { margin-left: auto; white-space: nowrap; }
.zmc .selection__text { display: block; margin-top: var(--s1); max-height: 12em; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--fs-3); line-height: 1.5; cursor: pointer; user-select: text; -moz-user-select: text; }
.zmc .cchips .selection__text { max-height: 6em; }
.zmc .selection__remove { position: absolute; top: 2px; right: 2px; }

.zmc .cmeter { flex: none; display: grid; place-items: center; width: var(--h-sm); height: var(--h-sm); padding: 0; border: 0; border-radius: 50%; background: none; color: var(--ink-muted); cursor: pointer; transition: background var(--ease); }
.zmc .cmeter[hidden], .zmc .cnote[hidden], .zmc .ctip[hidden] { display: none; }
.zmc .cmeter svg { width: 16px; height: 16px; transform: rotate(-90deg); }
.zmc .cmeter circle { fill: none; stroke-width: 2; transition: stroke-width var(--ease), stroke var(--ease); }
.zmc .cmeter__track { stroke: var(--rule); }
.zmc .cmeter__arc { stroke: currentColor; stroke-linecap: round; }
.zmc :is(.cmeter:hover, .cmeter[aria-expanded="true"]) { background: var(--tint-hover); }
.zmc :is(.cmeter:hover, .cmeter[aria-expanded="true"]) circle { stroke-width: 2.6; }
.zmc :is(.cmeter:hover, .cmeter[aria-expanded="true"]) .cmeter__track { stroke: var(--rule-strong); }
.zmc .cmeter[data-level="warm"] { color: var(--warn); }
.zmc .cmeter[data-level="full"] { color: var(--danger); }

.zmc .ctip { position: absolute; z-index: 31; display: grid; gap: 1px; max-width: calc(100% - 8px); padding: 6px 10px; border: 1px solid var(--rule); border-radius: var(--r1); background: var(--paper-raised); box-shadow: var(--shadow); color: var(--ink); font-size: var(--fs-2); line-height: 1.35; white-space: nowrap; pointer-events: none; animation: zmc-fade 90ms ease; }
.zmc .ctip__t { font-weight: 500; }
.zmc .ctip__sub { color: var(--ink-muted); font-size: var(--fs-1); font-variant-numeric: tabular-nums; }

.zmc .cpop { width: min(280px, calc(100% - 8px)); padding: var(--s3); display: flex; flex-direction: column; gap: var(--s2); outline: none; }
.zmc .cpop__head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--s2); }
.zmc .cpop__title { font-weight: 600; color: var(--ink); }
.zmc .cpop__pct { font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }
.zmc .cpop__bar { height: 4px; border-radius: var(--pill); background: var(--rule); overflow: hidden; }
.zmc .cpop__fill { display: block; height: 100%; border-radius: inherit; background: var(--ink-muted); }
.zmc .cpop[data-level="warm"] .cpop__fill { background: var(--warn); }
.zmc .cpop[data-level="full"] .cpop__fill { background: var(--danger); }
.zmc .cpop[data-level="warm"] .cpop__pct { color: var(--warn); }
.zmc .cpop[data-level="full"] .cpop__pct { color: var(--danger); }
.zmc .cpop__tok { margin-top: -4px; font-size: var(--fs-2); color: var(--ink-muted); font-variant-numeric: tabular-nums; }
.zmc .cpop__why { margin: 0; font-size: var(--fs-2); line-height: 1.45; color: var(--ink-muted); }
.zmc .cpop__facts { margin: 0; padding-top: var(--s2); display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 3px var(--s3); border-top: 1px solid var(--rule); font-size: var(--fs-2); }
.zmc .cpop__facts dt { color: var(--ink-muted); }
.zmc .cpop__facts dd { margin: 0; text-align: right; color: var(--ink); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.zmc .cpop__facts .cpop__wide { grid-column: 1 / -1; text-align: left; }
.zmc .cpop__facts dt.cpop__wide { margin-top: var(--s1); }
.zmc .cpop__acts { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--s1); }
.zmc[data-glass="on"] .cpop__facts { border-top-color: var(--glass-line); }

.zmc .cnote { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s1) var(--s2); margin-bottom: var(--s2); padding: var(--s1) var(--s1) var(--s1) var(--s3); border-radius: var(--r1); background: var(--tint-hover); color: var(--ink-muted); font-size: var(--fs-2); }
.zmc .cnote__t { flex: 1 1 12em; min-width: 0; }
.zmc .cnote .lnk { color: var(--ink); }
@media (prefers-reduced-motion: no-preference) { .zmc .cmeter__arc { transition: stroke-dasharray 400ms ease, stroke-width var(--ease); } }
`;
