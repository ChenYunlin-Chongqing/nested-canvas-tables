export interface Cell {
  id: string;
  text: string;
  childTable?: Table;
}

export interface Row {
  id: string;
  cells: Cell[];
}

export interface Table {
  id: string;
  title: string;
  columns: string[];
  rows: Row[];
}

export interface TableDocument extends Table {
  formatVersion: 1;
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
    columns: Array.from({ length: columnCount }, () => newId("col")),
    rows: Array.from({ length: rowCount }, () => createRow(columnCount)),
  };
}

export function createDocument(title: string): TableDocument {
  return { formatVersion: 1, ...createTable(title) };
}

export function addRow(table: Table): Row {
  const row = createRow(table.columns.length);
  table.rows.push(row);
  return row;
}

export function addColumn(table: Table): string {
  const id = newId("col");
  table.columns.push(id);
  for (const row of table.rows) row.cells.push(createCell());
  return id;
}

export function removeRow(table: Table, rowId: string): void {
  if (table.rows.length <= 1) throw new Error("至少保留一行");
  const index = table.rows.findIndex((r) => r.id === rowId);
  if (index < 0) throw new Error("行不存在");
  table.rows.splice(index, 1);
}

export function removeColumn(table: Table, columnId: string): void {
  if (table.columns.length <= 1) throw new Error("至少保留一列");
  const index = table.columns.indexOf(columnId);
  if (index < 0) throw new Error("列不存在");
  table.columns.splice(index, 1);
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