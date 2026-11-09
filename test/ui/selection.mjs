// Visible original text, complete persisted history, safe rendering and clickable quote targets.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { openPanel } from "./lib.mjs";

const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
mkdirSync("test-output/selection", { recursive: true });
try {
  for (const [width, dark] of [[540, false], [320, true]]) {
    const p = await openPanel(browser, { width, dark, params: { ctx: "selection" } });
    const original = await p.locator(".cchips .selection__text").textContent();
    assert.match(original, /^The table reports/);
    const copying = await p.evaluate(() => {
      const root = window.__zmc.shadow, text = root.querySelector(".selection__text");
      const range = document.createRange(); range.selectNodeContents(text);
      const selected = root.getSelection?.() ?? window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      text.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
      const result = { selected: selected.toString(), opened: window.__zmc.sim.opened.length };
      selected.removeAllRanges(); return result;
    });
    assert.equal(copying.selected, original);
    assert.equal(copying.opened, 0, "selecting original text to copy must not navigate");
    await p.locator(".cchips .selection__text").click();
    const target = await p.evaluate(() => window.__zmc.sim.opened.at(-1));
    assert.equal(target.quote, original);
    assert.equal(target.attachmentKey, "ATT00001");
    assert.equal(target.position.pageIndex, 6);

    const longText = "History Settings Default <img src=x onclick=alert(1)> 原文\n".repeat(55);
    await p.evaluate((text) => {
      const { host, sim } = window.__zmc;
      const chips = host.currentContext().map(c => c.kind === "selection" ? { ...c, text } : c);
      host.currentContext = () => chips;
      sim.setContext("selection");
    }, longText);
    await p.waitForTimeout(100);
    assert.equal(await p.locator(".cchips .selection__text").textContent(), longText, "original content is never localized or interpreted as markup");
    assert.equal(await p.locator(".selection img").count(), 0);
    await p.locator(".cin").fill("请解释这段原文");
    await p.locator(".cin").press("Enter");
    await p.waitForSelector('.msg--assistant[data-state="end_turn"]');
    assert.equal(await p.locator(".ubub .selection__text").textContent(), longText);
    const saved = await p.evaluate(() => window.__zmc.sim.writes.find(w => w.ev.t === "user").ev.chips.find(c => c.kind === "selection"));
    assert.equal(saved.text, longText, "history keeps text beyond the previous 2000-character limit");
    assert.deepEqual(saved.ref.position, target.position);
    await p.locator(".ubub .selection__text").click({ position: { x: 20, y: 12 } });
    assert.equal(await p.evaluate(() => window.__zmc.sim.opened.at(-1).quote), longText);
    await p.evaluate(() => { window.__zmc.sim.opened.length = 0; });
    await p.locator(".ubub .selection__open").focus();
    await p.keyboard.press("Enter");
    assert.equal(await p.evaluate(() => window.__zmc.sim.opened.at(-1).quote), longText, "keyboard activation opens the source too");
    const layout = await p.evaluate(() => {
      const root = window.__zmc.shadow;
      return [...root.querySelectorAll(".selection,.feed,.composer")].every(el => el.scrollWidth <= el.clientWidth + 1)
        && getComputedStyle(root.querySelector(".selection__text")).userSelect === "text";
    });
    assert.equal(layout, true, "long passages wrap and stay selectable in narrow panels");
    await p.screenshot({ path: `test-output/selection/${width}-${dark ? "dark" : "light"}.png` });
    assert.deepEqual(p.errors, []);
    await p.context().close();
    console.log(`PASS original selection and saved quote at ${width}px ${dark ? "dark" : "light"}`);
  }
} finally { await browser.close(); }
