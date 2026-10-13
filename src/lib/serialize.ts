import Decimal from "decimal.js";
import { Portfolio } from "./types";

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

