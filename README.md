# 嵌套表格 Nested Canvas Tables

在 Obsidian 原生 `.canvas` 画布中摆放可编辑表格卡片，单元格内可递归创建子表格。

- 表格卡片是普通 Markdown 文件，内含 `nctable` 代码块；画布只用标准 `file` 节点，不碰 Canvas 内部接口。
- 表格数据存为 Vault 内独立 JSON 文件（默认根目录 `NestedTables/`，可在设置中修改），代码块以 Vault 绝对路径指向数据文件，移动画布不断链。
- 编辑自动保存（防抖 + `Vault.process`）；数据文件损坏、缺失或被外部修改时停止写入并给出可读提示，绝不静默覆盖。

## 命令

- **新建带表格的画布**：创建表格卡片 + JSON 数据 + 合法 `.canvas` 并打开。
- **新建表格卡片**：只创建卡片与数据文件，用 Canvas 自带的「添加文件」或拖放放入现有画布。

## 开发

```bash
npm install
npm run build      # 产物目录：NCT_OUT > dev.config.json > ./dist
npm run dev        # watch
npm test           # node --test（纯逻辑单测）
npm run typecheck  # tsc --noEmit
```

本机开发约定：`dev.config.json`（gitignored）的 `out` 指向独立测试库 `nctable-test-vault` 的插件目录；踩坑记录见 `踩坑.txt`。

## 限制（MVP）

- 单元格仅纯文本 + 可选子表格；无公式、合并单元格、排序、富文本。
- 移动端未实机验证。
- 数据文件被手动改名后路径失效，显示可读错误（不自动跟踪）。