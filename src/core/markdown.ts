import { HIGHLIGHT_CSS } from "./style.ts";

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

const INLINE_RE = /(`[^`]+`)|(==[^=]+==)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(~~[^~]+~~)/g;

// 只认 5 种标记、不嵌套、未知标记原样保留；全程 textContent/createElement，无 innerHTML 注入
export function renderInlineMarkdown(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  let last = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  const pushText = (s: string) => {
    if (s) frag.appendChild(document.createTextNode(s));
  };
  while ((m = INLINE_RE.exec(text)) !== null) {
    pushText(text.slice(last, m.index));
    const whole = m[0];
    let el: HTMLElement;
    if (m[1]) {
      el = document.createElement("code");
      el.textContent = whole.slice(1, -1);
    } else if (m[2]) {
      el = document.createElement("mark");
      el.className = "nct-md-highlight";
      el.style.background = HIGHLIGHT_CSS;
      el.textContent = whole.slice(2, -2);
    } else if (m[3]) {
      el = document.createElement("strong");
      el.textContent = whole.slice(2, -2);
    } else if (m[4]) {
      el = document.createElement("em");
      el.textContent = whole.slice(1, -1);
    } else {
      el = document.createElement("s");
      el.textContent = whole.slice(2, -2);
    }
    frag.appendChild(el);
    last = m.index + whole.length;
  }
  pushText(text.slice(last));
  return frag;
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