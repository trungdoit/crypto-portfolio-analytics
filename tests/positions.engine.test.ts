import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import path from "path";
import { readFileSync } from "fs";
import { resolvePositions } from "../src/lib/positionEngine";
import { computePortfolio } from "../src/lib/portfolio";
import { parsePricesCsv, parseTradesCsv } from "../src/lib/import";
import type { PricesSnapshot, Trade } from "../src/lib/types";

function t(
  tradeId: string,
  ts: string,
  sym: "BTC" | "ETH" | "SOL" | "CKB" | "DOGE",
  side: "BUY" | "SELL",
  qty: string | number,
  price: string | number,
  fee: string | number
): Trade {
  return {
    tradeId,
    timestamp: ts,
    exchange: "Binance",
    symbol: sym,
    side,
    quantity: new Decimal(qty),
    priceUsd: new Decimal(price),
    feeUsd: new Decimal(fee),
  };
}

describe("positions engine - splitting and aggregation", () => {
  const zeroPrices: PricesSnapshot = {
    asOf: "2026-01-01T00:00:00Z",
    pricesBySymbol: { BTC: undefined, ETH: undefined, SOL: undefined, CKB: undefined, DOGE: undefined },
    missingSymbols: ["BTC", "ETH", "SOL", "CKB", "DOGE"],
  };

  it("full close then rebuy creates two positions", () => {
    const trades: Trade[] = [
      t("1", "2026-01-01T00:00:00Z", "BTC", "BUY", 1, 100, 0),
      t("2", "2026-01-02T00:00:00Z", "BTC", "SELL", 1, 110, 0), // full close
      t("3", "2026-01-03T00:00:00Z", "BTC", "BUY", 0.5, 200, 0), // new position
    ];
    const prices: PricesSnapshot = {
      ...zeroPrices,
      pricesBySymbol: { ...zeroPrices.pricesBySymbol, BTC: new Decimal(200) },
    };
    const pos = resolvePositions(trades, prices).filter((p) => p.asset === "BTC");
    expect(pos.length).toBe(2);
    expect(pos[0].status).toBe("CLOSED");
    expect(pos[0].tradeCount).toBe(2);
    expect(pos[1].status).toBe("OPEN");
    expect(pos[1].tradeCount).toBe(1);
    expect(pos[1].currentQuantity.toFixed()).toBe("0.5");
  });

  it("partial sells remain in one open position", () => {
    const trades: Trade[] = [
      t("1", "2026-01-01T00:00:00Z", "SOL", "BUY", 10, 10, 0),
      t("2", "2026-01-02T00:00:00Z", "SOL", "SELL", 4, 12, 0),
      t("3", "2026-01-03T00:00:00Z", "SOL", "BUY", 1, 8, 0),
    ];
    const prices: PricesSnapshot = {
      ...zeroPrices,
      pricesBySymbol: { ...zeroPrices.pricesBySymbol, SOL: new Decimal(11) },
    };
    const pos = resolvePositions(trades, prices).filter((p) => p.asset === "SOL");
    expect(pos.length).toBe(1);
    expect(pos[0].status).toBe("OPEN");
    expect(pos[0].currentQuantity.toFixed()).toBe("7"); // 10 - 4 + 1
    // average cost should reflect WA across buys only; verify cost basis > 0
    expect(pos[0].costBasis.greaterThan(0)).toBe(true);
  });

  it("open position totals equal holdings and realized sums match portfolio realized", () => {
    const tradesCsv = readFileSync(path.join(process.cwd(), "data", "trades.csv"), "utf8");
    const pricesCsv = readFileSync(path.join(process.cwd(), "data", "prices.csv"), "utf8");
    const parsed = parseTradesCsv(tradesCsv);
    if (!parsed.ok) throw new Error("trades.csv failed validation");
    const prices = parsePricesCsv(pricesCsv);

    const portfolio = computePortfolio(parsed.trades, prices);
    const positions = resolvePositions(parsed.trades, prices);

    // Check open positions aggregation equals per-asset holdings
    const byAssetOpen = new Map<string, { qty: Decimal; cb: Decimal; unreal: Decimal }>();
    for (const sym of ["BTC", "ETH", "SOL", "CKB", "DOGE"] as const) {
      byAssetOpen.set(sym, { qty: new Decimal(0), cb: new Decimal(0), unreal: new Decimal(0) });
    }
    for (const p of positions) {
      if (p.status === "OPEN") {
        const agg = byAssetOpen.get(p.asset)!;
        agg.qty = agg.qty.add(p.currentQuantity);
        agg.cb = agg.cb.add(p.costBasis);
        agg.unreal = agg.unreal.add(p.unrealizedPnL);
      }
    }
    for (const asset of ["BTC", "ETH", "SOL", "CKB", "DOGE"] as const) {
      const agg = byAssetOpen.get(asset)!;
      const hold = portfolio.positions.find((x) => x.symbol === asset)!;
      expect(agg.qty.toFixed()).toBe(hold.quantity.toFixed());
      expect(agg.cb.toFixed()).toBe(hold.costBasis.toFixed());
      // allow tiny epsilon for unrealized due to floats in display; engine uses Decimal so exact expected
      const diff = agg.unreal.sub(hold.unrealizedPnL).abs();
      expect(diff.lessThanOrEqualTo("1e-12")).toBe(true);
    }

    // Sum of realized across all positions equals portfolio totals.realized
    const realizedSum = positions.reduce((acc, p) => acc.add(p.realizedPnL), new Decimal(0));
    expect(realizedSum.toFixed()).toBe(portfolio.totals.realized.toFixed());
  });

  it("modal data consistency: last cumulativeRealized equals position.realized on closed positions", () => {
    const trades: Trade[] = [
      t("1", "2026-01-01T00:00:00Z", "ETH", "BUY", 2, 100, 1), // cost 201
      t("2", "2026-01-02T00:00:00Z", "ETH", "SELL", 2, 120, 2), // proceeds 240-2=238; realized 238-201=37
    ];
    const prices: PricesSnapshot = {
      asOf: "2026-01-03T00:00:00Z",
      pricesBySymbol: { BTC: undefined, ETH: new Decimal(119), SOL: undefined, CKB: undefined, DOGE: undefined },
      missingSymbols: ["BTC", "SOL", "CKB", "DOGE"],
    };
    const positions = resolvePositions(trades, prices).filter((p) => p.asset === "ETH");
    expect(positions.length).toBe(1);
    const pos = positions[0];
    expect(pos.status).toBe("CLOSED");
    const last = pos.trades[pos.trades.length - 1];
    expect(last.cumulativeRealized.toFixed()).toBe(pos.realizedPnL.toFixed());
    expect(last.afterQuantity.toFixed()).toBe("0");
  });
});

