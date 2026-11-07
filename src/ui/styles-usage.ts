export const USAGE_STYLES = `
.zmc .umeter { position: relative; margin-bottom: var(--s1); min-width: 0; }
.zmc .umeter__button { display: flex; align-items: center; gap: var(--s2); width: 100%; min-height: 26px; padding: 3px 6px; border: 0; border-radius: var(--r0); background: transparent; color: var(--ink-muted); cursor: pointer; font: inherit; font-size: var(--fs-1); text-align: left; }
.zmc .umeter__button:hover, .zmc .umeter__button[aria-expanded="true"] { background: var(--tint-hover); color: var(--ink); }
.zmc .umeter__button > :first-child { flex: none; }
.zmc .umeter__summary { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums; }
.zmc .umeter[data-level="low"] .umeter__summary { color: var(--warn); }
.zmc .upop { position: absolute; z-index: 35; left: 0; right: 0; bottom: calc(100% + 6px); top: auto; width: auto; min-width: 0; max-height: min(430px, 55vh); overflow: auto; display: flex; flex-direction: column; gap: var(--s2); padding: var(--s3); outline: none; }
.zmc .upop__body { display: grid; gap: var(--s2); font-size: var(--fs-2); overflow-wrap: anywhere; }
.zmc .upop__caption { color: var(--ink-muted); }
.zmc .upop__window { display: grid; gap: var(--s1); }
.zmc .upop__window[data-stale="true"] { opacity: 0.65; }
.zmc .upop progress { appearance: none; width: 100%; height: 5px; border: 0; border-radius: var(--pill); overflow: hidden; background: var(--rule); accent-color: var(--ink-muted); }
.zmc .upop progress::-webkit-progress-bar { background: var(--rule); }
.zmc .upop progress::-webkit-progress-value { background: var(--ink-muted); }
.zmc .upop progress::-moz-progress-bar { background: var(--ink-muted); }
.zmc .upop__error { margin: 0; color: var(--warn); }
`;
