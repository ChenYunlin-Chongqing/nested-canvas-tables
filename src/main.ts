import { Notice, Plugin } from "obsidian";
import { createCanvasWithTable, createTableCard, createTableData, nctableBlock, quickCreateTable } from "./commands.ts";
import { TOOLBAR_FORMAT_COMMANDS } from "./core/markdown.ts";
import { openDemo, runTour } from "./onboarding.ts";
import { NctableView, destroyFloatingToolbar } from "./render/table-view.ts";
import { DEFAULT_SETTINGS, NctSettings, NctSettingTab } from "./settings.ts";

export default class NestedCanvasTablesPlugin extends Plugin {
  settings: NctSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new NctSettingTab(this.app, this));

    const views = new Set<NctableView>();
    this.registerMarkdownCodeBlockProcessor("nctable", (source, el, ctx) => {
      const view = new NctableView(this.app, source, el, ctx.sourcePath);
      views.add(view);
      view.register(() => views.delete(view));
      ctx.addChild(view);
    });

    // Editing Toolbar 的格式命令在画布内拿不到编辑器（getActiveEditor 为 null）而空转；
    // 单元格是活跃编辑面时接管到单元格源码，其余场景原样放行。卸载时还原。
    const commands = (this.app as unknown as { commands: { executeCommandById: (id: string) => boolean } }).commands;
    const origExec = commands.executeCommandById.bind(commands);
    commands.executeCommandById = (id: string): boolean => {
      if (id in TOOLBAR_FORMAT_COMMANDS) {
        for (const view of [...views].sort((a, b) => b.trackedAt - a.trackedAt)) {
          if (view.tryFormatCommand(id)) return true;
        }
      }
      return origExec(id);
    };
    this.register(() => {
      commands.executeCommandById = origExec;
    });

    const ribbon = this.addRibbonIcon("table", "一键新建嵌套表格", () => {
      void quickCreateTable(this.app, this.settings.rootDir)
        .then((msg) => new Notice(msg))
        .catch((e) => new Notice(`新建表格失败：${e instanceof Error ? e.message : String(e)}`));
    });
    ribbon.addClass("nct-ribbon");

    this.addCommand({
      id: "quick-create",
      name: "一键新建嵌套表格",
      callback: () => {
        void quickCreateTable(this.app, this.settings.rootDir)
          .then((msg) => new Notice(msg))
          .catch((e) => new Notice(`新建表格失败：${e instanceof Error ? e.message : String(e)}`));
      },
    });

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        menu.addItem((it) =>
          it
            .setTitle("插入嵌套表格")
            .setIcon("table")
            .onClick(() => {
              void createTableData(this.app, this.settings.rootDir)
                .then((dataPath) => editor.replaceSelection(nctableBlock(dataPath)))
                .catch((e) => new Notice(`插入表格失败：${e instanceof Error ? e.message : String(e)}`));
            }),
        );
      }),
    );

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

  onunload(): void {
    destroyFloatingToolbar();
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