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