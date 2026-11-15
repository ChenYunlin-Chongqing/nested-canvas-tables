import { App, MarkdownView, TFile, TFolder } from "obsidian";
import { createDocument, newId } from "./core/model.ts";

export async function ensureFolder(app: App, path: string): Promise<void> {
  if (app.vault.getAbstractFileByPath(path) instanceof TFolder) return;
  await app.vault.createFolder(path);
}

export function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

export function uniquePath(app: App, path: string): string {
  if (!app.vault.getAbstractFileByPath(path)) return path;
  const dot = path.lastIndexOf(".");
  const base = path.slice(0, dot);
  const ext = path.slice(dot);
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}${ext}`;
    if (!app.vault.getAbstractFileByPath(candidate)) return candidate;
  }
}

export interface CardPaths {
  cardPath: string;
  dataPath: string;
}

export function nctableBlock(dataPath: string): string {
  return "```nctable\n" + JSON.stringify({ data: dataPath }) + "\n```\n";
}

export async function createTableData(app: App, rootDir: string): Promise<string> {
  const base = `表格-${stamp()}`;
  const dataPath = uniquePath(app, `${rootDir}/data/${base}.json`);
  await ensureFolder(app, `${rootDir}/data`);
  const doc = createDocument(base);
  await app.vault.create(dataPath, JSON.stringify(doc, null, 2) + "\n");
  return dataPath;
}

export async function createTableCard(app: App, rootDir: string): Promise<CardPaths> {
  const dataPath = await createTableData(app, rootDir);
  const base = dataPath.slice(dataPath.lastIndexOf("/") + 1, -".json".length);
  const cardPath = uniquePath(app, `${rootDir}/cards/${base}.md`);
  await ensureFolder(app, `${rootDir}/cards`);
  await app.vault.create(cardPath, nctableBlock(dataPath));
  return { cardPath, dataPath };
}

export async function createCanvasWithTable(app: App, rootDir: string): Promise<string> {
  const { cardPath } = await createTableCard(app, rootDir);
  const canvasPath = uniquePath(app, `${rootDir}/画布-${stamp()}.canvas`);
  const canvas = {
    nodes: [{ id: newId("node"), type: "file", file: cardPath, x: 0, y: 0, width: 560, height: 400 }],
    edges: [],
  };
  await app.vault.create(canvasPath, JSON.stringify(canvas, null, 2) + "\n");
  const file = app.vault.getAbstractFileByPath(canvasPath);
  if (file instanceof TFile) await app.workspace.getLeaf(true).openFile(file);
  return canvasPath;
}

interface CanvasNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 一键新建：画布内→追加节点；markdown 编辑器→光标处插入代码块；其余→新建卡片并打开
export async function quickCreateTable(app: App, rootDir: string): Promise<string> {
  const active = app.workspace.activeLeaf?.view as { getViewType?: () => string; file?: TFile } | null;
  if (active?.getViewType?.() === "canvas" && active.file instanceof TFile) {
    const { cardPath } = await createTableCard(app, rootDir);
    await app.vault.process(active.file, (raw) => {
      const data = JSON.parse(raw) as { nodes?: CanvasNode[] };
      const nodes = Array.isArray(data.nodes) ? data.nodes : [];
      const x = nodes.length ? Math.max(...nodes.map((n) => n.x + n.width)) + 60 : 0;
      const node = { id: newId("node"), type: "file", file: cardPath, x, y: 0, width: 560, height: 420 };
      return JSON.stringify({ ...data, nodes: [...nodes, node] }, null, 2) + "\n";
    });
    return `已在当前画布右侧添加表格节点：${cardPath}`;
  }
  const mdView = app.workspace.getActiveViewOfType(MarkdownView);
  if (mdView?.editor) {
    const dataPath = await createTableData(app, rootDir);
    mdView.editor.replaceSelection(nctableBlock(dataPath));
    return "已在光标处插入嵌套表格";
  }
  const { cardPath } = await createTableCard(app, rootDir);
  const file = app.vault.getAbstractFileByPath(cardPath);
  if (file instanceof TFile) await app.workspace.getLeaf(false).openFile(file);
  return `已新建并打开表格卡片：${cardPath}`;
}