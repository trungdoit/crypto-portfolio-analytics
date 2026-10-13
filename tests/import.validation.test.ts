import { describe, it, expect } from "vitest";
import { parseTradesCsv } from "../src/lib/import";

describe("import validation", () => {
  it("rejects duplicate trade_id", () => {
    const csv = [
      "trade_id,timestamp,exchange,symbol,side,quantity,price_usd,fee_usd",
      "A,2026-01-01T00:00:00Z,Binance,BTC,BUY,1,100,1",
      "A,2026-01-02T00:00:00Z,Binance,BTC,BUY,1,100,1",
    ].join("\n");
    const res = parseTradesCsv(csv);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === "DuplicateTradeId")).toBe(true);
    }
  });

  it("rejects short-sell (SELL exceeding available quantity)", () => {
    const csv = [
      "trade_id,timestamp,exchange,symbol,side,quantity,price_usd,fee_usd",
      "A,2026-01-01T00:00:00Z,Binance,ETH,BUY,1,100,0",
      "B,2026-01-02T00:00:00Z,Binance,ETH,SELL,2,100,0",
    ].join("\n");
    const res = parseTradesCsv(csv);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === "ShortSell")).toBe(true);
    }
  });

  it("rejects negative fee and nonpositive price/quantity", () => {
    const csv1 = [
      "trade_id,timestamp,exchange,symbol,side,quantity,price_usd,fee_usd",
      "A,2026-01-01T00:00:00Z,Binance,BTC,BUY,0,100,0",
    ].join("\n");
    const r1 = parseTradesCsv(csv1);
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.errors.some((e) => e.code === "NonPositiveAmount" && e.field === "quantity")).toBe(true);
    }

    const csv2 = [
      "trade_id,timestamp,exchange,symbol,side,quantity,price_usd,fee_usd",
      "B,2026-01-01T00:00:00Z,Binance,BTC,BUY,1,100,-1",
    ].join("\n");
    const r2 = parseTradesCsv(csv2);
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.errors.some((e) => e.code === "NegativeFee")).toBe(true);
    }
  });
});

