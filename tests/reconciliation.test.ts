import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { parsePricesCsv, parseTradesCsv } from "../src/lib/import";
import { computePortfolio } from "../src/lib/portfolio";

function to2(n: string) {
  // normalize decimal string to 2dp
  // avoid rounding differences due to trailing zeros
  const v = Number(n);
  return v.toFixed(2);
}

describe("full-dataset reconciliation", () => {
  it("matches expected totals and per-asset numbers", () => {
    const tradesCsv = readFileSync(path.join(process.cwd(), "data", "trades.csv"), "utf8");
    const pricesCsv = readFileSync(path.join(process.cwd(), "data", "prices.csv"), "utf8");
    const t = parseTradesCsv(tradesCsv);
    if (!t.ok) throw new Error("trades.csv failed validation");
    const p = parsePricesCsv(pricesCsv);
    const portfolio = computePortfolio(t.trades, p);
    const totals = portfolio.totals;
    expect(totals.value.toFixed(2)).toBe("60620.89");
    expect(totals.costBasis.toFixed(2)).toBe("59969.24");
    expect(totals.realized.toFixed(2)).toBe("-5052.96");
    expect(totals.unrealized.toFixed(2)).toBe("651.65");
    expect(totals.totalPnL.toFixed(2)).toBe("-4401.31");
    expect(totals.fees.toFixed(2)).toBe("2708.86");

    // Map positions by symbol
    const by = new Map(portfolio.positions.map((p) => [p.symbol, p]));
    const check = (
      sym: "BTC" | "ETH" | "SOL" | "CKB" | "DOGE",
      qty: string,
      costBasis: string,
      value: string,
      realized: string,
      unrealized: string,
      fees: string
    ) => {
      const pos = by.get(sym)!;
      expect(pos.quantity.toFixed(8)).toBe(qty);
      expect(pos.costBasis.toFixed(2)).toBe(costBasis);
      expect(pos.value.toFixed(2)).toBe(value);
      expect(pos.realizedPnL.toFixed(2)).toBe(realized);
      expect(pos.unrealizedPnL.toFixed(2)).toBe(unrealized);
      expect(pos.fees.toFixed(2)).toBe(fees);
    };

    check("BTC", "0.07742920", "9114.34", "8633.36", "-463.75", "-480.98", "486.42");
    check("ETH", "2.84689800", "11648.43", "11458.76", "-984.43", "-189.66", "529.66");
    check("SOL", "53.36430000", "11433.18", "11126.46", "-2408.93", "-306.72", "518.99");
    check("CKB", "1947047.00000000", "13382.76", "13921.39", "1499.63", "538.63", "525.21");
    check("DOGE", "63970.78000000", "14390.53", "15480.93", "-2695.48", "1090.40", "648.58");
  });
});

