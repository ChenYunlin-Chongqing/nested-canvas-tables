import type { CellStyle } from "./style.ts";

export interface Cell {
  id: string;
  text: string;
  childTable?: Table;
  style?: CellStyle;
}

export interface Row {
  id: string;
  cells: Cell[];
}

export interface Table {
  id: string;
  title: string;
  columns: string[];
  // 与 columns 等长的表头样式（null 表示无），缺省整体省略
  columnStyles?: (CellStyle | null)[];
  // 拖拽设定的列宽/行高（px，null 表示随内容），缺省整体省略
  columnWidths?: (number | null)[];
  rowHeights?: (number | null)[];
  rows: Row[];
}

export interface TableDocument extends Table {
  formatVersion: 1;
  // 一键适应容器宽度：根表与嵌套子表撑满各自容器，外框拉大实时跟随；缺省=随内容收缩
  fitWidth?: boolean;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function createCell(): Cell {
  return { id: newId("cell"), text: "" };
}

export function createRow(columnCount: number): Row {
  return { id: newId("row"), cells: Array.from({ length: columnCount }, createCell) };
}

export function createTable(title: string, columnCount = 3, rowCount = 2): Table {
  return {
    id: newId("table"),
    title,
    columns: Array.from({ length: columnCount }, (_, i) => `列 ${i + 1}`),
    rows: Array.from({ length: rowCount }, () => createRow(columnCount)),
  };
}

export function createDocument(title: string): TableDocument {
  return { formatVersion: 1, ...createTable(title) };
}

export function addRow(table: Table): Row {
  const row = createRow(table.columns.length);
  table.rows.push(row);
  table.rowHeights?.push(null);
  return row;
}

export function addColumn(table: Table): string {
  const header = `列 ${table.columns.length + 1}`;
  table.columns.push(header);
  table.columnStyles?.push(null);
  table.columnWidths?.push(null);
  for (const row of table.rows) row.cells.push(createCell());
  return header;
}

export function removeRow(table: Table, rowId: string): void {
  if (table.rows.length <= 1) throw new Error("至少保留一行");
  const index = table.rows.findIndex((r) => r.id === rowId);
  if (index < 0) throw new Error("行不存在");
  table.rows.splice(index, 1);
  table.rowHeights?.splice(index, 1);
}

export function removeColumn(table: Table, index: number): void {
  if (table.columns.length <= 1) throw new Error("至少保留一列");
  if (index < 0 || index >= table.columns.length) throw new Error("列不存在");
  table.columns.splice(index, 1);
  table.columnStyles?.splice(index, 1);
  table.columnWidths?.splice(index, 1);
  for (const row of table.rows) row.cells.splice(index, 1);
}

export function findCell(table: Table, cellId: string): Cell | null {
  for (const row of table.rows) {
    for (const cell of row.cells) {
      if (cell.id === cellId) return cell;
      if (cell.childTable) {
        const hit = findCell(cell.childTable, cellId);
        if (hit) return hit;
      }
    }
  }
  return null;
}

// path 为从根表格出发的单元格 id 链，每一级指向含 childTable 的单元格
export function tableAtPath(root: Table, path: string[]): Table | null {
  let current: Table = root;
  for (const cellId of path) {
    const cell = current.rows.flatMap((r) => r.cells).find((c) => c.id === cellId);
    if (!cell?.childTable) return null;
    current = cell.childTable;
  }
  return current;
}

export function hasContent(table: Table): boolean {
  return table.rows.some((row) =>
    row.cells.some((cell) => cell.text.trim() !== "" || (cell.childTable ? hasContent(cell.childTable) : false)),
  );
}

// 旧版 columns 存的是 col_<uuid> 内部 ID；升级为可编辑表头文字时归一化为「列 N」
export function normalizeColumnHeaders(table: Table): void {
  table.columns = table.columns.map((c, i) => (/^col_[0-9a-f-]+$/i.test(c) ? `列 ${i + 1}` : c));
  for (const row of table.rows) {
    for (const cell of row.cells) {
      if (cell.childTable) normalizeColumnHeaders(cell.childTable);
    }
  }
}