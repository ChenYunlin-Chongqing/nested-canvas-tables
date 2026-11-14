import { Notice, Plugin } from "obsidian";
import { createCanvasWithTable, createTableCard } from "./commands.ts";
import { openDemo, runTour } from "./onboarding.ts";
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
    this.addCommand({
      id: "open-guide",
      name: "使用引导",
      callback: () => void this.startTour(false),
    });
    this.addCommand({
      id: "open-demo",
      name: "打开使用示例",
      callback: () => void openDemo(this.app, this.settings.rootDir),
    });
    this.app.workspace.onLayoutReady(() => {
      if (!this.settings.onboarded) void this.startTour(true);
    });
  }

  private async startTour(firstRun: boolean): Promise<void> {
    await openDemo(this.app, this.settings.rootDir);
    await new Promise((r) => setTimeout(r, 900));
    runTour(this, (dontShowAgain) => {
      if (firstRun || dontShowAgain) this.settings.onboarded = true;
      if (dontShowAgain) this.settings.showHints = false;
      void this.saveData(this.settings);
    });
  }
}