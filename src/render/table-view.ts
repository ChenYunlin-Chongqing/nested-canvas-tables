import { App, MarkdownRenderChild, Menu, Scope, TFile } from "obsidian";
import {
  addColumn,
  addRow,
  createTable,
  findCell,
  hasContent,
  removeColumn,
  removeRow,
  tableAtPath,
  type Cell,
  type Table,
  type TableDocument,
} from "../core/model.ts";
import {
  MD_TOKENS,
  TOOLBAR_FORMAT_COMMANDS,
  renderInlineMarkdown,
  stripColorSpans,
  toggleWrap,
  wrapSelectionColor,
} from "../core/markdown.ts";
import { BG_TINTS, TEXT_COLORS, bgTintCss, textColorCss } from "../core/style.ts";
import { TableStore } from "../core/store.ts";
import { ensureFolder, stamp, uniquePath } from "../commands.ts";

const TOKEN_ICONS: Record<string, string> = {
  "**": "bold",
  "*": "italic",
  "==": "highlighter",
  "~~": "strikethrough",
  "`": "code",
};

export class NctableView extends MarkdownRenderChild {
  private store: TableStore | null = null;
  private doc: TableDocument | null = null;
  private saveTimer: number | null = null;
  private statusEl: HTMLElement | null = null;
  private collapsed = new Set<string>();
  private renderAbort: AbortController | null = null;
  private tracked: { cell: Cell; start: number; end: number; at: number } | null = null;
  private formatScope: Scope | null = null;
  private scopePushed = false;

  constructor(private app: App, private source: string, containerEl: HTMLElement, private sourcePath = "") {
    super(containerEl);
  }

