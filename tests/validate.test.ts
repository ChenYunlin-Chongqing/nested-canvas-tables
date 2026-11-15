import test from "node:test";
import assert from "node:assert/strict";
import { createDocument, createTable } from "../src/core/model.ts";
import { parseDocument } from "../src/core/validate.ts";

test("合法文档（含子表格）通过校验", () => {
  const doc = createDocument("合法");
  doc.rows[0].cells[0].childTable = createTable("子", 2, 1);
  const res = parseDocument(JSON.stringify(doc));
  assert.equal(res.ok, true);
  if (res.ok) assert.deepEqual(res.doc, doc);
});

test("坏 JSON 返回可读错误", () => {
  const res = parseDocument("{不是json");
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /JSON 解析失败/);
});

test("不支持的格式版本被拒绝", () => {
  const doc = { ...createDocument("v2"), formatVersion: 2 };
  const res = parseDocument(JSON.stringify(doc));
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /不支持的格式版本/);
});

test("单元格数与列数不一致被拒绝", () => {
  const doc = createDocument("缺格");
  doc.rows[0].cells.pop();
  const res = parseDocument(JSON.stringify(doc));
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /不一致/);
});

test("重复 id 被拒绝", () => {
  const doc = createDocument("重复");
  doc.rows[1].id = doc.rows[0].id;
  const res = parseDocument(JSON.stringify(doc));
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /id 重复/);
});

test("子表格结构错误被递归检出", () => {
  const doc = createDocument("坏子表");
  const child = createTable("子", 2, 1);
  child.rows[0].cells.pop();
  doc.rows[0].cells[0].childTable = child;
  const res = parseDocument(JSON.stringify(doc));
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /子表格/);
});

test("非对象内容被拒绝", () => {
  for (const raw of ["null", "42", '"文本"', "[]"]) {
    const res = parseDocument(raw);
    assert.equal(res.ok, false);
  }
});

test("合法整格 style 通过、坏 style 被拒绝", () => {
  const good = createDocument("style");
  good.rows[0].cells[0].style = { color: "red", bg: "tint-2" };
  assert.equal(parseDocument(JSON.stringify(good)).ok, true);
  const bad = createDocument("badstyle");
  (bad.rows[0].cells[0] as { style?: unknown }).style = { color: "nope" };
  const res = parseDocument(JSON.stringify(bad));
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /color/);
});

test("columnWidths/rowHeights：null 与合法数字通过、长度不符与非法值被拒绝", () => {
  const good = createDocument("sizes");
  good.columnWidths = [120, null, null];
  good.rowHeights = [null, 60];
  assert.equal(parseDocument(JSON.stringify(good)).ok, true);
  const badLen = createDocument("badlen");
  badLen.columnWidths = [120];
  const r1 = parseDocument(JSON.stringify(badLen));
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.match(r1.error, /columnWidths 与列数不一致/);
  const badVal = createDocument("badval");
  badVal.rowHeights = [10, null];
  const r2 = parseDocument(JSON.stringify(badVal));
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.match(r2.error, /非法尺寸/);
});

test("fitWidth：布尔通过、缺省通过、非布尔被拒绝", () => {
  const on = createDocument("fit");
  on.fitWidth = true;
  assert.equal(parseDocument(JSON.stringify(on)).ok, true);
  assert.equal(parseDocument(JSON.stringify(createDocument("nofit"))).ok, true);
  const bad = { ...createDocument("badfit"), fitWidth: "yes" };
  const res = parseDocument(JSON.stringify(bad));
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /fitWidth/);
});

test("表头 columnStyles：null 与合法 token 通过、坏 token 与长度不符被拒绝", () => {
  const good = createDocument("headstyle");
  good.columnStyles = [null, { color: "orange" }, { bg: "tint-5" }];
  assert.equal(parseDocument(JSON.stringify(good)).ok, true);
  const bad = createDocument("badhead");
  bad.columnStyles = [null, { color: "nope" }, null];
  const res = parseDocument(JSON.stringify(bad));
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /表头/);
  const mismatch = createDocument("len");
  mismatch.columnStyles = [null];
  const res2 = parseDocument(JSON.stringify(mismatch));
  assert.equal(res2.ok, false);
  if (!res2.ok) assert.match(res2.error, /columnStyles 与列数不一致/);
});