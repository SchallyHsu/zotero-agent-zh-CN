// Local zh-CN overlay. Only presentation text is translated; stored settings,
// identifiers, permission values, prompts, citations and conversation text are kept.
import messages from "./zh-CN.json";

const dictionary: Readonly<Record<string, string>> = messages;
type Rule = [RegExp, (...groups: string[]) => string];
const rules: Rule[] = [
  [/^(\d+) (?:thing needs|things need) attention$/, n => `${n} 项需要处理`],
  [/^(\d+) more$/, n => `另有 ${n} 项`],
  [/^(\d+) of (\d+)$/, (n, total) => `已完成 ${n} / ${total} 项`],
  [/^(\d+) models$/, n => `${n} 个模型`],
  [/^(\d+) (?:source|sources)$/, n => `${n} 个来源`],
  [/^(\d+) steps$/, n => `${n} 个步骤`],
  [/^· (\d+) failed$/, n => `· ${n} 项失败`],
  [/^(\d+) times$/, n => `${n} 次`],
  [/^(\d[\d,.]*) characters$/, n => `${n} 个字符`],
  [/^Default \((.+)\)$/, name => `默认（${translateUI(name)}）`],
  [/^Send \((.+)\)$/, key => `发送（${key}）`],
  [/^(.+) \(recommended\)$/, name => `${translateUI(name)}（推荐）`],
  [/^Your picture \((.+)\)$/, name => `你的图片（${name}）`],
  [/^(.+) is ready\.?$/, name => `${name} 已就绪`],
  [/^(.+) is not available$/, name => `${name} 暂不可用`],
  [/^(.+) isn't ready: ([\s\S]+)$/, (name, reason) => `${name} 尚未就绪：${translateUI(reason)}`],
  [/^(.+) is not signed in\.([\s\S]*)$/, (name, rest) => `${name} 尚未登录。${translateUI(rest.trim())}`],
  [/^(.+) is not logged in$/, name => `${name} 尚未登录`],
  [/^No answer on (.+)$/, address => `${address} 未响应`],
  [/^Signed in as (.+)\.$/, account => `已登录：${account}。`],
  [/^Not signed in: ([\s\S]+)\.$/, reason => `尚未登录：${reason}。`],
  [/^(.+) · API key$/, name => `${name} · API 密钥`],
  [/^(.+) · subscription$/, name => `${name} · 订阅账号`],
  [/^Zotero Agent (\S+)$/, version => `Zotero 文献助手 ${version}`],
  [/^Starting (.+)$/, name => `正在启动 ${name}`],
  [/^Show (.+)'s options$/, name => `查看 ${name} 的选项`],
  [/^Reading (.+)'s options$/, name => `正在读取 ${name} 的选项`],
  [/^Couldn't read (.+)'s options$/, name => `无法读取 ${name} 的选项`],
  [/^The model, effort and permissions are read from (.+) itself, which starts it for a moment\.$/, name => `模型、推理强度和权限选项直接来自 ${name}，读取时会短暂启动它。`],
  [/^Runs on (.+) in a session of its own: no tools, nothing from your chats\.$/, name => `使用 ${name} 的独立会话：不调用工具，不读取你的对话。`],
  [/^Writes are set up \((.+)\)$/, mode => `文献库写入已配置（${mode}）`],
  [/^Zotero's local server is on port (\d+), not 23119$/, port => `Zotero 本地服务使用 ${port} 端口，需要改为 23119`],
  [/^The server is up but \/api answered (.+)\. Restart Zotero\.$/, status => `服务已运行，但本地接口返回 ${status}。请重启 Zotero。`],
  [/^Couldn't search Zotero: ([\s\S]+)$/, reason => `检索 Zotero 失败：${reason}`],
  [/^Couldn't (?:read your skills|load the choices|save the note|start the agent|open that chat|open that in Zotero|switch|save|delete|read that file|open it|delete it): ([\s\S]+)$/, reason => `操作失败：${reason}`],
  [/^Couldn't save the key: ([\s\S]+)$/, reason => `保存密钥失败：${reason}`],
  [/^Couldn't switch the (model|mode|effort): ([\s\S]+)$/, (kind, reason) => `切换${({model:"模型",mode:"权限模式",effort:"推理强度"} as Record<string,string>)[kind]}失败：${reason}`],
  [/^The agent stopped: ([\s\S]+)$/, reason => `助手已停止：${reason}`],
  [/^No matches for "([\s\S]*)"$/, query => `没有与“${query}”匹配的结果`],
  [/^Nothing called “([\s\S]*)”\. Add skills and prompts in Settings\.$/, query => `没有名为“${query}”的项目。可在设置中添加技能和提示词。`],
  [/^Switching starts a new chat with (.+)\.$/, name => `切换后将与 ${name} 开始一段新对话。`],
  [/^All set\. You'll chat with (.+)\.$/, name => `配置完成，将使用 ${name} 对话。`],
  [/^(.+) Then press Recheck\.$/, first => `${translateUI(first)} 然后点击“重新检查”。`],
  [/^Permission mode: (.+)$/, mode => `权限模式：${translateUI(mode)}`],
  [/^Permission needed: (.+)$/, title => `需要授权：${title}`],
  [/^Model: (.+)\. Change the agent, model or effort$/, name => `模型：${name}。点击切换助手、模型或推理强度`],
  [/^(.+)\. Open status$/, text => `${translateUI(text)}。查看运行状态`],
  [/^(.+)\. Status: (.+)$/, (name, status) => `${name}。状态：${translateUI(status)}`],
  [/^Context: (\d+)% full \((.+) of (.+) tokens\)\. Show details$/, (pct, used, total) => `上下文已用 ${pct}%（${used} / ${total} 词元）。查看详情`],
  [/^(\d+)% of context used$/, pct => `上下文已用 ${pct}%`],
  [/^(.+) of (.+) tokens$/, (used, total) => `${used} / ${total} 词元`],
  [/^([\d,.]+[kM]?) in$/, n => `输入 ${n}`],
  [/^([\d,.]+[kM]?) out$/, n => `输出 ${n}`],
  [/^(\$[\d.]+) last turn$/, money => `上一轮 ${money}`],
  [/^Save as (PNG|SVG)$/, format => `另存为 ${format}`],
  [/^Open (.+)$/, title => `打开 ${title}`],
  [/^Preview (.+)$/, title => `预览 ${title}`],
  [/^Remove (.+)$/, title => `移除 ${title}`],
  [/^Unpin (.+)$/, title => `取消固定 ${title}`],
  [/^Keep (.+) in this chat$/, title => `在当前对话中保留 ${title}`],
  [/^Pin (.+)$/, title => `固定 ${title}`],
  [/^Use (.+)$/, title => `使用 ${title}`],
  [/^Edit (.+)$/, title => `编辑 ${title}`],
  [/^Delete (.+)\?$/, title => `删除 ${title}？`],
  [/^Delete (.+)$/, title => `删除 ${title}`],
  [/^Copy terminal command for (.+)$/, title => `复制“${title}”的终端命令`],
  [/^Added (.+)\. Type \/(.+) in the message box to use it\.$/, (name, command) => `已添加 ${name}。在输入框输入 /${command} 即可使用。`],
  [/^Saved (.+)\.$/, name => `已保存 ${name}。`],
  [/^“(.+)” is the panel's own; choose another name\.$/, name => `“${name}”是侧栏的内置名称，请换一个。`],
  [/^You already have a skill called “(.+)”\.$/, name => `已存在名为“${name}”的技能。`],
  [/^more than (\d+) files$/, n => `超过 ${n} 个文件`],
  [/^Failed \(exit (.+)\)\.$/, code => `操作失败（退出代码 ${code}）。`],
  [/^Failed: ([\s\S]+)$/, reason => `失败：${reason}`],
  [/^Reading (.+)$/, target => `正在读取 ${target}`],
  [/^Editing (.+)$/, target => `正在编辑 ${target}`],
];

/** Translate one UI label, leaving unknown strings and technical payloads intact. */
const labelCache = new Map<string, string>();
export function translateUI(value: string): string {
  if (!value || value.length > 3000) return value;
  const cached = labelCache.get(value);
  if (cached !== undefined) return cached;
  const translated = translateLabel(value);
  // Dynamic status labels must not accumulate for the lifetime of Zotero.
  if (labelCache.size >= 1024) labelCache.delete(labelCache.keys().next().value!);
  labelCache.set(value, translated);
  return translated;
}

function translateLabel(value: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(value)!;
  const text = match[2]!;
  const exact = Object.hasOwn(dictionary, text) ? dictionary[text] : undefined;
  if (exact) return match[1] + exact + match[3];
  if (!/[A-Za-z]/.test(text)) return value;
  for (const [pattern, render] of rules) {
    const found = pattern.exec(text);
    if (found) return match[1] + render(...found.slice(1)) + match[3];
  }
  // A history row also contains the agent's name; only localize its time suffix.
  return value
    .replace(/\b(\d+) min ago\b/g, "$1 分钟前")
    .replace(/\b(\d+) h ago\b/g, "$1 小时前")
    .replace(/\b(\d+) d ago\b/g, "$1 天前")
    .replace(/\bjust now\b/g, "刚刚");
}

const CONTENT = ".md,.ubub__text,.thought__body,.hrow__t,.hrow__f,.chip__t,.source__t,.pop__t,.pop__s,.sp__desc,.folder__p,.plan__text,.zmc-tr__text,[data-no-localize]";
const NEVER = "style,script,pre,code,svg,textarea,[contenteditable=true]";
const ATTRS = ["title", "placeholder", "aria-label", "aria-description"];

/** Bind only this plugin's shadow tree; never observe or modify the library UI. */
export function localizeRoot(root: ShadowRoot): () => void {
  const doc = root.ownerDocument;
  const win = doc.defaultView as Window & typeof globalThis;
  const attribute = (el: Element, key: string): void => {
    const before = el.getAttribute(key);
    if (!before) return;
    const after = translateUI(before);
    if (after !== before) el.setAttribute(key, after);
  };
  const isControl = (el: Element): boolean => !!el.closest(".md button");
  const protectedContent = (el: Element): boolean =>
    !!el.closest(NEVER) || (!!el.closest(CONTENT) && !isControl(el));
  const markdownControls = (el: Element): void => {
    // Skip prose as one subtree, but keep the renderer's copy buttons localized.
    for (const button of el.querySelectorAll(".md button")) {
      if (!button.closest(NEVER)) walk(button);
    }
  };
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      const before = node.nodeValue ?? "";
      const after = translateUI(before);
      if (after !== before) node.nodeValue = after;
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    if (node.nodeType === 1) {
      const el = node as Element;
      if (el.matches(NEVER)) {
        // Input values remain user data; placeholders and accessible names are UI.
        if (el.matches("textarea,[contenteditable=true]")) {
          for (const key of ATTRS) attribute(el, key);
        }
        return;
      }
      if (el.matches(CONTENT)) {
        markdownControls(el);
        return;
      }
      for (const key of ATTRS) attribute(el, key);
    }
    for (const child of node.childNodes) walk(child);
  };
  const localize = (node: Node): void => {
    if (!root.contains(node) && node !== root) return;
    // Check ancestors once at the entry point, not for every word in a reply.
    const parent = node.parentElement;
    if (parent && protectedContent(parent)) {
      if (node.nodeType === 1 && !parent.closest(NEVER)) {
        const el = node as Element;
        if (isControl(el) && !el.closest(NEVER)) walk(el);
        else markdownControls(el);
      }
      return;
    }
    walk(node);
  };
  localize(root);
  root.host.setAttribute("lang", "zh-CN");
  const options: MutationObserverInit = {subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:ATTRS};
  const observer = new win.MutationObserver(records => {
    // Translation writes must not schedule a second pass over the same DOM.
    observer.disconnect();
    try {
      const pending = new Set<Node>();
      const attributes = new Map<Element, Set<string>>();
      const prose = new Set<Element>();
      for (const record of records) {
        if (record.type === "childList") {
          const el = record.target.nodeType === 1 ? record.target as Element : null;
          if (el && protectedContent(el)) {
            if (!el.closest(NEVER)) prose.add(el);
          } else for (const node of record.addedNodes) pending.add(node);
        }
        else if (record.type === "characterData") pending.add(record.target);
        else {
          const el = record.target as Element;
          const keys = attributes.get(el) ?? new Set<string>();
          keys.add(record.attributeName!);
          attributes.set(el, keys);
        }
      }
      for (const node of pending) {
        let covered = false;
        for (let ancestor = node.parentNode; ancestor && ancestor !== root; ancestor = ancestor.parentNode) {
          if (pending.has(ancestor)) { covered = true; break; }
        }
        if (!covered) localize(node);
      }
      for (const el of prose) if (root.contains(el)) markdownControls(el);
      // A title/aria update only needs that attribute, never the element's children.
      for (const [el, keys] of attributes) {
        if (!root.contains(el)) continue;
        const editable = el.matches("textarea,[contenteditable=true]");
        if (editable ? !!el.parentElement?.closest(NEVER) : protectedContent(el)) continue;
        for (const key of keys) attribute(el, key);
      }
    } finally {
      observer.observe(root, options);
    }
  });
  observer.observe(root, options);
  return () => observer.disconnect();
}
