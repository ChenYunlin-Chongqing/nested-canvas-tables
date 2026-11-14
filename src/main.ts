import { Notice, Plugin } from "obsidian";
import { createCanvasWithTable, createTableCard } from "./commands.ts";
import { NctableView } from "./render/table-view.ts";
import { DEFAULT_SETTINGS, NctSettings, NctSettingTab } from "./settings.ts";

export default class NestedCanvasTablesPlugin extends Plugin {
  settings: NctSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new NctSettingTab(this.app, this));

    this.registerMarkdownCodeBlockProcessor("nctable", (source, el, ctx) => {
      ctx.addChild(new NctableView(this.app, source, el));
    });

    this.addCommand({
      id: "create-canvas-with-table",
      name: "新建带表格的画布",
      callback: () => {
        void createCanvasWithTable(this.app, this.settings.rootDir).catch((e) => {
          new Notice(`创建画布失败：${e instanceof Error ? e.message : String(e)}`);
        });
      },
    });

    this.addCommand({
      id: "create-table-card",
      name: "新建表格卡片",
      callback: () => {
        void createTableCard(this.app, this.settings.rootDir)
          .then((paths) => new Notice(`已创建表格卡片：${paths.cardPath}`))
          .catch((e) => new Notice(`创建卡片失败：${e instanceof Error ? e.message : String(e)}`));
      },
    });
  }
}