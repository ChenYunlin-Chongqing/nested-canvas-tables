import esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import process from "node:process";

const prod = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

// 产物目录：NCT_OUT 环境变量 > dev.config.json（gitignored，本机直出测试库插件目录）> ./dist
let OUT = process.env.NCT_OUT ?? "";
if (!OUT) {
  try {
    const dev = JSON.parse(readFileSync("dev.config.json", "utf8"));
    if (typeof dev.out === "string" && dev.out) OUT = dev.out;
  } catch {
    // 无 dev.config.json：走 dist
  }
}
if (!OUT) OUT = "./dist";
mkdirSync(OUT, { recursive: true });
cpSync("manifest.json", `${OUT}/manifest.json`);
cpSync("styles.css", `${OUT}/styles.css`);
cpSync("versions.json", `${OUT}/versions.json`);

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron"],
  format: "cjs",
  target: "es2020",
  platform: "browser",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  minify: prod,
  outfile: `${OUT}/main.js`,
});

if (watch) {
  await ctx.watch();
  console.log("[nested-canvas-tables] watch 模式已启动，产物目录:", OUT);
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("[nested-canvas-tables] 构建完成 →", OUT);
}