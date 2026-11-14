import { App, MarkdownRenderChild, Menu, TFile } from "obsidian";
import {
  addColumn,
  addRow,
  createTable,
  findCell,
  hasContent,
  removeColumn,
  removeRow,
  type Cell,
  type Table,
  type TableDocument,
} from "../core/model.ts";
import { MD_TOKENS, renderInlineMarkdown, wrapSelection } from "../core/markdown.ts";
import { BG_TINTS, TEXT_COLORS, bgTintCss, textColorCss } from "../core/style.ts";
import { TableStore } from "../core/store.ts";

export class NctableView extends MarkdownRenderChild {
  private store: TableStore | null = null;
  private doc: TableDocument | null = null;
  private saveTimer: number | null = null;
  private statusEl: HTMLElement | null = null;
  private collapsed = new Set<string>();
  private renderAbort: AbortController | null = null;

  constructor(private app: App, private source: string, containerEl: HTMLElement) {
    super(containerEl);
  }

  onload(): void {
    // 只阻断冒泡、不 preventDefault：输入控件保持默认行为，Canvas 节点拖动留给标题区
    for (const type of ["pointerdown", "mousedown", "touchstart", "dblclick"] as const) {
      this.registerDomEvent(this.containerEl, type, (e) => e.stopPropagation());
    }
    this.registerDomEvent(this.containerEl, "contextmenu", (e) => {
      const td = (e.target as HTMLElement).closest?.(".nct-cell-td") as HTMLElement | null;
      if (!td || !this.doc) return;
      e.preventDefault();
      e.stopPropagation();
      const cell = findCell(this.doc, td.dataset.cellId ?? "");
      if (cell) this.openCellMenu(cell, td, e);
    });
    void this.init();
  }

