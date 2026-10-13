import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computePortfolio } from "../src/lib/portfolio";
import { PricesSnapshot, Trade } from "../src/lib/types";

function t(
  tradeId: string,
  timestamp: string,
  symbol: "BTC" | "ETH" | "SOL" | "CKB" | "DOGE",
  side: "BUY" | "SELL",
  quantity: string | number,
  price: string | number,
  fee: string | number
): Trade {
  return {
    tradeId,
    timestamp,
    exchange: "Binance",
    symbol,
    side,
    quantity: new Decimal(quantity),
    priceUsd: new Decimal(price),
    feeUsd: new Decimal(fee),
  };
}

const zeroPrices: PricesSnapshot = {
  asOf: "2026-01-01T00:00:00Z",
  pricesBySymbol: { BTC: new Decimal(0), ETH: new Decimal(0), SOL: new Decimal(0), CKB: new Decimal(0), DOGE: new Decimal(0) },
  missingSymbols: [],
};

describe("portfolio engine - weighted average and fees", () => {
  it("includes BUY fee in average cost across multiple buys", () => {
    const trades: Trade[] = [
      t("1", "2026-01-01T00:00:00Z", "BTC", "BUY", "1", "100", "10"), // cost 110
      t("2", "2026-01-02T00:00:00Z", "BTC", "BUY", "1", "200", "20"), // cost 220
    ];
    const p = computePortfolio(trades, {
      ...zeroPrices,
      pricesBySymbol: { ...zeroPrices.pricesBySymbol, BTC: new Decimal(150) },
    });
    const pos = p.positions.find((x) => x.symbol === "BTC")!;
    // total cost basis 110 + 220 = 330; qty 2; avg cost 165
    expect(pos.costBasis.toFixed(2)).toBe("330.00");
    expect(pos.averageCost.toFixed(2)).toBe("165.00");
  });

  it("partial SELL realizes P&L using prior average cost; SELL fee reduces proceeds", () => {
    const trades: Trade[] = [
      t("1", "2026-01-01T00:00:00Z", "ETH", "BUY", "10", "100", "0"), // CB=1000
      t("2", "2026-01-02T00:00:00Z", "ETH", "SELL", "4", "120", "5"), // proceeds=480-5=475; costRemoved=4*100=400; realized=75
    ];
    const p = computePortfolio(trades, {
      ...zeroPrices,
      pricesBySymbol: { ...zeroPrices.pricesBySymbol, ETH: new Decimal(110) },
    });
    const pos = p.positions.find((x) => x.symbol === "ETH")!;
    expect(pos.realizedPnL.toFixed(2)).toBe("75.00");
    // remaining qty=6, avg cost unchanged 100, cost basis 600
    expect(pos.quantity.toFixed()).toBe("6");
    expect(pos.averageCost.toFixed(2)).toBe("100.00");
    expect(pos.costBasis.toFixed(2)).toBe("600.00");
  });

  it("full close then rebuy resets average cost", () => {
    const trades: Trade[] = [
      t("1", "2026-01-01T00:00:00Z", "SOL", "BUY", "10", "10", "0"), // CB=100
      t("2", "2026-01-02T00:00:00Z", "SOL", "SELL", "10", "9", "0"), // realized=-10
      t("3", "2026-01-03T00:00:00Z", "SOL", "BUY", "5", "20", "0"), // new position avg cost 20
    ];
    const p = computePortfolio(trades, {
      ...zeroPrices,
      pricesBySymbol: { ...zeroPrices.pricesBySymbol, SOL: new Decimal(20) },
    });
    const pos = p.positions.find((x) => x.symbol === "SOL")!;
    expect(pos.quantity.toFixed()).toBe("5");
    expect(pos.averageCost.toFixed(2)).toBe("20.00");
    // realized -10 carried
    expect(pos.realizedPnL.toFixed(2)).toBe("-10.00");
  });
});

