import { App, TFile } from "obsidian";
import { normalizeColumnHeaders, type TableDocument } from "./model.ts";
import { parseDocument } from "./validate.ts";

export type LoadResult = { ok: true; doc: TableDocument } | { ok: false; error: string };
export type SaveResult = { ok: true } | { ok: false; error: string };

export class TableStore {
  conflict = false;
  private lastWritten: string | null = null;
  private selfWrite = false;

  constructor(private app: App, readonly path: string) {}

  async load(): Promise<LoadResult> {
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (!(file instanceof TFile)) return { ok: false, error: `找不到数据文件：${this.path}` };
    const raw = await this.app.vault.read(file);
    const parsed = parseDocument(raw);
    if (!parsed.ok) return parsed;
    normalizeColumnHeaders(parsed.doc);
    this.lastWritten = raw;
    this.conflict = false;
    return { ok: true, doc: parsed.doc };
  }

  async save(doc: TableDocument): Promise<SaveResult> {
    if (this.conflict) return { ok: false, error: "数据文件已被外部修改，自动保存已停止" };
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (!(file instanceof TFile)) {
      this.conflict = true;
      return { ok: false, error: `数据文件缺失：${this.path}，自动保存已停止` };
    }
    const next = JSON.stringify(doc, null, 2) + "\n";
    let externalChange = false;
    this.selfWrite = true;
    try {
      await this.app.vault.process(file, (current) => {
        if (this.lastWritten !== null && current !== this.lastWritten) {
          externalChange = true;
          return current;
        }
        return next;
      });
    } catch (e) {
      return { ok: false, error: `写入失败：${e instanceof Error ? e.message : String(e)}` };
    } finally {
      this.selfWrite = false;
    }
    if (externalChange) {
      this.conflict = true;
      return { ok: false, error: "数据文件已被外部修改，自动保存已停止" };
    }
    this.lastWritten = next;
    return { ok: true };
  }

  // 自写窗口用 selfWrite 抑制；事件延迟送达时再用内容比对兜底，避免误报冲突
  async handleExternalModify(file: TFile): Promise<boolean> {
    if (file.path !== this.path || this.conflict || this.selfWrite) return this.conflict;
    const raw = await this.app.vault.read(file);
    if (raw !== this.lastWritten) this.conflict = true;
    return this.conflict;
  }
}