  onunload(): void {
    this.renderAbort?.abort();
    this.renderAbort = null;
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      void this.doSave();
    }
  }

  private async init(): Promise<void> {
    let dataPath: string;
    try {
      const cfg = JSON.parse(this.source) as { data?: unknown };
      if (typeof cfg.data !== "string" || cfg.data === "") throw new Error("缺少 data 字段");
      dataPath = cfg.data;
    } catch (e) {
      this.renderFatal(`nctable 代码块配置无效：${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    this.store = new TableStore(this.app, dataPath);
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile) || !this.store) return;
        void this.store.handleExternalModify(file).then((conflict) => {
          if (conflict) this.renderConflict();
        });
      }),
    );
    const res = await this.store.load();
    if (!res.ok) {
      this.renderFatal(res.error);
      return;
    }
    this.doc = res.doc;
    this.render();
  }

  private render(): void {
    this.renderAbort?.abort();
    this.renderAbort = new AbortController();
    this.containerEl.empty();
    this.containerEl.addClass("nct-wrap");
    if (!this.doc) return;
    this.containerEl.appendChild(this.buildTable(this.doc, [], false));
    this.statusEl = document.createElement("div");
    this.statusEl.className = "nct-status";
    this.statusEl.textContent = "已加载";
    this.containerEl.appendChild(this.statusEl);
    const settings = (this.app as unknown as { plugins?: { plugins?: Record<string, { settings?: { showHints?: boolean } }> } }).plugins
      ?.plugins?.["nested-canvas-tables"]?.settings;
    if (settings?.showHints) {
      const hint = document.createElement("div");
      hint.className = "nct-hint";
      hint.textContent = "悬停显示操作 · 右键设置格式 · 支持 ==荧光== **加粗**";
      this.containerEl.appendChild(hint);
      const timer = window.setTimeout(() => hint.classList.add("is-faded"), 6000);
      this.register(() => window.clearTimeout(timer));
    }
  }

  private signal(): AddEventListenerOptions {
    return { signal: this.renderAbort!.signal };
  }

  private button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `nct-btn ${cls}`;
    b.textContent = label;
    b.addEventListener("click", onClick, this.signal());
    return b;
  }

  private buildTable(table: Table, path: string[], isChild: boolean): HTMLElement {
    const block = document.createElement("div");
    block.className = isChild ? "nct-table-block nct-child" : "nct-table-block";

    const toolbar = document.createElement("div");
    toolbar.className = "nct-toolbar";
    toolbar.appendChild(this.button("+ 行", "", () => { addRow(table); this.render(); this.scheduleSave(); }));
    toolbar.appendChild(this.button("+ 列", "", () => { addColumn(table); this.render(); this.scheduleSave(); }));
    if (isChild) {
      toolbar.appendChild(this.button("删除子表", "nct-danger", () => {
        if (hasContent(table) && !window.confirm("删除此子表格及其全部内容，确定？")) return;
        const parentCell = this.cellAtPath(path);
        if (parentCell) delete parentCell.childTable;
        this.render();
        this.scheduleSave();
      }));
    }
    block.appendChild(toolbar);

    const tableEl = document.createElement("table");
    tableEl.className = "nct-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    table.columns.forEach((header, i) => {
      const th = document.createElement("th");
      const head = document.createElement("span");
      head.className = "nct-colhead";
      head.contentEditable = "plaintext-only";
      head.textContent = header;
      head.addEventListener("input", () => {
        table.columns[i] = head.textContent ?? "";
        this.scheduleSave();
      }, this.signal());
      th.appendChild(head);
      const del = this.button("×", "nct-del", () => {
        const occupied = table.rows.some((r) => { const c = r.cells[i]; return c.text.trim() !== "" || !!c.childTable; });
        if (occupied && !window.confirm(`删除「${table.columns[i] || `列 ${i + 1}`}」将同时删除该列所有单元格内容（含子表格），确定？`)) return;
        removeColumn(table, i);
        this.render();
        this.scheduleSave();
      });
      del.disabled = table.columns.length <= 1;
      del.title = "删除此列";
      th.appendChild(del);
      headRow.appendChild(th);
    });
    const corner = document.createElement("th");
    corner.className = "nct-rowdel-col";
    headRow.appendChild(corner);
    thead.appendChild(headRow);
    tableEl.appendChild(thead);

    const tbody = document.createElement("tbody");
    table.rows.forEach((row, ri) => {
      const tr = document.createElement("tr");
      row.cells.forEach((cell, ci) => tr.appendChild(this.buildCell(cell, table, path, ri, ci)));
      const rowDel = document.createElement("td");
      rowDel.className = "nct-rowdel-col";
      const del = this.button("×", "nct-del", () => {
        const occupied = row.cells.some((c) => c.text.trim() !== "" || !!c.childTable);
        if (occupied && !window.confirm(`删除第 ${ri + 1} 行及其全部内容（含子表格），确定？`)) return;
        removeRow(table, row.id);
        this.render();
        this.scheduleSave();
      });
      del.disabled = table.rows.length <= 1;
      del.title = "删除此行";
      rowDel.appendChild(del);
      tr.appendChild(rowDel);
      tbody.appendChild(tr);
    });
    tableEl.appendChild(tbody);
    block.appendChild(tableEl);
    return block;
  }

  private buildCell(cell: Cell, table: Table, path: string[], ri: number, ci: number): HTMLElement {
    const td = document.createElement("td");
    td.className = "nct-cell-td";
    td.dataset.cellId = cell.id;
    td.style.background = bgTintCss(cell.style?.bg) ?? "";

    const text = document.createElement("div");
    text.className = "nct-cell";
    text.contentEditable = "plaintext-only";
    this.paintCell(text, cell);
    text.addEventListener("focus", () => {
      text.textContent = cell.text;
      text.style.color = textColorCss(cell.style?.color) ?? "";
    }, this.signal());
    text.addEventListener("blur", () => this.paintCell(text, cell), this.signal());
    text.addEventListener("input", () => {
      cell.text = text.textContent ?? "";
      this.scheduleSave();
    }, this.signal());
    text.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        text.blur();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        this.moveCellFocus(text, e.shiftKey ? -1 : 1);
      }
    }, this.signal());
    td.appendChild(text);

    const childArea = document.createElement("div");
    childArea.className = "nct-cell-child " + (cell.childTable ? "nct-has-child" : "nct-empty-child");
    if (cell.childTable) {
      const isCollapsed = this.collapsed.has(cell.id);
      const toggle = this.button(isCollapsed ? "▶ 展开子表" : "▼ 折叠子表", "nct-toggle" + (isCollapsed ? " is-collapsed" : ""), () => {
        if (this.collapsed.has(cell.id)) this.collapsed.delete(cell.id);
        else this.collapsed.add(cell.id);
        this.render();
      });
      childArea.appendChild(toggle);
      if (!isCollapsed) {
        childArea.appendChild(this.buildTable(cell.childTable, [...path, cell.id], true));
      }
    } else {
      childArea.appendChild(this.button("+ 子表", "nct-addchild", () => {
        cell.childTable = createTable(`子表格 ${ri + 1}-${ci + 1}`, 2, 1);
        this.render();
        this.scheduleSave();
      }));
    }
    td.appendChild(childArea);
    return td;
  }

  // 失焦态渲染 markdown；聚焦态在 focus 监听里换回源码
  private paintCell(el: HTMLElement, cell: Cell): void {
    el.replaceChildren(renderInlineMarkdown(cell.text));
    el.style.color = textColorCss(cell.style?.color) ?? "";
  }

  private moveCellFocus(current: HTMLElement, dir: number): void {
    const cells = Array.from(this.containerEl.querySelectorAll<HTMLElement>(".nct-cell"));
    const next = cells[cells.indexOf(current) + dir];
    next?.focus();
  }

  private editorFor(cell: Cell): HTMLElement | null {
    return this.containerEl.querySelector<HTMLElement>(`[data-cell-id="${cell.id}"] .nct-cell`);
  }

  private openCellMenu(cell: Cell, td: HTMLElement, e: MouseEvent): void {
    const menu = new Menu();
    menu.setUseNativeMenu(false);
    for (const { token, label } of MD_TOKENS) {
      menu.addItem((it) => it.setTitle(label).onClick(() => this.applyWrap(cell, token)));
    }
    menu.addSeparator();
    for (const c of TEXT_COLORS) {
      menu.addItem((it) =>
        it.setTitle(`文字颜色：${c.label}`).setChecked(cell.style?.color === c.token).onClick(() => this.applyStyle(cell, td, { color: c.token })),
      );
    }
    menu.addItem((it) => it.setTitle("文字颜色：默认").setChecked(!cell.style?.color).onClick(() => this.applyStyle(cell, td, { color: undefined })));
    menu.addSeparator();
    for (const b of BG_TINTS) {
      menu.addItem((it) =>
        it.setTitle(`底纹：${b.label}`).setChecked(cell.style?.bg === b.token).onClick(() => this.applyStyle(cell, td, { bg: b.token })),
      );
    }
    menu.addItem((it) => it.setTitle("底纹：无").setChecked(!cell.style?.bg).onClick(() => this.applyStyle(cell, td, { bg: undefined })));
    menu.addSeparator();
    menu.addItem((it) => it.setTitle("清除格式").onClick(() => this.applyStyle(cell, td, { color: undefined, bg: undefined })));
    menu.addItem((it) => it.setTitle("复制").onClick(() => void navigator.clipboard.writeText(cell.text)));
    menu.addItem((it) =>
      it.setTitle("粘贴").onClick(() => void navigator.clipboard.readText().then((t) => this.insertText(cell, t))),
    );
    menu.showAtMouseEvent(e);
  }

  private applyWrap(cell: Cell, token: string): void {
    const editor = this.editorFor(cell);
    if (!editor) return;
    if (document.activeElement !== editor) editor.focus();
    let start = cell.text.length;
    let end = start;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      const r = sel.getRangeAt(0);
      start = Math.min(r.startOffset, cell.text.length);
      end = Math.min(r.endOffset, cell.text.length);
    }
    const { text, caret } = wrapSelection(cell.text, start, end, token);
    cell.text = text;
    editor.textContent = text;
    const node = editor.firstChild;
    if (sel && node) {
      const r = document.createRange();
      r.setStart(node, Math.min(caret, text.length));
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    this.scheduleSave();
  }

  private insertText(cell: Cell, str: string): void {
    const editor = this.editorFor(cell);
    if (!editor) return;
    if (document.activeElement !== editor) editor.focus();
    const sel = window.getSelection();
    let at = cell.text.length;
    if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) at = Math.min(sel.getRangeAt(0).startOffset, cell.text.length);
    cell.text = cell.text.slice(0, at) + str + cell.text.slice(at);
    editor.textContent = cell.text;
    this.scheduleSave();
  }

  private applyStyle(cell: Cell, td: HTMLElement, patch: { color?: string; bg?: string }): void {
    const next = { ...cell.style, ...patch };
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined) delete next[k];
    if (Object.keys(next).length === 0) delete cell.style;
    else cell.style = next;
    td.style.background = bgTintCss(cell.style?.bg) ?? "";
    const editor = this.editorFor(cell);
    if (editor) editor.style.color = textColorCss(cell.style?.color) ?? "";
    this.scheduleSave();
  }

  private cellAtPath(path: string[]): Cell | null {
    if (!this.doc || path.length === 0) return null;
    let current: Table = this.doc;
    for (let i = 0; i < path.length; i++) {
      const cell = current.rows.flatMap((r) => r.cells).find((c) => c.id === path[i]);
      if (!cell) return null;
      if (i === path.length - 1) return cell;
      if (!cell.childTable) return null;
      current = cell.childTable;
    }
    return null;
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.containerEl.querySelector(".nct-hint")?.classList.add("is-faded");
    this.setStatus("编辑中…");
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.doSave();
    }, 600);
  }

  private async doSave(): Promise<void> {
    if (!this.store || !this.doc) return;
    this.setStatus("保存中…");
    const res = await this.store.save(this.doc);
    if (res.ok) {
      this.setStatus(`已保存 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`);
    } else {
      this.setStatus(res.error);
      if (this.store.conflict) this.renderConflict();
    }
  }

  private setStatus(text: string): void {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  private renderFatal(message: string): void {
    this.renderAbort?.abort();
    this.containerEl.empty();
    this.containerEl.addClass("nct-wrap");
    const box = document.createElement("div");
    box.className = "nct-error";
    box.textContent = `嵌套表格：${message}`;
    this.containerEl.appendChild(box);
  }

  private renderConflict(): void {
    if (this.containerEl.querySelector(".nct-conflict")) return;
    const banner = document.createElement("div");
    banner.className = "nct-conflict";
    const label = document.createElement("span");
    label.textContent = "数据文件已被外部修改，自动保存已停止。";
    const btn = document.createElement("button");
    btn.textContent = "重新载入（丢弃本地未保存修改）";
    btn.addEventListener("click", () => {
      if (!window.confirm("重新载入将丢弃本地未保存的修改，确定继续？")) return;
      void this.reload();
    }, this.signal());
    banner.appendChild(label);
    banner.appendChild(btn);
    this.containerEl.prepend(banner);
  }

  private async reload(): Promise<void> {
    if (!this.store) return;
    const res = await this.store.load();
    if (!res.ok) {
      this.renderFatal(res.error);
      return;
    }
    this.doc = res.doc;
    this.collapsed.clear();
    this.render();
  }
}