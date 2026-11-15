import test from "node:test";
import assert from "node:assert/strict";
import { wrapSelection, wrapSelectionColor, stripColorSpans, parseImageToken, toggleWrap, MD_TOKENS, TOOLBAR_FORMAT_COMMANDS } from "../src/core/markdown.ts";

test("有选区：包裹选区并返回末尾光标", () => {
  const r = wrapSelection("abc", 1, 2, "==");
  assert.equal(r.text, "a==b==c");
  assert.equal(r.caret, 6);
});

test("无选区：插入成对标记、光标置中间", () => {
  const r = wrapSelection("ab", 1, 1, "**");
  assert.equal(r.text, "a****b");
  assert.equal(r.caret, 3);
});

test("五种标记齐全（对齐 Editing Toolbar 常用项）", () => {
  assert.deepEqual(MD_TOKENS.map((t) => t.token), ["**", "*", "==", "~~", "`"]);
});

test("选区颜色：只包裹选区文字", () => {
  const r = wrapSelectionColor("有三重症状", 0, 2, "#d08a3e");
  assert.equal(r.text, '<span style="color:#d08a3e">有三</span>重症状');
  assert.equal(r.caret, '<span style="color:#d08a3e">有三</span>'.length);
});

test("无选区颜色：插入空 span 且光标在内部", () => {
  const r = wrapSelectionColor("ab", 1, 1, "#d05454");
  assert.equal(r.text, 'a<span style="color:#d05454"></span>b');
  assert.equal(r.caret, 1 + '<span style="color:#d05454">'.length);
});

test("清除颜色 span 保留其余文字与标记", () => {
  const src = '**<span style="color:#d08a3e">发热</span>**三天';
  assert.equal(stripColorSpans(src), "**发热**三天");
});

test("toggleWrap：有选区包裹并选中内部文字", () => {
  const r = toggleWrap("今天是个好日子", 4, 7, "**");
  assert.equal(r.text, "今天是个**好日子**");
  assert.equal(r.wrapped, true);
  assert.equal(r.text.slice(r.selStart, r.selEnd), "好日子");
});

test("toggleWrap：选区外侧已有标记则解除", () => {
  const r = toggleWrap("今天是个**好日子**", 6, 9, "**");
  assert.equal(r.text, "今天是个好日子");
  assert.equal(r.wrapped, false);
  assert.equal(r.text.slice(r.selStart, r.selEnd), "好日子");
});

test("toggleWrap：选区自身含标记则剥掉", () => {
  const r = toggleWrap("a**b**c", 1, 6, "**");
  assert.equal(r.text, "abc");
  assert.equal(r.wrapped, false);
  assert.equal(r.selStart, 1);
  assert.equal(r.selEnd, 2);
});

test("toggleWrap：无选区插入成对标记、光标在中间", () => {
  const r = toggleWrap("ab", 1, 1, "==");
  assert.equal(r.text, "a====b");
  assert.equal(r.selStart, 3);
  assert.equal(r.selEnd, 3);
});

test("toggleWrap：行首选区外侧标记可解除", () => {
  const r = toggleWrap("**好**", 2, 3, "**");
  assert.equal(r.wrapped, false);
  assert.equal(r.text, "好");
  assert.equal(r.selStart, 0);
  assert.equal(r.selEnd, 1);
});

test("toggleWrap：行首无标记正常包裹", () => {
  const r = toggleWrap("好", 0, 1, "**");
  assert.equal(r.wrapped, true);
  assert.equal(r.text, "**好**");
});

test("Editing Toolbar 命令映射覆盖常用格式", () => {
  assert.equal(TOOLBAR_FORMAT_COMMANDS["editing-toolbar:toggle-bold"], "**");
  assert.equal(TOOLBAR_FORMAT_COMMANDS["editing-toolbar:toggle-italics"], "*");
  assert.equal(TOOLBAR_FORMAT_COMMANDS["editing-toolbar:toggle-highlight"], "==");
  assert.equal(TOOLBAR_FORMAT_COMMANDS["editing-toolbar:toggle-strikethrough"], "~~");
  assert.ok("editing-toolbar:format-eraser" in TOOLBAR_FORMAT_COMMANDS);
});

test("图片 token 解析：wikilink 与 mdlink", () => {
  assert.deepEqual(parseImageToken("![[NestedTables/attachments/a.png]]"), {
    kind: "wikilink",
    src: "NestedTables/attachments/a.png",
    alt: "",
  });
  assert.deepEqual(parseImageToken("![[a.png|封面]]"), { kind: "wikilink", src: "a.png", alt: "封面" });
  assert.deepEqual(parseImageToken("![图](attachments/a.png)"), { kind: "mdlink", src: "attachments/a.png", alt: "图" });
  assert.equal(parseImageToken("[[a.png]]"), null);
  assert.equal(parseImageToken("![]( )"), null);
});