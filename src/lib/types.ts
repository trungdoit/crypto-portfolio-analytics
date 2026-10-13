import { z } from "zod";
import Decimal from "decimal.js";

// Zod schemas for CSV rows as strings
export const TradeCsvSchema = z.object({
  trade_id: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  exchange: z.enum(["Binance", "Coinbase"]),
  symbol: z.enum(["BTC", "ETH", "SOL", "CKB", "DOGE"]),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.string().min(1),
  price_usd: z.string().min(1),
  fee_usd: z.string().min(1),
});
export type TradeCsvRow = z.infer<typeof TradeCsvSchema>;

export const PriceCsvSchema = z.object({
  as_of: z.string().datetime({ offset: true }),
  symbol: z.enum(["BTC", "ETH", "SOL", "CKB", "DOGE"]),
  price_usd: z.string().min(1),
});
export type PriceCsvRow = z.infer<typeof PriceCsvSchema>;

// Domain types with Decimal values for all numeric fields
export type Trade = {
  tradeId: string;
  timestamp: string; // ISO-8601
  exchange: "Binance" | "Coinbase";
  symbol: "BTC" | "ETH" | "SOL" | "CKB" | "DOGE";
  side: "BUY" | "SELL";
  quantity: Decimal;
  priceUsd: Decimal; // per unit
  feeUsd: Decimal;
};

export type PricesSnapshot = {
  asOf: string; // ISO-8601
  pricesBySymbol: Record<"BTC" | "ETH" | "SOL" | "CKB" | "DOGE", Decimal | undefined>;
  // Track which symbols are missing a price
  missingSymbols: Array<"BTC" | "ETH" | "SOL" | "CKB" | "DOGE">;
};

export type AssetPosition = {
  symbol: "BTC" | "ETH" | "SOL" | "CKB" | "DOGE";
  quantity: Decimal; // remaining
  averageCost: Decimal; // per unit; 0 when quantity=0
  costBasis: Decimal; // remaining cost basis
  value: Decimal; // quantity * currentPrice (0 if price missing)
  currentPrice: Decimal | undefined;
  realizedPnL: Decimal;
  unrealizedPnL: Decimal; // value - costBasis
  totalPnL: Decimal; // realized + unrealized
  fees: Decimal; // total fees attributed to this asset
  allocation: Decimal; // share of total current value; 0 if total value is 0
  closedButHasRealizedPnL: boolean;
};

export type PortfolioTotals = {
  value: Decimal;
  costBasis: Decimal;
  realized: Decimal;
  unrealized: Decimal;
  totalPnL: Decimal;
  fees: Decimal;
};

export type Portfolio = {
  asOf: string | null;
  positions: AssetPosition[];
  totals: PortfolioTotals;
  missingPriceSymbols: Array<"BTC" | "ETH" | "SOL" | "CKB" | "DOGE">;
};

export type ImportError = {
  rowNumber: number; // 1-based including header row in CSV display; for users we report data row number
  code:
    | "MissingColumn"
    | "InvalidTimestamp"
    | "UnsupportedValue"
    | "NonPositiveAmount"
    | "NegativeFee"
    | "DuplicateTradeId"
    | "ShortSell";
  message: string;
  field?: string;
  tradeId?: string;
};

export type ImportResult =
  | {
      ok: true;
      trades: Trade[];
    }
  | {
      ok: false;
      errors: ImportError[];
    };

export function toDecimalString(d: Decimal): string {
  // Return plain string without exponential notation; full precision
  return new Decimal(d).toFixed(); // no rounding by default
}

