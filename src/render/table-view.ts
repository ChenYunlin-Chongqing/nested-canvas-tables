import { App, MarkdownRenderChild, TFile } from "obsidian";
import type { Cell, TableDocument } from "../core/model.ts";
import { TableStore } from "../core/store.ts";

// 最小原型：平面表格编辑 + 自动保存，用于验证 Canvas 文件卡片内处理器与输入交互（规格第 4 条硬门槛）
export class NctableView extends MarkdownRenderChild {
  private store: TableStore | null = null;
  private doc: TableDocument | null = null;
  private saveTimer: number | null = null;
  private statusEl: HTMLElement | null = null;

  constructor(private app: App, private source: string, containerEl: HTMLElement) {
    super(containerEl);
  }

  onload(): void {
    // 只阻断冒泡、不 preventDefault：输入控件保持默认行为，Canvas 节点拖动留给标题区
    for (const type of ["pointerdown", "mousedown", "touchstart", "dblclick"] as const) {
      this.registerDomEvent(this.containerEl, type, (e) => e.stopPropagation());
    }
    void this.init();
  }

  onunload(): void {
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
    this.containerEl.empty();
    this.containerEl.addClass("nct-wrap");
    if (!this.doc) return;

    const table = document.createElement("table");
    table.className = "nct-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    this.doc.columns.forEach((_, i) => {
      const th = document.createElement("th");
      th.textContent = `列 ${i + 1}`;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of this.doc.rows) {
      const tr = document.createElement("tr");
      for (const cell of row.cells) {
        const td = document.createElement("td");
        td.className = "nct-cell";
        td.contentEditable = "plaintext-only";
        td.textContent = cell.text;
        this.registerDomEvent(td, "input", () => {
          cell.text = td.textContent ?? "";
          this.scheduleSave();
        });
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    this.containerEl.appendChild(table);

    this.statusEl = document.createElement("div");
    this.statusEl.className = "nct-status";
    this.statusEl.textContent = "已加载";
    this.containerEl.appendChild(this.statusEl);
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
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
    this.registerDomEvent(btn, "click", () => {
      if (!window.confirm("重新载入将丢弃本地未保存的修改，确定继续？")) return;
      void this.reload();
    });
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
    this.render();
  }
}