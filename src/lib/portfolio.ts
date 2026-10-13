import Decimal from "decimal.js";
import { AssetPosition, Portfolio, PricesSnapshot, Trade } from "./types";

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

export function computePortfolio(trades: Trade[], prices: PricesSnapshot): Portfolio {
  // Initialize state for all symbols encountered
  const symbols = new Set<"BTC" | "ETH" | "SOL" | "CKB" | "DOGE">();
  for (const t of trades) symbols.add(t.symbol);

  const stateBySymbol = new Map<string, RunningState>();
  for (const sym of ["BTC", "ETH", "SOL", "CKB", "DOGE"] as const) {
    stateBySymbol.set(sym, initState());
  }

  // Process trades in given order (caller must sort)
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
    } else {
      // SELL
      // Note: caller/import guarantees no short sells; but guard here too
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
      // If fully closed, reset average cost to zero to avoid drift
      if (st.quantity.equals(0)) {
        st.averageCost = new Decimal(0);
        st.costBasis = new Decimal(0);
      }
    }
  }

  // Build positions snapshot with current prices
  let totalValue = new Decimal(0);
  let totalCostBasis = new Decimal(0);
  let totalRealized = new Decimal(0);
  let totalFees = new Decimal(0);

  const positions: AssetPosition[] = [];
  for (const sym of ["BTC", "ETH", "SOL", "CKB", "DOGE"] as const) {
    const st = stateBySymbol.get(sym)!;
    const currentPrice = prices.pricesBySymbol[sym];
    const value = currentPrice ? st.quantity.mul(currentPrice) : new Decimal(0);
    const unrealized = value.sub(st.costBasis);
    const total = st.realizedPnL.add(unrealized);
    const closedButHasRealizedPnL = st.quantity.equals(0) && !st.realizedPnL.equals(0);

    positions.push({
      symbol: sym,
      quantity: st.quantity,
      averageCost: st.averageCost,
      costBasis: st.costBasis,
      value,
      currentPrice: currentPrice ?? undefined,
      realizedPnL: st.realizedPnL,
      unrealizedPnL: unrealized,
      totalPnL: total,
      fees: st.fees,
      allocation: new Decimal(0), // fill after computing total
      closedButHasRealizedPnL,
    });

    totalValue = totalValue.add(value);
    totalCostBasis = totalCostBasis.add(st.costBasis);
    totalRealized = totalRealized.add(st.realizedPnL);
    totalFees = totalFees.add(st.fees);
  }

  // Compute allocations
  for (const p of positions) {
    p.allocation = totalValue.equals(0) ? new Decimal(0) : p.value.div(totalValue);
  }

  const totals = {
    value: totalValue,
    costBasis: totalCostBasis,
    realized: totalRealized,
    unrealized: totalValue.sub(totalCostBasis),
    totalPnL: totalRealized.add(totalValue.sub(totalCostBasis)),
    fees: totalFees,
  };

  return {
    asOf: prices.asOf,
    positions,
    totals,
    missingPriceSymbols: prices.missingSymbols,
  };
}

