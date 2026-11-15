import { App, TFile } from "obsidian";
import { createDocument, createRow, newId, type Table } from "./core/model.ts";
import type NestedCanvasTablesPlugin from "./main.ts";

async function ensureFolder(app: App, path: string): Promise<void> {
  if (!app.vault.getAbstractFileByPath(path)) await app.vault.createFolder(path).catch(() => undefined);
}

export async function openDemo(app: App, rootDir: string): Promise<string> {
  const dataPath = `${rootDir}/data/示例.json`;
  const canvasPath = `${rootDir}/示例画布.canvas`;
  await ensureFolder(app, `${rootDir}/data`);
  if (!app.vault.getAbstractFileByPath(dataPath)) {
    const doc = createDocument("示例");
    doc.columns = ["病史", "症状", "体征", "检查"];
    doc.rows = doc.rows.map(() => createRow(4));
    doc.rows[0].cells[0].text = "**发热**三天";
    doc.rows[0].cells[1].text = "==咳嗽==";
    const child: Table = {
      id: newId("table"),
      title: "Killip 分级",
      columns: ["分级", "表现"],
      rows: [
        { id: newId("row"), cells: [{ id: newId("cell"), text: "I 级" }, { id: newId("cell"), text: "无啰音" }] },
        { id: newId("row"), cells: [{ id: newId("cell"), text: "II 级" }, { id: newId("cell"), text: "湿啰音" }] },
      ],
    };
    doc.rows[0].cells[3].childTable = child;
    await app.vault.create(dataPath, JSON.stringify(doc, null, 2) + "\n");
  }
  if (!app.vault.getAbstractFileByPath(canvasPath)) {
    const cardPath = `${rootDir}/cards/示例.md`;
    await ensureFolder(app, `${rootDir}/cards`);
    if (!app.vault.getAbstractFileByPath(cardPath)) {
      await app.vault.create(cardPath, "```nctable\n" + JSON.stringify({ data: dataPath }) + "\n```\n");
    }
    const canvas = { nodes: [{ id: newId("node"), type: "file", file: cardPath, x: 0, y: 0, width: 620, height: 460 }], edges: [] };
    await app.vault.create(canvasPath, JSON.stringify(canvas, null, 2) + "\n");
  }
  const file = app.vault.getAbstractFileByPath(canvasPath);
  if (file instanceof TFile) await app.workspace.getLeaf(true).openFile(file);
  return canvasPath;
}

interface Step {
  target: string;
  text: string;
}

const STEPS: Step[] = [
  { target: ".nct-ribbon", text: "左侧栏表格图标：一键新建（画布加节点 / 笔记光标处插入 / 新开卡片）。" },
  { target: ".canvas-node", text: "这是表格卡片：点击节点聚焦后即可编辑。" },
  { target: ".nct-cell", text: "点击单元格输入文字；编辑时显示 markdown 源码。" },
  { target: ".nct-cell", text: "右键格式菜单：先选中文字再改颜色，只染选中部分。" },
  { target: ".nct-cell", text: "输入 ==荧光== 或 **加粗**，失焦即渲染，可互相嵌套。" },
  { target: ".nct-col-resize", text: "拖表头右缘调列宽、行底缘调行高；双击恢复自适应。" },
  { target: ".nct-cell", text: "右键也管结构：添加子表、加删行列、折叠子表；图片拖右下角小方块调大小，双击还原。" },
  { target: ".nct-table-block", text: "控件浮在表格上方：悬停只显最内层 +行 / +列（子表另有折叠/删除），外层自动隐藏不叠加、永不裁切。" },
  { target: ".nct-status", text: "自动保存；数据被外部修改会停写并提示。" },
  { target: "", text: "完成！可随时用命令「使用引导」重看。" },
];

export function runTour(plugin: NestedCanvasTablesPlugin, onDone: (dontShowAgain: boolean) => void): void {
  let i = 0;
  let ring: HTMLElement | null = null;
  const overlay = document.createElement("div");
  overlay.className = "nct-tour";
  const card = document.createElement("div");
  card.className = "nct-tour-card";
  const label = document.createElement("div");
  label.className = "nct-tour-text";
  const btns = document.createElement("div");
  btns.className = "nct-tour-btns";
  const next = document.createElement("button");
  next.textContent = "下一步";
  const skip = document.createElement("button");
  skip.textContent = "跳过";
  const never = document.createElement("button");
  never.textContent = "不再显示";
  btns.append(next, skip, never);
  card.append(label, btns);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const clearRing = () => {
    ring?.remove();
    ring = null;
  };
  const show = () => {
    clearRing();
    const step = STEPS[i];
    label.textContent = `${i + 1}/${STEPS.length}　${step.text}`;
    next.textContent = i === STEPS.length - 1 ? "完成" : "下一步";
    if (step.target) {
      const el = document.querySelector(step.target);
      if (el) {
        const r = el.getBoundingClientRect();
        ring = document.createElement("div");
        ring.className = "nct-tour-ring";
        ring.style.left = `${r.left - 4}px`;
        ring.style.top = `${r.top - 4}px`;
        ring.style.width = `${r.width + 8}px`;
        ring.style.height = `${r.height + 8}px`;
        document.body.appendChild(ring);
      }
    }
  };
  const finish = (dontShowAgain: boolean) => {
    clearRing();
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    onDone(dontShowAgain);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      advance();
    } else if (e.key === "Escape") {
      finish(false);
    }
  };
  const advance = () => {
    if (i >= STEPS.length - 1) finish(false);
    else {
      i++;
      show();
    }
  };
  next.addEventListener("click", advance);
  skip.addEventListener("click", () => finish(false));
  never.addEventListener("click", () => finish(true));
  document.addEventListener("keydown", onKey);
  show();
}