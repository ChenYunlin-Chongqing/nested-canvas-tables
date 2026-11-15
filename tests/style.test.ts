import test from "node:test";
import assert from "node:assert/strict";
import { BG_TINTS, H_ALIGNS, TEXT_COLORS, V_ALIGNS, bgTintCss, textColorCss, validateCellStyle } from "../src/core/style.ts";

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

test("水平×垂直对齐全组合通过，可与颜色/底纹叠加", () => {
  for (const h of H_ALIGNS) {
    for (const v of V_ALIGNS) {
      assert.equal(validateCellStyle({ align: h.token, valign: v.token }), null);
    }
  }
  assert.equal(validateCellStyle({ align: "justify", valign: "bottom", color: "blue", bg: "tint-3" }), null);
  assert.equal(validateCellStyle({ color: "red" }), null);
});

test("非法对齐 token 被拒绝（可读中文）", () => {
  assert.match(validateCellStyle({ align: "middle" })!, /align/);
  assert.match(validateCellStyle({ valign: "center" })!, /valign/);
  assert.match(validateCellStyle({ align: 3 })!, /align/);
});

test("对齐菜单数组覆盖需求：四水平三垂直", () => {
  assert.deepEqual(H_ALIGNS.map((a) => a.token), ["left", "center", "right", "justify"]);
  assert.deepEqual(V_ALIGNS.map((a) => a.token), ["top", "middle", "bottom"]);
});