import Decimal from "decimal.js";
import { Portfolio } from "./types";
import type { PositionHistoryEntry } from "./positionEngine";

function s(d: Decimal | undefined | null): string | null {
  if (d == null) return null;
  return d.toFixed(); // full precision string
}

export type PortfolioDTO = {
  asOf: string | null;
  missingPriceSymbols: string[];
  totals: {
    value: string | null;
    costBasis: string | null;
    realized: string | null;
    unrealized: string | null;
    totalPnL: string | null;
    fees: string | null;
  };
  positions: Array<{
    symbol: "BTC" | "ETH" | "SOL" | "CKB" | "DOGE";
    quantity: string | null;
    averageCost: string | null;
    costBasis: string | null;
    value: string | null;
    currentPrice: string | null;
    realizedPnL: string | null;
    unrealizedPnL: string | null;
    totalPnL: string | null;
    fees: string | null;
    allocation: string | null;
    closedButHasRealizedPnL: boolean;
  }>;
};

export function portfolioToJson(p: Portfolio): PortfolioDTO {
  return {
    asOf: p.asOf,
    missingPriceSymbols: p.missingPriceSymbols,
    totals: {
      value: s(p.totals.value),
      costBasis: s(p.totals.costBasis),
      realized: s(p.totals.realized),
      unrealized: s(p.totals.unrealized),
      totalPnL: s(p.totals.totalPnL),
      fees: s(p.totals.fees),
    },
    positions: p.positions.map((pos): PortfolioDTO["positions"][number] => ({
      symbol: pos.symbol,
      quantity: s(pos.quantity),
      averageCost: s(pos.averageCost),
      costBasis: s(pos.costBasis),
      value: s(pos.value),
      currentPrice: pos.currentPrice ? s(pos.currentPrice) : null,
      realizedPnL: s(pos.realizedPnL),
      unrealizedPnL: s(pos.unrealizedPnL),
      totalPnL: s(pos.totalPnL),
      fees: s(pos.fees),
      allocation: s(pos.allocation),
      closedButHasRealizedPnL: pos.closedButHasRealizedPnL,
    })),
  };
}

export type PositionHistoryEntryDTO = {
  tradeId: string;
  timestamp: string;
  exchange: "Binance" | "Coinbase";
  symbol: "BTC" | "ETH" | "SOL" | "CKB" | "DOGE";
  side: "BUY" | "SELL";
  quantity: string;
  priceUsd: string;
  feeUsd: string;
  costAdded: string;
  costRemoved: string;
  netProceeds: string;
  realizedPnl: string;
  fee: string;
  qtyAfter: string;
  costBasisAfter: string;
  avgCostAfter: string;
  cumulativeRealized: string;
  cumulativeFees: string;
};

export function positionHistoryToJson(entries: PositionHistoryEntry[]): PositionHistoryEntryDTO[] {
  const toS = (d: Decimal) => d.toFixed();
  return entries.map((e): PositionHistoryEntryDTO => ({
    tradeId: e.tradeId,
    timestamp: e.timestamp,
    exchange: e.exchange,
    symbol: e.symbol,
    side: e.side,
    quantity: toS(e.quantity),
    priceUsd: toS(e.priceUsd),
    feeUsd: toS(e.feeUsd),
    costAdded: toS(e.costAdded),
    costRemoved: toS(e.costRemoved),
    netProceeds: toS(e.netProceeds),
    realizedPnl: toS(e.realizedPnl),
    fee: toS(e.fee),
    qtyAfter: toS(e.qtyAfter),
    costBasisAfter: toS(e.costBasisAfter),
    avgCostAfter: toS(e.avgCostAfter),
    cumulativeRealized: toS(e.cumulativeRealized),
    cumulativeFees: toS(e.cumulativeFees),
  }));
}

