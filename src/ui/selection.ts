import type { ChipSummary, ZoteroRef } from "../types.ts";
import { chipTarget } from "./context.ts";
import { env, h, icon } from "./dom.ts";

/** The original passage stays visible and selectable, both before sending and in saved conversations. */
export function selectionQuote(c: ChipSummary, open: (target: ZoteroRef) => void, remove?: () => void): HTMLElement {
  const page = c.ref.pageLabel ?? (c.ref.pageIndex != null ? String(c.ref.pageIndex + 1) : "");
  return h("div.selection", null,
    h("button.selection__open", { type: "button", title: "Go to selected text and highlight", "aria-label": "Go to selected text and highlight", onclick: (e: MouseEvent) => {
      const button = e.currentTarget as HTMLElement;
      const root = button.getRootNode() as ShadowRoot & { getSelection?: () => Selection | null };
      const selected = root.getSelection?.() ?? env.win.getSelection();
      // A drag to copy the original passage should keep that selection; keyboard activation still opens it.
      if (e.detail && selected && !selected.isCollapsed && ((selected.anchorNode && button.contains(selected.anchorNode)) || (selected.focusNode && button.contains(selected.focusNode)))) return;
      open(chipTarget(c));
    } },
      h("span.selection__head", null, icon("selection"), h("span", null, "Text Selection"), page ? h("span.selection__page", { "data-no-localize": true }, `p.${page}`) : null),
      h("span.selection__text", { "data-no-localize": true }, c.text)),
    remove ? h("button.selection__remove.chip__btn", { type: "button", title: "Remove selected text", "aria-label": "Remove selected text", onclick: remove }, icon("close")) : null);
}
