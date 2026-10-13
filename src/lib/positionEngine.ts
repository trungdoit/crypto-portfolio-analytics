import Decimal from "decimal.js";
import type { Trade } from "./types";

export type PositionHistoryEntry = {
  tradeId: string;
  timestamp: string; // ISO-8601
  exchange: "Binance" | "Coinbase";
  symbol: "BTC" | "ETH" | "SOL" | "CKB" | "DOGE";
  side: "BUY" | "SELL";
  quantity: Decimal; // trade quantity
  priceUsd: Decimal; // trade price
  feeUsd: Decimal; // trade fee
  // Derived values for this trade (per symbol running state)
  costAdded: Decimal; // BUY only (gross + fee); 0 for SELL
  costRemoved: Decimal; // SELL only (avgBefore * qty); 0 for BUY
  netProceeds: Decimal; // SELL only (qty * price - fee); 0 for BUY
  realizedPnl: Decimal; // SELL only; 0 for BUY
  fee: Decimal; // = feeUsd (for convenience)
  // Running state after this trade (for the symbol)
  qtyAfter: Decimal;
  costBasisAfter: Decimal;
  avgCostAfter: Decimal; // 0 on full close
  cumulativeRealized: Decimal;
  cumulativeFees: Decimal;
};

type RunningState = {
  quantity: Decimal;
  averageCost: Decimal;
  costBasis: Decimal;
  realizedPnL: Decimal;
  fees: Decimal;
};

function initState(): RunningState {
  return {
    quantity: new Decimal(0),
    averageCost: new Decimal(0),
    costBasis: new Decimal(0),
    realizedPnL: new Decimal(0),
    fees: new Decimal(0),
  };
}

/**
 * Replay trades per-asset in time order and produce a snapshot after each trade.
 * Caller must provide trades already sorted by timestamp (the parser guarantees this).
 */
export function buildPositionHistory(trades: Trade[]): PositionHistoryEntry[] {
  const stateBySymbol = new Map<"BTC" | "ETH" | "SOL" | "CKB" | "DOGE", RunningState>();
  for (const sym of ["BTC", "ETH", "SOL", "CKB", "DOGE"] as const) {
    stateBySymbol.set(sym, initState());
  }

  const entries: PositionHistoryEntry[] = [];

  for (const t of trades) {
    const st = stateBySymbol.get(t.symbol)!;

    if (t.side === "BUY") {
      const gross = t.quantity.mul(t.priceUsd);
      const costAdded = gross.add(t.feeUsd);
      const newQuantity = st.quantity.add(t.quantity);
      const newCostBasis = st.costBasis.add(costAdded);
      const newAverageCost = newQuantity.equals(0) ? new Decimal(0) : newCostBasis.div(newQuantity);

      st.quantity = newQuantity;
      st.costBasis = newCostBasis;
      st.averageCost = newAverageCost;
      st.fees = st.fees.add(t.feeUsd);

      entries.push({
        tradeId: t.tradeId,
        timestamp: t.timestamp,
        exchange: t.exchange,
        symbol: t.symbol,
        side: t.side,
        quantity: t.quantity,
        priceUsd: t.priceUsd,
        feeUsd: t.feeUsd,
        costAdded,
        costRemoved: new Decimal(0),
        netProceeds: new Decimal(0),
        realizedPnl: new Decimal(0),
        fee: t.feeUsd,
        qtyAfter: st.quantity,
        costBasisAfter: st.costBasis,
        avgCostAfter: st.averageCost,
        cumulativeRealized: st.realizedPnL,
        cumulativeFees: st.fees,
      });
    } else {
      // SELL
      if (t.quantity.greaterThan(st.quantity)) {
        throw new Error(`SELL exceeds available quantity for ${t.symbol}`);
      }
      const grossProceeds = t.quantity.mul(t.priceUsd);
      const netProceeds = grossProceeds.sub(t.feeUsd);
      const costRemoved = st.averageCost.mul(t.quantity);
      const realizedDelta = netProceeds.sub(costRemoved);
      const newQuantity = st.quantity.sub(t.quantity);
      const newCostBasis = st.costBasis.sub(costRemoved);
      st.quantity = newQuantity;
      st.costBasis = newCostBasis;
      st.realizedPnL = st.realizedPnL.add(realizedDelta);
      st.fees = st.fees.add(t.feeUsd);
      if (st.quantity.equals(0)) {
        st.averageCost = new Decimal(0);
        st.costBasis = new Decimal(0);
      }

      entries.push({
        tradeId: t.tradeId,
        timestamp: t.timestamp,
        exchange: t.exchange,
        symbol: t.symbol,
        side: t.side,
        quantity: t.quantity,
        priceUsd: t.priceUsd,
        feeUsd: t.feeUsd,
        costAdded: new Decimal(0),
        costRemoved,
        netProceeds,
        realizedPnl: realizedDelta,
        fee: t.feeUsd,
        qtyAfter: st.quantity,
        costBasisAfter: st.costBasis,
        avgCostAfter: st.averageCost,
        cumulativeRealized: st.realizedPnL,
        cumulativeFees: st.fees,
      });
    }
  }

  return entries;
}

