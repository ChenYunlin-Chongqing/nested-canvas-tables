import test from "node:test";
import assert from "node:assert/strict";
import {
  addColumn,
  addRow,
  createDocument,
  createTable,
  findCell,
  hasContent,
  insertColumn,
  insertRow,
  normalizeColumnHeaders,
  removeColumn,
  removeRow,
  tableAtPath,
} from "../src/core/model.ts";
import type { Table } from "../src/core/model.ts";

test("新建文档默认 3 列 2 行，每行单元格数与列数一致", () => {
  const doc = createDocument("测试");
  assert.equal(doc.formatVersion, 1);
  assert.equal(doc.columns.length, 3);
  assert.equal(doc.rows.length, 2);
  for (const row of doc.rows) assert.equal(row.cells.length, 3);
});

test("新增行/列后所有行单元格数仍与列数一致", () => {
  const t = createTable("t", 2, 2);
  addRow(t);
  addColumn(t);
  assert.equal(t.columns.length, 3);
  assert.equal(t.rows.length, 3);
  for (const row of t.rows) assert.equal(row.cells.length, 3);
});

test("删除行/列同步移除对应单元格", () => {
  const t = createTable("t", 3, 3);
  const rowId = t.rows[1].id;
  removeRow(t, rowId);
  removeColumn(t, 1);
  assert.equal(t.rows.length, 2);
  assert.equal(t.columns.length, 2);
  assert.ok(!t.rows.some((r) => r.id === rowId));
  for (const row of t.rows) assert.equal(row.cells.length, 2);
});

test("至少保留一行一列", () => {
  const t = createTable("t", 1, 1);
  assert.throws(() => removeRow(t, t.rows[0].id), /至少保留一行/);
  assert.throws(() => removeColumn(t, 0), /至少保留一列/);
});

test("三层递归嵌套：tableAtPath 逐级定位，findCell 跨层查找", () => {
  const root = createTable("根", 1, 1);
  const level1 = createTable("一层", 1, 1);
  const level2 = createTable("二层", 1, 1);
  const level3 = createTable("三层", 1, 1);
  root.rows[0].cells[0].childTable = level1;
  level1.rows[0].cells[0].childTable = level2;
  level2.rows[0].cells[0].childTable = level3;
  const path = [root.rows[0].cells[0].id, level1.rows[0].cells[0].id, level2.rows[0].cells[0].id];
  assert.equal(tableAtPath(root, path), level3);
  assert.equal(tableAtPath(root, path.slice(0, 2)), level2);
  assert.equal(tableAtPath(root, ["不存在"]), null);
  const deepCell = level3.rows[0].cells[0];
  assert.equal(findCell(root, deepCell.id), deepCell);
});

test("hasContent 递归检测文本与子表格", () => {
  const t = createTable("t", 2, 1);
  assert.equal(hasContent(t), false);
  const child = createTable("子", 1, 1);
  t.rows[0].cells[0].childTable = child;
  assert.equal(hasContent(t), false);
  child.rows[0].cells[0].text = "深处有字";
  assert.equal(hasContent(t), true);
});

test("所有 id 唯一且序列化往返一致", () => {
  const doc = createDocument("往返");
  doc.rows[0].cells[0].childTable = createTable("子", 2, 2);
  const ids: string[] = [];
  const walk = (t: Table) => {
    ids.push(t.id);
    for (const r of t.rows) {
      ids.push(r.id);
      for (const c of r.cells) {
        ids.push(c.id);
        if (c.childTable) walk(c.childTable);
      }
    }
  };
  walk(doc);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(JSON.parse(JSON.stringify(doc)), doc);
});

test("列名为可编辑文字：默认列 N、可改名、按索引删除", () => {
  const t = createTable("t", 2, 1);
  assert.deepEqual(t.columns, ["列 1", "列 2"]);
  t.columns[0] = "病史";
  addColumn(t);
  assert.deepEqual(t.columns, ["病史", "列 2", "列 3"]);
  removeColumn(t, 0);
  assert.deepEqual(t.columns, ["列 2", "列 3"]);
  assert.equal(t.rows[0].cells.length, 2);
});

test("旧 col_id 表头迁移为列 N（含递归子表）", () => {
  const t = createTable("t", 2, 1);
  t.columns = ["col_aaaa", "col_bbbb"];
  const child = createTable("子", 1, 1);
  child.columns = ["col_cccc"];
  t.rows[0].cells[0].childTable = child;
  normalizeColumnHeaders(t);
  assert.deepEqual(t.columns, ["列 1", "列 2"]);
  assert.deepEqual(child.columns, ["列 1"]);
});

test("增删列同步维护 columnStyles 对齐", () => {
  const t = createTable("t", 2, 1);
  t.columnStyles = [{ color: "red" }, null];
  addColumn(t);
  assert.deepEqual(t.columnStyles, [{ color: "red" }, null, null]);
  removeColumn(t, 0);
  assert.deepEqual(t.columnStyles, [null, null]);
  assert.equal(t.columnStyles.length, t.columns.length);
});

test("增删行列同步维护 columnWidths/rowHeights 对齐", () => {
  const t = createTable("t", 2, 2);
  t.columnWidths = [120, null];
  t.rowHeights = [40, null];
  addColumn(t);
  addRow(t);
  assert.deepEqual(t.columnWidths, [120, null, null]);
  assert.deepEqual(t.rowHeights, [40, null, null]);
  removeColumn(t, 0);
  removeRow(t, t.rows[0].id);
  assert.deepEqual(t.columnWidths, [null, null]);
  assert.deepEqual(t.rowHeights, [null, null]);
  assert.equal(t.columnWidths.length, t.columns.length);
  assert.equal(t.rowHeights.length, t.rows.length);
});

test("指定位置插入行/列：单元格与尺寸数组同步对齐", () => {
  const t = createTable("t", 2, 2);
  t.columnWidths = [120, null];
  t.rowHeights = [40, null];
  t.columnStyles = [{ color: "red" }, null];
  t.rows[0].cells[0].text = "甲";
  t.rows[1].cells[0].text = "乙";
  insertRow(t, 1);
  assert.equal(t.rows.length, 3);
  assert.equal(t.rows[1].cells.length, 2);
  assert.equal(t.rows[1].cells[0].text, "");
  assert.equal(t.rows[2].cells[0].text, "乙");
  assert.deepEqual(t.rowHeights, [40, null, null]);
  insertColumn(t, 0);
  assert.deepEqual(t.columns, ["列 3", "列 1", "列 2"]);
  assert.deepEqual(t.columnWidths, [null, 120, null]);
  assert.deepEqual(t.columnStyles, [null, { color: "red" }, null]);
  for (const row of t.rows) {
    assert.equal(row.cells.length, 3);
    assert.equal(row.cells[1].text === "甲" || row.cells[1].text === "乙" || row.cells[1].text === "", true);
  }
  assert.equal(t.rows[0].cells[1].text, "甲");
  assert.equal(t.rows[2].cells[1].text, "乙");
});