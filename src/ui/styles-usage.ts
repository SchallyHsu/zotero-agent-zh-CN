export const USAGE_STYLES = `
.zmc .umeter { position: relative; flex: none; display: flex; }
.zmc .umeter__button { flex: none; display: grid; place-items: center; width: var(--h-sm); height: var(--h-sm); padding: 0; border: 0; border-radius: var(--r1); background: color-mix(in srgb, var(--ink) 4%, transparent); color: var(--ink-muted); cursor: pointer; transition: background var(--ease), color var(--ease); }
.zmc .umeter__button:hover, .zmc .umeter__button[aria-expanded="true"] { background: color-mix(in srgb, var(--ink) 9%, transparent); color: var(--ink); }
.zmc .umeter__button svg { width: 18px; height: 18px; overflow: visible; }
.zmc .umeter__track, .zmc .umeter__arc { fill: none; stroke-width: 1.85; transform: rotate(-90deg); transform-origin: 8px 8px; }
.zmc .umeter__track { stroke: var(--rule); }
.zmc .umeter__arc { stroke: currentColor; stroke-linecap: round; }
.zmc .umeter__core { fill: var(--ink-faint); opacity: 0.72; transition: fill var(--ease), opacity var(--ease); }
.zmc .umeter__button:hover .umeter__core, .zmc .umeter__button[aria-expanded="true"] .umeter__core { fill: currentColor; opacity: 0.65; }
.zmc .umeter__button:hover .umeter__track, .zmc .umeter__button[aria-expanded="true"] .umeter__track { stroke: var(--rule-strong); }
.zmc .umeter[data-state="none"] .umeter__core { opacity: 0.35; }
.zmc .umeter[data-state="stale"] .umeter__button { opacity: 0.6; }
.zmc .umeter[data-level="warm"] .umeter__button { color: var(--warn); }
.zmc .umeter[data-level="low"] .umeter__button { color: var(--danger); }

.zmc .utip { position: absolute; z-index: 31; max-width: calc(100% - 8px); padding: 5px 12px; border-radius: var(--pill); background: #1e2126; color: #ffffff; font-size: var(--fs-2); font-weight: 500; line-height: 1.4; letter-spacing: 0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; box-shadow: 0 3px 12px rgb(0 0 0 / 0.25); pointer-events: none; }
.zmc[data-theme="dark"] .utip { background: #2c313a; color: #ffffff; box-shadow: 0 0 0 1px var(--rule-strong), 0 4px 14px rgb(0 0 0 / 0.48); }
.zmc .utip[hidden] { display: none; }

.zmc .upop { width: min(300px, calc(100% - 8px)); max-height: min(460px, 60vh); overflow: auto; display: flex; flex-direction: column; gap: var(--s2); padding: var(--s3); outline: none; }
.zmc .upop .cpop__head { align-items: center; }
.zmc .upop__body { display: grid; gap: var(--s2); font-size: var(--fs-2); overflow-wrap: anywhere; }
.zmc .upop__caption { color: var(--ink-muted); }
.zmc .upop__windows { display: grid; gap: var(--s3); }
.zmc .upop__window { display: grid; gap: 5px; }
.zmc .upop__window[data-stale="true"] { opacity: 0.65; }
.zmc .upop__label { color: var(--ink); }
.zmc .upop__pct { font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }
.zmc .upop__bar { height: 5px; border-radius: var(--pill); background: var(--rule); overflow: hidden; }
.zmc .upop__fill { display: block; height: 100%; border-radius: inherit; background: var(--ink-muted); transition: width 400ms ease; }
.zmc .upop__window[data-level="warm"] .upop__fill { background: var(--warn); }
.zmc .upop__window[data-level="warm"] .upop__pct { color: var(--warn); }
.zmc .upop__window[data-level="low"] .upop__fill { background: var(--danger); }
.zmc .upop__window[data-level="low"] .upop__pct { color: var(--danger); }
.zmc .upop__error { margin: 0; color: var(--warn); }
@media (prefers-reduced-motion: no-preference) {
  .zmc .umeter__arc { transition: stroke-dasharray 400ms ease, stroke var(--ease); }
  .zmc .umeter[data-state="loading"] .umeter__core { animation: zmc-upulse 1.1s ease-in-out infinite alternate; }
}
@keyframes zmc-upulse { from { opacity: 0.25; } to { opacity: 0.85; } }
`;
