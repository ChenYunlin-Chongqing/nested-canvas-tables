import test from "node:test";
import assert from "node:assert/strict";
import {
  addColumn,
  addRow,
  createDocument,
  createTable,
  findCell,
  hasContent,
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
  const colId = t.columns[1];
  removeRow(t, rowId);
  removeColumn(t, colId);
  assert.equal(t.rows.length, 2);
  assert.equal(t.columns.length, 2);
  assert.ok(!t.rows.some((r) => r.id === rowId));
  for (const row of t.rows) assert.equal(row.cells.length, 2);
});

test("至少保留一行一列", () => {
  const t = createTable("t", 1, 1);
  assert.throws(() => removeRow(t, t.rows[0].id), /至少保留一行/);
  assert.throws(() => removeColumn(t, t.columns[0]), /至少保留一列/);
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
    ids.push(t.id, ...t.columns);
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