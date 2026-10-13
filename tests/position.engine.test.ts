import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { buildPositionHistory } from "../src/lib/positionEngine";
import { computePortfolio } from "../src/lib/portfolio";
import { parsePricesCsv, parseTradesCsv } from "../src/lib/import";
import type { Trade } from "../src/lib/types";

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

describe("position history engine", () => {
  it("partial sell uses average cost; realized matches net - costRemoved; fees accumulate", () => {
    const trades: Trade[] = [
      t("1", "2026-01-01T00:00:00Z", "BTC", "BUY", "2", "100", "10"), // CB=210; avg=105
      t("2", "2026-01-02T00:00:00Z", "BTC", "SELL", "1", "120", "5"), // proceeds=115; costRemoved=105; realized=10
    ];
    const h = buildPositionHistory(trades);
    expect(h).toHaveLength(2);
    const e1 = h[0];
    expect(e1.costAdded.toFixed(2)).toBe("210.00");
    expect(e1.avgCostAfter.toFixed(2)).toBe("105.00");
    const e2 = h[1];
    expect(e2.costRemoved.toFixed(2)).toBe("105.00");
    expect(e2.netProceeds.toFixed(2)).toBe("115.00");
    expect(e2.realizedPnl.toFixed(2)).toBe("10.00");
    expect(e2.qtyAfter.toFixed()).toBe("1");
    expect(e2.avgCostAfter.toFixed(2)).toBe("105.00");
    expect(e2.cumulativeFees.toFixed(2)).toBe("15.00");
  });

  it("full close then rebuy resets avg cost to new buy avg", () => {
    const trades: Trade[] = [
      t("1", "2026-01-01T00:00:00Z", "ETH", "BUY", "10", "10", "0"), // CB=100; avg=10
      t("2", "2026-01-02T00:00:00Z", "ETH", "SELL", "10", "9", "0"), // realized=-10; qty=0; avgAfter=0
      t("3", "2026-01-03T00:00:00Z", "ETH", "BUY", "5", "20", "0"), // avg=20
    ];
    const h = buildPositionHistory(trades);
    expect(h[1].qtyAfter.toFixed()).toBe("0");
    expect(h[1].avgCostAfter.toFixed()).toBe("0");
    expect(h[2].avgCostAfter.toFixed(2)).toBe("20.00");
  });

  it("sum of per-trade realized equals portfolio total realized for full dataset", () => {
    const tradesCsv = `trade_id,timestamp,exchange,symbol,side,quantity,price_usd,fee_usd
A,2026-01-01T00:00:00Z,Binance,BTC,BUY,1,100,0
B,2026-01-02T00:00:00Z,Binance,BTC,SELL,1,90,0`;
    const parsed = parseTradesCsv(tradesCsv);
    if (!parsed.ok) throw new Error("validation failed");
    const prices = parsePricesCsv(`as_of,symbol,price_usd
2026-01-03T00:00:00Z,BTC,100`);
    const p = computePortfolio(parsed.trades, prices);
    const h = buildPositionHistory(parsed.trades);
    const sumRealized = h.reduce((acc, e) => acc.add(e.realizedPnl), new Decimal(0));
    expect(sumRealized.toFixed()).toBe(p.totals.realized.toFixed());
  });
});

