import { App, TFile, TFolder } from "obsidian";
import { createDocument, newId } from "./core/model.ts";

async function ensureFolder(app: App, path: string): Promise<void> {
  if (app.vault.getAbstractFileByPath(path) instanceof TFolder) return;
  await app.vault.createFolder(path);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

function uniquePath(app: App, path: string): string {
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

export async function createTableCard(app: App, rootDir: string): Promise<CardPaths> {
  const base = `表格-${stamp()}`;
  const dataPath = uniquePath(app, `${rootDir}/data/${base}.json`);
  const cardPath = uniquePath(app, `${rootDir}/cards/${base}.md`);
  await ensureFolder(app, `${rootDir}/data`);
  await ensureFolder(app, `${rootDir}/cards`);
  const doc = createDocument(base);
  await app.vault.create(dataPath, JSON.stringify(doc, null, 2) + "\n");
  const md = "```nctable\n" + JSON.stringify({ data: dataPath }) + "\n```\n";
  await app.vault.create(cardPath, md);
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