  onload(): void {
    // 只阻断冒泡、不 preventDefault：输入控件保持默认行为，Canvas 节点拖动留给标题区。
    // click/keydown 一并阻断：Canvas 靠 click 进入节点编辑态（会折叠预览），CodeMirror 靠 keydown 改源码。
    for (const type of ["pointerdown", "mousedown", "touchstart", "dblclick", "click", "keydown"] as const) {
      this.registerDomEvent(this.containerEl, type, (e) => e.stopPropagation());
    }
    // 工具栏按钮点击会夺焦：持续记录单元格选区的源码偏移，供 Editing Toolbar 接管时使用
    this.registerDomEvent(document, "selectionchange", () => this.trackSelection());
    // Obsidian 全局快捷键在 window capture 层拦截 Mod+B/I，格内 keydown 收不到；
    // 用 Scope 栈在单元格聚焦期间置顶接管，失焦即弹出，笔记/编辑器场景不受影响。
    this.formatScope = new Scope();
    this.formatScope.register(["Mod"], "b", () => this.wrapFocusedCell("**"));
    this.formatScope.register(["Mod"], "i", () => this.wrapFocusedCell("*"));
    this.register(() => this.popFormatScope());
    this.registerDomEvent(this.containerEl, "contextmenu", (e) => {
      if (!this.doc) return;
      const target = e.target as HTMLElement;
      if (target.closest("button")) return;
      const colhead = target.closest(".nct-colhead") as HTMLElement | null;
      if (colhead) {
        const block = colhead.closest(".nct-table-block") as HTMLElement | null;
        const table = block ? tableAtPath(this.doc, JSON.parse(block.dataset.path ?? "[]") as string[]) : null;
        const index = Number(colhead.dataset.col);
        if (!table || !Number.isInteger(index) || index < 0 || index >= table.columns.length) return;
        e.preventDefault();
        e.stopPropagation();
        this.openHeaderMenu(table, index, colhead, e);
        return;
      }
      const td = target.closest(".nct-cell-td") as HTMLElement | null;
      if (!td) return;
      // 右键落在嵌套子表的表头/工具栏等 chrome 上时，closest 会穿透到祖先 td；须限定在本表块内
      if (target.closest(".nct-table-block") !== td.closest(".nct-table-block")) return;
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

  private pluginSettings(): { rootDir?: string; showHints?: boolean } {
    return (
      (this.app as unknown as { plugins?: { plugins?: Record<string, { settings?: { rootDir?: string; showHints?: boolean } }> } })
        .plugins?.plugins?.["nested-canvas-tables"]?.settings ?? {}
    );
  }

  private render(): void {
    this.renderAbort?.abort();
    this.renderAbort = new AbortController();
    this.popFormatScope();
    this.containerEl.empty();
    this.containerEl.addClass("nct-wrap");
    if (!this.doc) return;
    this.containerEl.appendChild(this.buildTable(this.doc, [], false));
    this.statusEl = document.createElement("div");
    this.statusEl.className = "nct-status";
    this.statusEl.textContent = "已加载";
    this.containerEl.appendChild(this.statusEl);
    if (this.pluginSettings().showHints) {
      const hint = document.createElement("div");
      hint.className = "nct-hint";
      hint.textContent = "悬停浮现操作 · 右键格式（选中文字单独变色）· ==荧光== **加粗** 失焦渲染 · 拖边线调行高列宽 · 粘贴/拖入图片 · 左侧栏一键新建";
      this.containerEl.appendChild(hint);
      const timer = window.setTimeout(() => hint.classList.add("is-faded"), 8000);
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
    block.dataset.path = JSON.stringify(path);

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

    const scroll = document.createElement("div");
    scroll.className = "nct-table-scroll";
    const tableEl = document.createElement("table");
    tableEl.className = "nct-table" + (this.doc?.fitWidth ? " nct-fit" : "");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    table.columns.forEach((header, i) => {
      const th = document.createElement("th");
      const head = document.createElement("span");
      head.className = "nct-colhead";
      head.contentEditable = "plaintext-only";
      head.textContent = header;
      head.dataset.col = String(i);
      const headStyle = table.columnStyles?.[i];
      th.style.background = bgTintCss(headStyle?.bg) ?? "";
      th.style.color = textColorCss(headStyle?.color) ?? "";
      head.addEventListener("input", () => {
        table.columns[i] = head.textContent ?? "";
        this.scheduleSave();
      }, this.signal());
      th.appendChild(head);
      const del = this.button("×", "nct-del nct-col-del", () => {
        const occupied = table.rows.some((r) => { const c = r.cells[i]; return c.text.trim() !== "" || !!c.childTable; });
        if (occupied && !window.confirm(`删除「${table.columns[i] || `列 ${i + 1}`}」将同时删除该列所有单元格内容（含子表格），确定？`)) return;
        removeColumn(table, i);
        this.render();
        this.scheduleSave();
      });
      del.disabled = table.columns.length <= 1;
      del.title = "删除此列";
      th.appendChild(del);
      const grip = document.createElement("div");
      grip.className = "nct-col-resize";
      grip.title = "拖动调整列宽，双击恢复自适应";
      this.attachColResize(grip, table, i, tableEl, headRow);
      th.appendChild(grip);
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    tableEl.appendChild(thead);

    const tbody = document.createElement("tbody");
    table.rows.forEach((row, ri) => {
      const tr = document.createElement("tr");
      row.cells.forEach((cell, ci) => tr.appendChild(this.buildCell(cell, table, path, ri, ci, tbody)));
      tbody.appendChild(tr);
    });
    tableEl.appendChild(tbody);
    this.applyColumnWidths(table, tableEl, headRow);
    this.applyRowHeights(table, tbody);
    scroll.appendChild(tableEl);
    block.appendChild(scroll);
    return block;
  }

  private applyColumnWidths(table: Table, tableEl: HTMLTableElement, headRow: HTMLTableRowElement): void {
    const ths = Array.from(headRow.querySelectorAll<HTMLElement>("th"));
    const widths = table.columnWidths;
    // 适应模式：撑满容器，已拖拽列宽保留为 px  hint，其余列均分剩余宽度；外框拉大实时跟随
    if (this.doc?.fitWidth) {
      tableEl.style.tableLayout = "fixed";
      tableEl.style.width = "100%";
      ths.forEach((th, i) => {
        th.style.width = widths?.[i] != null ? `${widths[i]}px` : "";
      });
      return;
    }
    if (!widths || widths.every((w) => w === null)) {
      tableEl.style.tableLayout = "";
      tableEl.style.width = "";
      for (const th of ths) th.style.width = "";
      return;
    }
    if (widths.every((w) => w !== null)) {
      tableEl.style.tableLayout = "fixed";
      let sum = 0;
      ths.forEach((th, i) => {
        const w = widths[i]!;
        sum += w;
        th.style.width = `${w}px`;
      });
      tableEl.style.width = `${sum}px`;
      return;
    }
    // 混合态：auto 布局，已拖拽列宽作提示，重置列随内容自适应
    tableEl.style.tableLayout = "";
    tableEl.style.width = "";
    ths.forEach((th, i) => {
      th.style.width = widths[i] !== null ? `${widths[i]}px` : "";
    });
  }

  private applyRowHeights(table: Table, tbody: HTMLTableSectionElement): void {
    const trs = Array.from(tbody.querySelectorAll<HTMLElement>(":scope > tr"));
    trs.forEach((tr, i) => {
      const h = table.rowHeights?.[i] ?? null;
      tr.querySelectorAll<HTMLElement>(".nct-cell-box").forEach((box) => {
        if (h !== null) {
          box.style.height = `${h}px`;
          box.style.overflowY = "auto";
        } else {
          box.style.height = "";
          box.style.overflowY = "";
        }
      });
    });
  }

  private attachColResize(grip: HTMLElement, table: Table, index: number, tableEl: HTMLTableElement, headRow: HTMLTableRowElement): void {
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ths = Array.from(headRow.querySelectorAll<HTMLElement>("th"));
      const widths = ths.map((th) => th.offsetWidth);
      table.columnWidths = widths;
      const startX = e.clientX;
      const startW = widths[index];
      grip.setPointerCapture(e.pointerId);
      grip.classList.add("is-active");
      document.body.classList.add("nct-resizing-col");
      const move = (ev: PointerEvent) => {
        table.columnWidths![index] = Math.max(48, Math.min(1600, startW + ev.clientX - startX));
        this.applyColumnWidths(table, tableEl, headRow);
      };
      const up = () => {
        grip.classList.remove("is-active");
        document.body.classList.remove("nct-resizing-col");
        grip.removeEventListener("pointermove", move);
        this.scheduleSave();
      };
      grip.addEventListener("pointermove", move, this.signal());
      grip.addEventListener("pointerup", up, { once: true });
      grip.addEventListener("pointercancel", up, { once: true });
    }, this.signal());
    grip.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      if (table.columnWidths) {
        table.columnWidths[index] = null;
        if (table.columnWidths.every((w) => w === null)) delete table.columnWidths;
      }
      this.applyColumnWidths(table, tableEl, headRow);
      this.scheduleSave();
    }, this.signal());
  }

  private attachRowResize(grip: HTMLElement, table: Table, index: number, tbody: HTMLTableSectionElement): void {
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const trs = Array.from(tbody.querySelectorAll<HTMLElement>(":scope > tr"));
      const heights = trs.map((tr) => tr.offsetHeight);
      table.rowHeights = heights;
      const startY = e.clientY;
      const startH = heights[index];
      grip.setPointerCapture(e.pointerId);
      grip.classList.add("is-active");
      document.body.classList.add("nct-resizing-row");
      const move = (ev: PointerEvent) => {
        table.rowHeights![index] = Math.max(28, Math.min(2000, startH + ev.clientY - startY));
        this.applyRowHeights(table, tbody);
      };
      const up = () => {
        grip.classList.remove("is-active");
        document.body.classList.remove("nct-resizing-row");
        grip.removeEventListener("pointermove", move);
        this.scheduleSave();
      };
      grip.addEventListener("pointermove", move, this.signal());
      grip.addEventListener("pointerup", up, { once: true });
      grip.addEventListener("pointercancel", up, { once: true });
    }, this.signal());
    grip.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      if (table.rowHeights) {
        table.rowHeights[index] = null;
        if (table.rowHeights.every((h) => h === null)) delete table.rowHeights;
      }
      this.applyRowHeights(table, tbody);
      this.scheduleSave();
    }, this.signal());
  }

  private buildCell(cell: Cell, table: Table, path: string[], ri: number, ci: number, tbody: HTMLTableSectionElement): HTMLElement {
    const td = document.createElement("td");
    td.className = "nct-cell-td";
    td.dataset.cellId = cell.id;
    td.style.background = bgTintCss(cell.style?.bg) ?? "";

    const box = document.createElement("div");
    box.className = "nct-cell-box";
    const text = document.createElement("div");
    text.className = "nct-cell";
    text.contentEditable = "plaintext-only";
    this.paintCell(text, cell);
    text.addEventListener("focus", () => {
      if (!this.scopePushed && this.formatScope) {
        this.app.keymap.pushScope(this.formatScope);
        this.scopePushed = true;
      }
      // 渲染态拖选会触发 focus：换源码前记住选中的可见文字，换后恢复选区，保证「选哪染哪」
      const sel = window.getSelection();
      let restore: { start: number; end: number } | null = null;
      if (sel && sel.rangeCount > 0 && text.contains(sel.anchorNode)) {
        const t = sel.toString();
        if (t) {
          const i = cell.text.indexOf(t);
          if (i >= 0) restore = { start: i, end: i + t.length };
        }
      }
      text.textContent = cell.text;
      text.style.color = textColorCss(cell.style?.color) ?? "";
      if (restore && sel) {
        const node = text.firstChild;
        if (node) {
          const r = document.createRange();
          r.setStart(node, restore.start);
          r.setEnd(node, restore.end);
          sel.removeAllRanges();
          sel.addRange(r);
        }
      }
    }, this.signal());
    text.addEventListener("blur", () => {
      this.popFormatScope();
      this.paintCell(text, cell);
    }, this.signal());
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
        return;
      }
    }, this.signal());
    text.addEventListener("paste", (e) => {
      const img = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (img) {
        e.preventDefault();
        e.stopPropagation();
        void this.saveAndInsertImage(cell, img);
      }
    }, this.signal());
    box.appendChild(text);

    const childArea = document.createElement("div");
    childArea.className = "nct-cell-child" + (cell.childTable ? " nct-has-child" : "");
    if (cell.childTable) {
      const isCollapsed = this.collapsed.has(cell.id);
      if (isCollapsed) {
        td.classList.add("nct-collapsed");
        const chip = this.button("▶子表", "nct-child-chip is-collapsed", () => {
          this.collapsed.delete(cell.id);
          this.render();
        });
        chip.title = "展开子表";
        td.appendChild(chip);
      } else {
        const toggle = this.button("▼ 折叠", "nct-toggle", () => {
          this.collapsed.add(cell.id);
          this.render();
        });
        toggle.title = "折叠子表";
        childArea.appendChild(toggle);
        childArea.appendChild(this.buildTable(cell.childTable, [...path, cell.id], true));
      }
    } else {
      const chip = this.button("+子表", "nct-child-chip", () => {
        cell.childTable = createTable(`子表格 ${ri + 1}-${ci + 1}`, 2, 1);
        this.render();
        this.scheduleSave();
      });
      chip.title = "在此格嵌套子表格";
      td.appendChild(chip);
    }
    box.appendChild(childArea);
    td.appendChild(box);

    const grip = document.createElement("div");
    grip.className = "nct-row-resize";
    grip.title = "拖动调整行高，双击恢复自适应";
    this.attachRowResize(grip, table, ri, tbody);
    td.appendChild(grip);

    const rowDel = this.button("×", "nct-del nct-row-del", () => {
      const row = table.rows[ri];
      const occupied = row.cells.some((c) => c.text.trim() !== "" || !!c.childTable);
      if (occupied && !window.confirm(`删除第 ${ri + 1} 行及其全部内容（含子表格），确定？`)) return;
      removeRow(table, row.id);
      this.render();
      this.scheduleSave();
    });
    rowDel.disabled = table.rows.length <= 1;
    rowDel.title = "删除此行";
    td.appendChild(rowDel);

    td.addEventListener("dragover", (e) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, this.signal());
    td.addEventListener("drop", (e) => {
      const img = Array.from(e.dataTransfer?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (img) {
        e.preventDefault();
        e.stopPropagation();
        void this.saveAndInsertImage(cell, img);
      }
    }, this.signal());
    return td;
  }

  // 失焦态渲染 markdown；聚焦态在 focus 监听里换回源码
  private paintCell(el: HTMLElement, cell: Cell): void {
    el.replaceChildren(renderInlineMarkdown(cell.text, { resolveImage: this.resolveImage }));
    el.style.color = textColorCss(cell.style?.color) ?? "";
  }

  private resolveImage = (src: string): string | null => {
    const file = this.app.metadataCache.getFirstLinkpathDest(src, this.sourcePath);
    if (file && /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(file.path)) return this.app.vault.getResourcePath(file);
    return null;
  };

  private moveCellFocus(current: HTMLElement, dir: number): void {
    const cells = Array.from(this.containerEl.querySelectorAll<HTMLElement>(".nct-cell"));
    const next = cells[cells.indexOf(current) + dir];
    next?.focus();
  }

  private editorFor(cell: Cell): HTMLElement | null {
    return this.containerEl.querySelector<HTMLElement>(`[data-cell-id="${cell.id}"] .nct-cell`);
  }

  private openCellMenu(cell: Cell, td: HTMLElement, e: MouseEvent): void {
    // 菜单项的真实点击会夺焦并折叠选区：选区偏移必须在开菜单这一刻捕获
    const editor = this.editorFor(cell);
    const captured = editor ? this.renderedSelectionRange(cell, editor) : null;
    const menu = new Menu();
    menu.setUseNativeMenu(false);
    for (const { token, label } of MD_TOKENS) {
      menu.addItem((it) => it.setTitle(label).setIcon(TOKEN_ICONS[token]).onClick(() => this.applyWrap(cell, token, captured)));
    }
    menu.addSeparator();
    for (const c of TEXT_COLORS) {
      menu.addItem((it) => it.setTitle(`文字颜色：${c.label}（选中文字）`).onClick(() => this.applyColor(cell, td, c.css, captured)));
    }
    menu.addItem((it) => it.setTitle("文字颜色：默认").onClick(() => this.applyColor(cell, td, null, captured)));
    menu.addSeparator();
    for (const b of BG_TINTS) {
      menu.addItem((it) => it.setTitle(`底纹：${b.label}`).setChecked(cell.style?.bg === b.token).onClick(() => this.applyStyle(cell, td, { bg: b.token })));
    }
    menu.addItem((it) => it.setTitle("底纹：无").setChecked(!cell.style?.bg).onClick(() => this.applyStyle(cell, td, { bg: undefined })));
    menu.addSeparator();
    menu.addItem((it) => it.setTitle("插入图片…").setIcon("image").onClick(() => this.pickImage(cell)));
    menu.addItem((it) => it.setTitle("清除格式").setIcon("eraser").onClick(() => this.clearCellFormat(cell, td)));
    menu.addItem((it) => it.setTitle("复制").setIcon("copy").onClick(() => void navigator.clipboard.writeText(cell.text)));
    menu.addItem((it) =>
      it.setTitle("粘贴").setIcon("clipboard-paste").onClick(() => void navigator.clipboard.readText().then((t) => this.insertText(cell, t))),
    );
    menu.addSeparator();
    menu.addItem((it) =>
      it.setTitle("适应容器宽度").setIcon("stretch-horizontal").setChecked(!!this.doc?.fitWidth).onClick(() => this.toggleFitWidth()),
    );
    menu.showAtMouseEvent(e);
  }

  // 表头不渲染 markdown，故菜单只含颜色/底纹/清除/复制/粘贴
  private openHeaderMenu(table: Table, index: number, colhead: HTMLElement, e: MouseEvent): void {
    const th = colhead.closest("th") as HTMLElement | null;
    const style = table.columnStyles?.[index];
    const menu = new Menu();
    menu.setUseNativeMenu(false);
    for (const c of TEXT_COLORS) {
      menu.addItem((it) =>
        it.setTitle(`文字颜色：${c.label}`).setChecked(style?.color === c.token).onClick(() => this.applyHeaderStyle(table, index, th, { color: c.token })),
      );
    }
    menu.addItem((it) => it.setTitle("文字颜色：默认").setChecked(!style?.color).onClick(() => this.applyHeaderStyle(table, index, th, { color: undefined })));
    menu.addSeparator();
    for (const b of BG_TINTS) {
      menu.addItem((it) =>
        it.setTitle(`底纹：${b.label}`).setChecked(style?.bg === b.token).onClick(() => this.applyHeaderStyle(table, index, th, { bg: b.token })),
      );
    }
    menu.addItem((it) => it.setTitle("底纹：无").setChecked(!style?.bg).onClick(() => this.applyHeaderStyle(table, index, th, { bg: undefined })));
    menu.addSeparator();
    menu.addItem((it) => it.setTitle("清除格式").setIcon("eraser").onClick(() => this.applyHeaderStyle(table, index, th, { color: undefined, bg: undefined })));
    menu.addItem((it) => it.setTitle("复制").setIcon("copy").onClick(() => void navigator.clipboard.writeText(table.columns[index])));
    menu.addItem((it) =>
      it.setTitle("粘贴").setIcon("clipboard-paste").onClick(() => void navigator.clipboard.readText().then((t) => this.insertHeaderText(table, index, colhead, t))),
    );
    menu.addSeparator();
    menu.addItem((it) =>
      it.setTitle("适应容器宽度").setIcon("stretch-horizontal").setChecked(!!this.doc?.fitWidth).onClick(() => this.toggleFitWidth()),
    );
    menu.showAtMouseEvent(e);
  }

  // 文档级开关：根表与全部嵌套子表一起适应各自容器，再点一次回到随内容收缩
  private toggleFitWidth(): void {
    if (!this.doc) return;
    if (this.doc.fitWidth) delete this.doc.fitWidth;
    else this.doc.fitWidth = true;
    this.render();
    this.scheduleSave();
  }

  private applyHeaderStyle(table: Table, index: number, th: HTMLElement | null, patch: { color?: string; bg?: string }): void {
    const styles = table.columnStyles ?? (table.columnStyles = table.columns.map(() => null));
    const next = { ...styles[index], ...patch };
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined) delete next[k];
    styles[index] = Object.keys(next).length === 0 ? null : next;
    if (styles.every((s) => s === null)) delete table.columnStyles;
    if (th) {
      th.style.background = bgTintCss(styles[index]?.bg) ?? "";
      th.style.color = textColorCss(styles[index]?.color) ?? "";
    }
    this.scheduleSave();
  }

  private insertHeaderText(table: Table, index: number, colhead: HTMLElement, str: string): void {
    if (document.activeElement !== colhead) colhead.focus();
    const sel = window.getSelection();
    const source = table.columns[index];
    let at = source.length;
    if (sel && sel.rangeCount > 0 && colhead.contains(sel.anchorNode)) at = Math.min(sel.getRangeAt(0).startOffset, source.length);
    table.columns[index] = source.slice(0, at) + str + source.slice(at);
    colhead.textContent = table.columns[index];
    this.scheduleSave();
  }

  // 聚焦态用源码偏移；失焦渲染态把选中的可见文字映射回源码子串
  private renderedSelectionRange(cell: Cell, container: HTMLElement): { start: number; end: number } | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !container.contains(sel.anchorNode)) return null;
    const editor = this.editorFor(cell);
    if (editor && document.activeElement === editor) {
      const r = sel.getRangeAt(0);
      const a = this.sourceOffset(editor, r.startContainer, r.startOffset);
      const b = this.sourceOffset(editor, r.endContainer, r.endOffset);
      return { start: Math.min(a, b), end: Math.max(a, b) };
    }
    const t = sel.toString();
    if (!t) return null;
    const i = cell.text.indexOf(t);
    return i >= 0 ? { start: i, end: i + t.length } : null;
  }

  // DOM Range 偏移 → 源码字符偏移（container 可能是编辑器 div 本身，此时 offset 是子节点索引）
  private sourceOffset(editor: HTMLElement, node: Node, offset: number): number {
    if (node === editor) {
      let s = 0;
      const kids = editor.childNodes;
      for (let i = 0; i < offset && i < kids.length; i++) s += (kids[i].textContent ?? "").length;
      return Math.min(s, editor.textContent?.length ?? 0);
    }
    let s = 0;
    for (const kid of Array.from(editor.childNodes)) {
      if (kid === node || kid.contains(node)) return Math.min(s + offset, editor.textContent?.length ?? 0);
      s += (kid.textContent ?? "").length;
    }
    return Math.min(offset, editor.textContent?.length ?? 0);
  }

  private trackSelection(): void {
    const ae = document.activeElement;
    if (!(ae instanceof HTMLElement)) return;
    // 其他编辑面（CodeMirror/输入框/别的 contenteditable）获焦即失效，避免工具栏误打旧单元格
    if (!ae.classList.contains("nct-cell") && ae.closest(".cm-editor, textarea, input, select, [contenteditable]")) {
      this.tracked = null;
      return;
    }
    if (!this.doc || !ae.classList.contains("nct-cell") || !this.containerEl.contains(ae)) return;
    const td = ae.closest(".nct-cell-td") as HTMLElement | null;
    const cell = td ? findCell(this.doc, td.dataset.cellId ?? "") : null;
    if (!cell) return;
    const sel = window.getSelection();
    let start = cell.text.length;
    let end = start;
    if (sel && sel.rangeCount > 0 && ae.contains(sel.anchorNode)) {
      const r = sel.getRangeAt(0);
      start = this.sourceOffset(ae, r.startContainer, r.startOffset);
      end = this.sourceOffset(ae, r.endContainer, r.endOffset);
    }
    this.tracked = { cell, start: Math.min(start, end), end: Math.max(start, end), at: Date.now() };
  }

  get trackedAt(): number {
    return this.tracked?.at ?? 0;
  }

  // Editing Toolbar 格式命令接管：单元格是活跃编辑面时作用于单元格源码，否则交还原命令
  tryFormatCommand(id: string): boolean {
    const token = TOOLBAR_FORMAT_COMMANDS[id];
    if (token === undefined || !this.doc || !this.tracked) return false;
    const cell = findCell(this.doc, this.tracked.cell.id);
    const editor = cell ? this.editorFor(cell) : null;
    if (!cell || !editor || !editor.isConnected) return false;
    const ae = document.activeElement as HTMLElement | null;
    if (ae !== editor) {
      if (ae?.closest(".cm-editor, .markdown-source-view, textarea, input, select, [contenteditable]")) return false;
      // 焦点在工具栏等 chrome 上时，仅当本表属于当前活跃视图才接管（打开笔记后不抢笔记的命令）
      const viewEl = (this.app.workspace.activeLeaf?.view as { containerEl?: HTMLElement } | undefined)?.containerEl;
      if (!viewEl || !viewEl.contains(this.containerEl)) return false;
    }
    if (id === "editing-toolbar:format-eraser") {
      this.clearCellFormat(cell, editor.closest(".nct-cell-td") as HTMLElement);
      editor.focus();
      return true;
    }
    const { start, end } = this.tracked;
    const res = toggleWrap(cell.text, Math.min(start, cell.text.length), Math.min(end, cell.text.length), token);
    cell.text = res.text;
    editor.focus();
    editor.textContent = res.text;
    this.selectRange(editor, res.selStart, res.selEnd);
    this.scheduleSave();
    return true;
  }

  private applyWrap(cell: Cell, token: string, range?: { start: number; end: number } | null): void {
    const editor = this.editorFor(cell);
    if (!editor) return;
    const mapped = range === undefined ? this.renderedSelectionRange(cell, editor) : range;
    const start = mapped ? Math.min(mapped.start, cell.text.length) : cell.text.length;
    const end = mapped ? Math.min(mapped.end, cell.text.length) : start;
    const res = toggleWrap(cell.text, start, end, token);
    cell.text = res.text;
    if (document.activeElement !== editor) editor.focus();
    editor.textContent = res.text;
    this.selectRange(editor, res.selStart, res.selEnd);
    this.scheduleSave();
  }

  private popFormatScope(): void {
    if (this.scopePushed && this.formatScope) {
      this.app.keymap.popScope(this.formatScope);
      this.scopePushed = false;
    }
  }

  // Scope 回调：返回 false 表示已消费快捷键；焦点不在本格容器内时放行给默认命令
  private wrapFocusedCell(token: string): boolean {
    const ae = document.activeElement;
    if (!this.doc || !(ae instanceof HTMLElement) || !ae.classList.contains("nct-cell") || !this.containerEl.contains(ae)) return true;
    const td = ae.closest(".nct-cell-td") as HTMLElement | null;
    const cell = td ? findCell(this.doc, td.dataset.cellId ?? "") : null;
    if (!cell) return true;
    this.applyWrap(cell, token, this.renderedSelectionRange(cell, ae));
    return false;
  }

  private selectRange(editor: HTMLElement, start: number, end: number): void {
    const sel = window.getSelection();
    const node = editor.firstChild;
    if (!sel || !node) return;
    const len = (node.textContent ?? "").length;
    const r = document.createRange();
    r.setStart(node, Math.min(start, len));
    r.setEnd(node, Math.min(end, len));
    sel.removeAllRanges();
    sel.addRange(r);
  }

  // 颜色只作用于选区文字；无选区时作用于整格文字（inline span，而非整格 style）
  private applyColor(cell: Cell, td: HTMLElement, css: string | null, range?: { start: number; end: number } | null): void {
    const editor = this.editorFor(cell);
    if (css === null) {
      cell.text = stripColorSpans(cell.text);
      if (cell.style) {
        delete cell.style.color;
        if (Object.keys(cell.style).length === 0) delete cell.style;
      }
      if (editor && document.activeElement === editor) editor.textContent = cell.text;
    } else {
      const mapped = range === undefined ? (editor ? this.renderedSelectionRange(cell, editor) : null) : range;
      const r = mapped ?? { start: 0, end: cell.text.length };
      const { text, caret } = wrapSelectionColor(cell.text, r.start, r.end, css);
      cell.text = text;
      if (editor && document.activeElement === editor) {
        editor.textContent = text;
        this.restoreCaret(editor, caret);
      }
    }
    if (editor && document.activeElement !== editor) this.paintCell(editor, cell);
    td.style.background = bgTintCss(cell.style?.bg) ?? "";
    this.scheduleSave();
  }

  private clearCellFormat(cell: Cell, td: HTMLElement): void {
    cell.text = stripColorSpans(cell.text);
    delete cell.style;
    const editor = this.editorFor(cell);
    if (editor) {
      if (document.activeElement === editor) editor.textContent = cell.text;
      else this.paintCell(editor, cell);
    }
    td.style.background = "";
    this.scheduleSave();
  }

  private restoreCaret(editor: HTMLElement, caret: number): void {
    const sel = window.getSelection();
    const node = editor.firstChild;
    if (sel && node) {
      const r = document.createRange();
      r.setStart(node, Math.min(caret, (node.textContent ?? "").length));
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
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
    // 画布未进入编辑态时 focus 会被焦点代理夺走：落不到焦点就直接渲染，避免源码裸露
    if (document.activeElement !== editor) this.paintCell(editor, cell);
    this.scheduleSave();
  }

  private pickImage(cell: Cell): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void this.saveAndInsertImage(cell, file);
    });
    input.click();
  }

  private async saveAndInsertImage(cell: Cell, file: File): Promise<void> {
    try {
      const rootDir = this.pluginSettings().rootDir ?? "NestedTables";
      const dir = `${rootDir}/attachments`;
      await ensureFolder(this.app, dir);
      const safe = file.name.replace(/[\\/:*?"<>|\s]+/g, "_") || "image.png";
      const path = uniquePath(this.app, `${dir}/${stamp()}-${safe}`);
      await this.app.vault.createBinary(path, await file.arrayBuffer());
      this.insertText(cell, `![[${path}]]`);
      this.setStatus(`已插入图片：${path}`);
    } catch (e) {
      this.setStatus(`图片插入失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private applyStyle(cell: Cell, td: HTMLElement, patch: { bg?: string }): void {
    const next = { ...cell.style, ...patch };
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined) delete next[k];
    if (Object.keys(next).length === 0) delete cell.style;
    else cell.style = next;
    td.style.background = bgTintCss(cell.style?.bg) ?? "";
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