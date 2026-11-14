import test from "node:test";
import assert from "node:assert/strict";
import { BG_TINTS, TEXT_COLORS, bgTintCss, textColorCss, validateCellStyle } from "../src/core/style.ts";

test("合法 style 通过、缺省通过", () => {
  assert.equal(validateCellStyle(undefined), null);
  assert.equal(validateCellStyle({ color: "red", bg: "tint-1" }), null);
});

test("未知字段/非 token 被拒绝（可读中文）", () => {
  assert.match(validateCellStyle({ bold: true })!, /未知字段/);
  assert.match(validateCellStyle({ color: "nope" })!, /color/);
  assert.match(validateCellStyle({ bg: "nope" })!, /bg/);
  assert.match(validateCellStyle("x")!, /不是对象/);
});

test("色板 token 与 CSS 映射一一对应", () => {
  for (const c of TEXT_COLORS) assert.equal(textColorCss(c.token), c.css);
  for (const b of BG_TINTS) assert.equal(bgTintCss(b.token), b.css);
  assert.equal(textColorCss("missing"), null);
  assert.equal(bgTintCss(undefined), null);
  assert.equal(TEXT_COLORS.length, 5);
  assert.equal(BG_TINTS.length, 5);
});