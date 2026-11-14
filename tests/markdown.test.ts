import test from "node:test";
import assert from "node:assert/strict";
import { wrapSelection, MD_TOKENS } from "../src/core/markdown.ts";

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