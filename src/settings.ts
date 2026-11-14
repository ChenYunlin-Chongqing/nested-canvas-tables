import { App, PluginSettingTab, Setting } from "obsidian";
import type NestedCanvasTablesPlugin from "./main.ts";

export interface NctSettings {
  rootDir: string;
  onboarded: boolean;
  showHints: boolean;
}

export const DEFAULT_SETTINGS: NctSettings = {
  rootDir: "NestedTables",
  onboarded: false,
  showHints: true,
};

export class NctSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: NestedCanvasTablesPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("数据根目录")
      .setDesc("表格卡片（cards/）、JSON 数据（data/）与新建画布存放的 Vault 目录")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.rootDir)
          .setValue(this.plugin.settings.rootDir)
          .onChange(async (value) => {
            this.plugin.settings.rootDir = value.trim().replace(/^\/+|\/+$/g, "") || DEFAULT_SETTINGS.rootDir;
            await this.plugin.saveData(this.plugin.settings);
          }),
      );
    new Setting(this.containerEl)
      .setName("显示操作提示")
      .setDesc("在表格上方显示一次性渐隐提示（悬停/右键/markdown 语法）")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showHints).onChange(async (value) => {
          this.plugin.settings.showHints = value;
          await this.plugin.saveData(this.plugin.settings);
        }),
      );
  }
}