import Decimal from "decimal.js";
import type { PricesSnapshot, Trade, Position, PositionTradeSnapshot } from "./types";

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

/**
 * Derive lifecycle positions from position history. This builds strictly on top of
 * buildPositionHistory to ensure consistency with the weighted-average engine.
 */
export function resolvePositions(trades: Trade[], prices: PricesSnapshot): Position[] {
  const history = buildPositionHistory(trades);
  // Group history by symbol in ascending timestamp order (already sorted)
  const bySymbol = new Map<"BTC" | "ETH" | "SOL" | "CKB" | "DOGE", PositionHistoryEntry[]>();
  for (const sym of ["BTC", "ETH", "SOL", "CKB", "DOGE"] as const) bySymbol.set(sym, []);
  for (const h of history) bySymbol.get(h.symbol)!.push(h);

  const positions: Position[] = [];
  for (const sym of ["BTC", "ETH", "SOL", "CKB", "DOGE"] as const) {
    const list = bySymbol.get(sym)!;
    if (list.length === 0) continue;
    let currentId = 0;
    // State for the currently-open position segment
    let openTrades: PositionTradeSnapshot[] = [];
    let openedAt: string | null = null;
    let peakQty = new Decimal(0);
    let lastQty = new Decimal(0);
    let lastAvg = new Decimal(0);
    let lastCb = new Decimal(0);
    let realizedWithin = new Decimal(0);
    let totalFeesWithin = new Decimal(0);

    const flushIfAny = (closedAt: string | null) => {
      if (openedAt == null) return;
      const status = lastQty.equals(0) ? "CLOSED" : "OPEN";
      const price = prices.pricesBySymbol[sym];
      const value = status === "OPEN" && price ? lastQty.mul(price) : new Decimal(0);
      const unreal = status === "OPEN" ? value.sub(lastCb) : new Decimal(0);
      positions.push({
        id: `${sym}-${++currentId}`,
        asset: sym,
        status,
        openedAt,
        closedAt: status === "CLOSED" ? closedAt : null,
        tradeCount: openTrades.length,
        trades: openTrades,
        currentQuantity: lastQty,
        peakQuantity: peakQty,
        averageCost: lastAvg,
        costBasis: lastCb,
        realizedPnL: realizedWithin,
        unrealizedPnL: unreal,
        totalFees: totalFeesWithin,
      });
      // reset
      openTrades = [];
      openedAt = null;
      peakQty = new Decimal(0);
      lastQty = new Decimal(0);
      lastAvg = new Decimal(0);
      lastCb = new Decimal(0);
      realizedWithin = new Decimal(0);
      totalFeesWithin = new Decimal(0);
    };

    for (const e of list) {
      // Start a new position on first BUY when currently closed
      if (openedAt == null) {
        if (e.side !== "BUY") {
          // Defensive: skip stray SELL (shouldn't happen after validation)
          continue;
        }
        openedAt = e.timestamp;
      }
      // Snapshot for this trade within the current position
      const realizedDelta = e.realizedPnl;
      realizedWithin = realizedWithin.add(realizedDelta);
      totalFeesWithin = totalFeesWithin.add(e.fee);
      lastQty = e.qtyAfter;
      lastAvg = e.avgCostAfter;
      lastCb = e.costBasisAfter;
      if (lastQty.greaterThan(peakQty)) peakQty = lastQty;

      const snap: PositionTradeSnapshot = {
        tradeId: e.tradeId,
        timestamp: e.timestamp,
        side: e.side,
        quantity: e.quantity,
        priceUsd: e.priceUsd,
        feeUsd: e.feeUsd,
        afterQuantity: e.qtyAfter,
        afterAverageCost: e.avgCostAfter,
        afterCostBasis: e.costBasisAfter,
        realizedDelta,
        cumulativeRealized: realizedWithin,
      };
      openTrades.push(snap);

      // If fully closed after this trade, flush position
      if (e.qtyAfter.equals(0)) {
        flushIfAny(e.timestamp);
      }
    }
    // If position remains open at the end, flush as OPEN
    if (openedAt != null) {
      flushIfAny(null);
    }
  }

  // Sort for stable display: by asset, then openedAt asc, then id.
  positions.sort((a, b) => {
    if (a.asset !== b.asset) return a.asset.localeCompare(b.asset);
    if (a.openedAt !== b.openedAt) return a.openedAt < b.openedAt ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
  return positions;
}
