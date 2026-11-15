import { HIGHLIGHT_CSS, TEXT_COLORS } from "./style.ts";

export interface MdToken {
  token: string;
  label: string;
}

// 与 Editing Toolbar 常用项对齐的 inline 标记
export const MD_TOKENS: MdToken[] = [
  { token: "**", label: "加粗" },
  { token: "*", label: "斜体" },
  { token: "==", label: "荧光" },
  { token: "~~", label: "删除" },
  { token: "`", label: "代码" },
];

export interface ImageRef {
  kind: "wikilink" | "mdlink";
  src: string;
  alt: string;
}

export function parseImageToken(token: string): ImageRef | null {
  let m = /^!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/.exec(token);
  if (m) return { kind: "wikilink", src: m[1].trim(), alt: (m[2] ?? "").trim() };
  m = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(token);
  if (m) return { kind: "mdlink", src: m[2], alt: m[1] };
  return null;
}

const COLOR_CSS = new Set(TEXT_COLORS.map((c) => c.css.toLowerCase()));

export function colorSpanOpen(css: string): string {
  return `<span style="color:${css}">`;
}

// 选区文字单独着色：有选区包选区，无选区插入空 span 并返回内部光标位
export function wrapSelectionColor(source: string, start: number, end: number, css: string): { text: string; caret: number } {
  const open = colorSpanOpen(css);
  const close = "</span>";
  if (start === end) {
    return { text: source.slice(0, start) + open + close + source.slice(start), caret: start + open.length };
  }
  return {
    text: source.slice(0, start) + open + source.slice(start, end) + close + source.slice(end),
    caret: end + open.length + close.length,
  };
}

export function stripColorSpans(source: string): string {
  return source.replace(/<span style="color:#[0-9a-fA-F]{6}">|<\/span>/g, "");
}

export interface RenderOptions {
  resolveImage?: (src: string) => string | null;
}

// 1 代码 2 荧光 3 加粗 4 删除 5 斜体 6 颜色span开 7 wikilink图 8 mdlink图
const SCAN_RE =
  /(`[^`]+`)|(==.+?==)|(\*\*.+?\*\*)|(~~.+?~~)|(\*[^*\n]+\*)|(<span style="color:#[0-9a-fA-F]{6}">)|(!\[\[[^\]|]+(?:\|[^\]]*)?\]\])|(!\[[^\]]*\]\([^)\s]+\))/g;

const SPAN_EDGE_RE = /<span style="color:#[0-9a-fA-F]{6}">|<\/span>/g;

function findSpanEnd(text: string, from: number): number {
  SPAN_EDGE_RE.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = SPAN_EDGE_RE.exec(text)) !== null) {
    if (m[0] === "</span>") {
      depth--;
      if (depth === 0) return m.index;
    } else {
      depth++;
    }
  }
  return -1;
}

// 递归解析：颜色/荧光/加粗等可互相嵌套；代码与图片为叶子。
// 全程 textContent/createElement，span 颜色只认色板 hex，无 innerHTML 注入。
export function renderInlineMarkdown(text: string, opts: RenderOptions = {}): DocumentFragment {
  const frag = document.createDocumentFragment();
  build(text, frag, 0, opts);
  return frag;
}

function build(text: string, out: Node, depth: number, opts: RenderOptions): void {
  if (depth > 12) {
    out.appendChild(document.createTextNode(text));
    return;
  }
  SCAN_RE.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  const pushText = (s: string) => {
    if (s) out.appendChild(document.createTextNode(s));
  };
  while ((m = SCAN_RE.exec(text)) !== null) {
    pushText(text.slice(last, m.index));
    const whole = m[0];
    let next = m.index + whole.length;
    let el: HTMLElement | null = null;
    let inner: string | null = null;
    if (m[1]) {
      el = document.createElement("code");
      el.textContent = whole.slice(1, -1);
    } else if (m[2]) {
      el = document.createElement("mark");
      el.className = "nct-md-highlight";
      el.style.background = HIGHLIGHT_CSS;
      inner = whole.slice(2, -2);
    } else if (m[3]) {
      el = document.createElement("strong");
      inner = whole.slice(2, -2);
    } else if (m[4]) {
      el = document.createElement("s");
      inner = whole.slice(2, -2);
    } else if (m[5]) {
      el = document.createElement("em");
      inner = whole.slice(1, -1);
    } else if (m[6]) {
      const css = /color:(#[0-9a-fA-F]{6})/.exec(whole)?.[1].toLowerCase() ?? "";
      const end = findSpanEnd(text, next);
      if (end < 0 || !COLOR_CSS.has(css)) {
        pushText(whole);
        last = next;
        continue;
      }
      el = document.createElement("span");
      el.style.color = css;
      inner = text.slice(next, end);
      next = end + "</span>".length;
    } else {
      const ref = parseImageToken(whole);
      const url = ref ? (opts.resolveImage?.(ref.src) ?? null) : null;
      if (ref && url) {
        const img = document.createElement("img");
        img.className = "nct-img";
        img.src = url;
        img.alt = ref.alt || ref.src;
        img.title = ref.src;
        out.appendChild(img);
      } else {
        const chip = document.createElement("span");
        chip.className = "nct-img-missing";
        chip.textContent = `图片缺失：${ref?.src ?? whole}`;
        out.appendChild(chip);
      }
      last = next;
      continue;
    }
    if (el) {
      if (inner !== null) build(inner, el, depth + 1, opts);
      out.appendChild(el);
    }
    last = next;
    SCAN_RE.lastIndex = next;
  }
  pushText(text.slice(last));
}

// 有选区包裹选区；无选区在光标处插入成对标记并返回中间光标位
export function wrapSelection(source: string, start: number, end: number, token: string): { text: string; caret: number } {
  if (start === end) {
    const text = source.slice(0, start) + token + token + source.slice(start);
    return { text, caret: start + token.length };
  }
  const text = source.slice(0, start) + token + source.slice(start, end) + token + source.slice(end);
  return { text, caret: end + token.length * 2 };
}

export interface ToggleWrapResult {
  text: string;
  selStart: number;
  selEnd: number;
  wrapped: boolean;
}

// 与 CodeMirror toggleMarkdownFormatting 同语义：已包裹则解除，否则包裹；返回操作后应选中的区间
export function toggleWrap(source: string, start: number, end: number, token: string): ToggleWrapResult {
  const L = token.length;
  const sel = source.slice(start, end);
  if (sel.length >= L * 2 && sel.startsWith(token) && sel.endsWith(token)) {
    const inner = sel.slice(L, sel.length - L);
    return { text: source.slice(0, start) + inner + source.slice(end), selStart: start, selEnd: start + inner.length, wrapped: false };
  }
  if (start >= L && source.slice(start - L, start) === token && source.slice(end, end + L) === token) {
    return {
      text: source.slice(0, start - L) + sel + source.slice(end + L),
      selStart: start - L,
      selEnd: end - L,
      wrapped: false,
    };
  }
  return {
    text: source.slice(0, start) + token + sel + token + source.slice(end),
    selStart: start + L,
    selEnd: end + L,
    wrapped: true,
  };
}

// Editing Toolbar 的格式命令 → 行内标记；单元格聚焦时由本插件接管（画布内 getActiveEditor 为 null）
export const TOOLBAR_FORMAT_COMMANDS: Record<string, string> = {
  "editing-toolbar:toggle-bold": "**",
  "editing-toolbar:toggle-italics": "*",
  "editing-toolbar:toggle-strikethrough": "~~",
  "editing-toolbar:toggle-highlight": "==",
  "editing-toolbar:format-eraser": "",
};