export type AssetSymbol = "BTC" | "ETH" | "SOL" | "CKB" | "DOGE";

// Color-blind friendly Okabe–Ito palette, assigned stably per asset
// Reference: https://jfly.uni-koeln.de/color/
export const ASSET_COLORS: Record<AssetSymbol, string> = {
  BTC: "#E69F00", // orange
  ETH: "#0072B2", // blue
  SOL: "#009E73", // green
  CKB: "#D55E00", // vermillion
  DOGE: "#CC79A7", // reddish purple
};

export function colorForAsset(symbol: string): string {
  if (symbol in ASSET_COLORS) {
    return ASSET_COLORS[symbol as AssetSymbol];
  }
  return "#666666";
}

export function withAlpha(hex: string, alpha: number): string {
  // Accept #RRGGBB; clamp alpha [0,1]
  const a = Math.min(1, Math.max(0, alpha));
  const m = hex.trim().match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return hex;
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 0xff;
  const g = (int >> 8) & 0xff;
  const b = int & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

