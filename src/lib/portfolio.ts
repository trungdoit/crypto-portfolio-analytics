import Decimal from "decimal.js";
import { AssetPosition, Portfolio, PricesSnapshot, Trade } from "./types";
import { buildPositionHistory } from "./positionEngine";

export function computePortfolio(trades: Trade[], prices: PricesSnapshot): Portfolio {
  // Use the position history engine to derive end-of-sequence states
  const history = buildPositionHistory(trades);
  const lastBySymbol = new Map<"BTC" | "ETH" | "SOL" | "CKB" | "DOGE", {
    quantity: Decimal;
    averageCost: Decimal;
    costBasis: Decimal;
    realizedPnL: Decimal;
    fees: Decimal;
  }>();
  for (const sym of ["BTC", "ETH", "SOL", "CKB", "DOGE"] as const) {
    lastBySymbol.set(sym, {
      quantity: new Decimal(0),
      averageCost: new Decimal(0),
      costBasis: new Decimal(0),
      realizedPnL: new Decimal(0),
      fees: new Decimal(0),
    });
  }
  for (const e of history) {
    const cur = {
      quantity: e.qtyAfter,
      averageCost: e.avgCostAfter,
      costBasis: e.costBasisAfter,
      realizedPnL: e.cumulativeRealized,
      fees: e.cumulativeFees,
    };
    lastBySymbol.set(e.symbol, cur);
  }

  // Build positions snapshot with current prices
  let totalValue = new Decimal(0);
  let totalCostBasis = new Decimal(0);
  let totalRealized = new Decimal(0);
  let totalFees = new Decimal(0);

  const positions: AssetPosition[] = [];
  for (const sym of ["BTC", "ETH", "SOL", "CKB", "DOGE"] as const) {
    const st = lastBySymbol.get(sym)!;
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

