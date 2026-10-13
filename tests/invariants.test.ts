import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import Decimal from "decimal.js";
import { parsePricesCsv, parseTradesCsv } from "../src/lib/import";
import { computePortfolio } from "../src/lib/portfolio";
import { portfolioToJson } from "../src/lib/serialize";
import type { Trade, PricesSnapshot } from "../src/lib/types";

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

function sum(d: Decimal[]) {
  return d.reduce((acc, x) => acc.add(x), new Decimal(0));
}

describe("invariants - full dataset", () => {
  const tradesCsv = readFileSync(path.join(process.cwd(), "data", "trades.csv"), "utf8");
  const pricesCsv = readFileSync(path.join(process.cwd(), "data", "prices.csv"), "utf8");
  const parsed = parseTradesCsv(tradesCsv);
  if (!parsed.ok) {
    throw new Error("trades.csv failed validation");
  }
  const prices = parsePricesCsv(pricesCsv);
  const portfolio = computePortfolio(parsed.trades, prices);

  it("per-asset sums equal portfolio totals", () => {
    const values = portfolio.positions.map((p) => p.value);
    const costs = portfolio.positions.map((p) => p.costBasis);
    const realized = portfolio.positions.map((p) => p.realizedPnL);
    const unrealized = portfolio.positions.map((p) => p.unrealizedPnL);
    const fees = portfolio.positions.map((p) => p.fees);

    expect(sum(values).toFixed()).toBe(portfolio.totals.value.toFixed());
    expect(sum(costs).toFixed()).toBe(portfolio.totals.costBasis.toFixed());
    expect(sum(realized).toFixed()).toBe(portfolio.totals.realized.toFixed());
    const unrealDiff = sum(unrealized).sub(portfolio.totals.unrealized).abs();
    expect(unrealDiff.lessThanOrEqualTo("1e-12")).toBe(true);
    expect(sum(fees).toFixed()).toBe(portfolio.totals.fees.toFixed());
  });

  it("allocations sum to 1 within tiny epsilon", () => {
    const allocSum = sum(portfolio.positions.map((p) => p.allocation));
    const diff = allocSum.sub(1).abs();
    // allow minuscule residue from repeating decimals
    expect(diff.lessThanOrEqualTo("1e-12")).toBe(true);
  });

  it("total P&L equals realized + unrealized per asset and overall", () => {
    for (const p of portfolio.positions) {
      expect(p.realizedPnL.add(p.unrealizedPnL).toFixed()).toBe(p.totalPnL.toFixed());
    }
    expect(portfolio.totals.realized.add(portfolio.totals.unrealized).toFixed()).toBe(portfolio.totals.totalPnL.toFixed());
  });

  it("cost basis never negative", () => {
    for (const p of portfolio.positions) {
      expect(p.costBasis.greaterThanOrEqualTo(0)).toBe(true);
    }
  });

  it("deterministic results regardless of input row order (parser sorts by timestamp)", () => {
    const lines = tradesCsv.trim().split(/\r?\n/);
    const header = lines[0];
    const rows = lines.slice(1);
    // Fisher-Yates shuffle
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
    const shuffledCsv = [header, ...rows].join("\n");
    const parsed2 = parseTradesCsv(shuffledCsv);
    if (!parsed2.ok) {
      throw new Error("shuffled trades failed validation");
    }
    const portfolio2 = computePortfolio(parsed2.trades, prices);
    const a = portfolioToJson(portfolio);
    const b = portfolioToJson(portfolio2);
    // Compare important totals and per-asset quantities
    expect(a.totals).toEqual(b.totals);
    const mapA = new Map(a.positions.map((p) => [p.symbol, p]));
    const mapB = new Map(b.positions.map((p) => [p.symbol, p]));
    for (const [sym, pa] of mapA) {
      const pb = mapB.get(sym)!;
      expect(pb).toBeDefined();
      expect(pa.quantity).toBe(pb.quantity);
      expect(pa.costBasis).toBe(pb.costBasis);
      expect(pa.realizedPnL).toBe(pb.realizedPnL);
      expect(pa.unrealizedPnL).toBe(pb.unrealizedPnL);
      expect(pa.totalPnL).toBe(pb.totalPnL);
    }
  });
});

describe("invariants - small fixtures", () => {
  it("SELL never changes average cost of remaining position; full close resets to zero", () => {
    // Two buys at different prices -> avg cost; then partial sell; then full close
    const trades: Trade[] = [
      t("1", "2026-01-01T00:00:00Z", "BTC", "BUY", 1, 100, 0), // CB 100
      t("2", "2026-01-02T00:00:00Z", "BTC", "BUY", 1, 200, 0), // CB 300; qty 2; avg 150
      t("3", "2026-01-03T00:00:00Z", "BTC", "SELL", 1, 120, 0), // avg should remain 150 on remaining 1
      t("4", "2026-01-04T00:00:00Z", "BTC", "SELL", 1, 150, 0), // full close -> qty/cb/avg 0
    ];
    const prices: PricesSnapshot = {
      asOf: "2026-01-05T00:00:00Z",
      pricesBySymbol: {
        BTC: new Decimal(150),
        ETH: undefined,
        SOL: undefined,
        CKB: undefined,
        DOGE: undefined,
      },
      missingSymbols: ["ETH", "SOL", "CKB", "DOGE"],
    };
    const p1 = computePortfolio(trades.slice(0, 3), prices);
    const btc1 = p1.positions.find((x) => x.symbol === "BTC")!;
    expect(btc1.quantity.toFixed()).toBe("1");
    expect(btc1.averageCost.toFixed(2)).toBe("150.00");
    const p2 = computePortfolio(trades, prices);
    const btc2 = p2.positions.find((x) => x.symbol === "BTC")!;
    expect(btc2.quantity.toFixed()).toBe("0");
    expect(btc2.costBasis.toFixed()).toBe("0");
    expect(btc2.averageCost.toFixed()).toBe("0");
  });
});

