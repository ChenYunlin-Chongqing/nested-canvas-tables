import { App, PluginSettingTab, Setting } from "obsidian";
import type NestedCanvasTablesPlugin from "./main.ts";

export interface NctSettings {
  rootDir: string;
}

export const DEFAULT_SETTINGS: NctSettings = {
  rootDir: "NestedTables",
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
  }
}