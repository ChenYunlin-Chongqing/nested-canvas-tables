export type HAlign = "left" | "center" | "right" | "justify";
export type VAlign = "top" | "middle" | "bottom";

export interface CellStyle {
  bg?: string;
  color?: string;
  align?: HAlign;
  valign?: VAlign;
}

export const H_ALIGNS: { token: HAlign; label: string; icon: string }[] = [
  { token: "left", label: "靠左", icon: "align-left" },
  { token: "center", label: "居中", icon: "align-center" },
  { token: "right", label: "靠右", icon: "align-right" },
  { token: "justify", label: "两端对齐", icon: "align-justify" },
];

export const V_ALIGNS: { token: VAlign; label: string; icon: string }[] = [
  { token: "top", label: "靠顶", icon: "align-start-vertical" },
  { token: "middle", label: "居中", icon: "align-center-vertical" },
  { token: "bottom", label: "靠底", icon: "align-end-vertical" },
];

export interface PaletteEntry {
  token: string;
  label: string;
  css: string;
}

// 明暗主题皆可读的中等饱和度文字色
export const TEXT_COLORS: PaletteEntry[] = [
  { token: "red", label: "红", css: "#d05454" },
  { token: "orange", label: "橙", css: "#d08a3e" },
  { token: "green", label: "绿", css: "#4a9a6a" },
  { token: "blue", label: "蓝", css: "#4a86d0" },
  { token: "purple", label: "紫", css: "#9a6ad0" },
];

// 半透明叠加，明暗主题都成立
export const BG_TINTS: PaletteEntry[] = [
  { token: "tint-1", label: "红晕", css: "color-mix(in srgb, #d05454 16%, transparent)" },
  { token: "tint-2", label: "橙晕", css: "color-mix(in srgb, #d08a3e 16%, transparent)" },
  { token: "tint-3", label: "绿晕", css: "color-mix(in srgb, #4a9a6a 16%, transparent)" },
  { token: "tint-4", label: "蓝晕", css: "color-mix(in srgb, #4a86d0 16%, transparent)" },
  { token: "tint-5", label: "紫晕", css: "color-mix(in srgb, #9a6ad0 16%, transparent)" },
];

export const HIGHLIGHT_CSS = "var(--text-highlight-bg, rgba(255, 208, 0, 0.4))";

export function textColorCss(token?: string): string | null {
  return TEXT_COLORS.find((c) => c.token === token)?.css ?? null;
}

export function bgTintCss(token?: string): string | null {
  return BG_TINTS.find((c) => c.token === token)?.css ?? null;
}

export function validateCellStyle(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object") return "style 不是对象";
  const s = value as Record<string, unknown>;
  for (const key of Object.keys(s)) {
    if (key !== "bg" && key !== "color" && key !== "align" && key !== "valign") return `style 含未知字段：${key}`;
  }
  if (s.color !== undefined && !TEXT_COLORS.some((c) => c.token === s.color)) return "style.color 不是合法色板 token";
  if (s.bg !== undefined && !BG_TINTS.some((c) => c.token === s.bg)) return "style.bg 不是合法色板 token";
  if (s.align !== undefined && !H_ALIGNS.some((a) => a.token === s.align)) return "style.align 不是合法水平对齐 token";
  if (s.valign !== undefined && !V_ALIGNS.some((a) => a.token === s.valign)) return "style.valign 不是合法垂直对齐 token";
  return null;
}