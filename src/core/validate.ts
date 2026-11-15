import type { TableDocument } from "./model.ts";
import { validateCellStyle } from "./style.ts";

export type ParseResult = { ok: true; doc: TableDocument } | { ok: false; error: string };

export function parseDocument(raw: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}` };
  }
  if (typeof data !== "object" || data === null) return { ok: false, error: "数据文件内容不是 JSON 对象" };
  const obj = data as Record<string, unknown>;
  if (obj.formatVersion !== 1) {
    return { ok: false, error: `不支持的格式版本：${String(obj.formatVersion)}（本插件仅支持 formatVersion 1）` };
  }
  const ids = new Set<string>();
  const error = checkTable(obj, ids, "根表格");
  if (error) return { ok: false, error };
  return { ok: true, doc: data as TableDocument };
}

function checkTable(value: unknown, ids: Set<string>, label: string): string | null {
  if (typeof value !== "object" || value === null) return `${label}不是对象`;
  const t = value as Record<string, unknown>;
  if (typeof t.id !== "string" || t.id === "") return `${label}缺少有效 id`;
  if (ids.has(t.id)) return `${label} id 重复：${t.id}`;
  ids.add(t.id);
  if (typeof t.title !== "string") return `${label}缺少 title 字段`;
  if (!Array.isArray(t.columns) || t.columns.length === 0 || t.columns.some((c) => typeof c !== "string")) {
    return `${label} columns 无效（至少一列，且均为字符串表头）`;
  }
  if (t.columnStyles !== undefined) {
    if (!Array.isArray(t.columnStyles) || t.columnStyles.length !== t.columns.length) {
      return `${label} columnStyles 与列数不一致`;
    }
    for (let i = 0; i < t.columnStyles.length; i++) {
      const styleError = validateCellStyle(t.columnStyles[i]);
      if (styleError) return `${label}第 ${i + 1} 列表头 ${styleError}`;
    }
  }
  const widthError = checkSizeArray(t.columnWidths, t.columns.length, `${label} columnWidths 与列数不一致`, `${label} columnWidths`);
  if (widthError) return widthError;
  if (!Array.isArray(t.rows)) return `${label} rows 不是数组`;
  const heightError = checkSizeArray(t.rowHeights, t.rows.length, `${label} rowHeights 与行数不一致`, `${label} rowHeights`);
  if (heightError) return heightError;
  for (let i = 0; i < t.rows.length; i++) {
    const error = checkRow(t.rows[i], t.columns.length, ids, `${label}第 ${i + 1} 行`);
    if (error) return error;
  }
  return null;
}

function checkSizeArray(value: unknown, len: number, mismatchError: string, label: string): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length !== len) return mismatchError;
  for (const v of value) {
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 20)) {
      return `${label} 含非法尺寸（须为 null 或 ≥20 的数字）`;
    }
  }
  return null;
}

function checkRow(value: unknown, columnCount: number, ids: Set<string>, label: string): string | null {
  if (typeof value !== "object" || value === null) return `${label}不是对象`;
  const r = value as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id === "") return `${label}缺少有效 id`;
  if (ids.has(r.id)) return `${label} id 重复：${r.id}`;
  ids.add(r.id);
  if (!Array.isArray(r.cells)) return `${label} cells 不是数组`;
  if (r.cells.length !== columnCount) return `${label}单元格数（${r.cells.length}）与列数（${columnCount}）不一致`;
  for (let i = 0; i < r.cells.length; i++) {
    const error = checkCell(r.cells[i], ids, `${label}第 ${i + 1} 格`);
    if (error) return error;
  }
  return null;
}

function checkCell(value: unknown, ids: Set<string>, label: string): string | null {
  if (typeof value !== "object" || value === null) return `${label}不是对象`;
  const c = value as Record<string, unknown>;
  if (typeof c.id !== "string" || c.id === "") return `${label}缺少有效 id`;
  if (ids.has(c.id)) return `${label} id 重复：${c.id}`;
  ids.add(c.id);
  if (typeof c.text !== "string") return `${label} text 不是字符串`;
  const styleError = validateCellStyle(c.style);
  if (styleError) return `${label} ${styleError}`;
  if (c.childTable !== undefined) {
    return checkTable(c.childTable, ids, `${label}的子表格`);
  }
  return null;
}