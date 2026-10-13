import Papa from "papaparse";
import Decimal from "decimal.js";
import {
  ImportError,
  ImportResult,
  PriceCsvSchema,
  PricesSnapshot,
  Trade,
  TradeCsvRow,
  TradeCsvSchema,
} from "./types";

function normalizeDecimalString(s: string): string {
  // Trim and ensure decimal format uses dot; allow scientific but convert later
  return s.trim();
}

function parseDecimalStrict(s: string, field: string, context: string, rowNumber: number, errors: ImportError[]): Decimal | null {
  try {
    const d = new Decimal(normalizeDecimalString(s));
    return d;
  } catch {
    errors.push({
      rowNumber,
      code: "UnsupportedValue",
      field,
      message: `${context}: invalid number for ${field}`,
    });
    return null;
  }
}

export function parseTradesCsv(csvText: string): ImportResult {
  const errors: ImportError[] = [];
  const result = Papa.parse<TradeCsvRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader(h) {
      return h.trim();
    },
  });

  // Validate required columns
  const required = ["trade_id", "timestamp", "exchange", "symbol", "side", "quantity", "price_usd", "fee_usd"] as const;
  for (const col of required) {
    if (!result.meta.fields?.includes(col)) {
      errors.push({
        rowNumber: 1,
        code: "MissingColumn",
        field: col,
        message: `Missing required column: ${col}`,
      });
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const parsedTrades: Trade[] = [];
  const seenTradeIds = new Set<string>();

  for (let i = 0; i < result.data.length; i++) {
    const csvRow = result.data[i];
    const csvRowNumber = i + 2; // header is row 1 for users

    const parsed = TradeCsvSchema.safeParse(csvRow);
    if (!parsed.success) {
      // Collect top-level errors
      for (const issue of parsed.error.issues) {
        errors.push({
          rowNumber: csvRowNumber,
          code: issue.path[0] === "timestamp" ? "InvalidTimestamp" : "UnsupportedValue",
          field: issue.path[0]?.toString(),
          message: `Invalid value for ${issue.path[0] || "field"}: ${issue.message}`,
        });
      }
      continue;
    }
    const row = parsed.data;

    // Duplicate trade id
    if (seenTradeIds.has(row.trade_id)) {
      errors.push({
        rowNumber: csvRowNumber,
        code: "DuplicateTradeId",
        field: "trade_id",
        tradeId: row.trade_id,
        message: `Duplicate trade_id: ${row.trade_id}`,
      });
      continue;
    }
    seenTradeIds.add(row.trade_id);

    const quantity = parseDecimalStrict(row.quantity, "quantity", `Row ${csvRowNumber}`, csvRowNumber, errors);
    const priceUsd = parseDecimalStrict(row.price_usd, "price_usd", `Row ${csvRowNumber}`, csvRowNumber, errors);
    const feeUsd = parseDecimalStrict(row.fee_usd, "fee_usd", `Row ${csvRowNumber}`, csvRowNumber, errors);
    if (!quantity || !priceUsd || !feeUsd) {
      continue;
    }

    // Basic numeric validations
    if (!(quantity.greaterThan(0))) {
      errors.push({
        rowNumber: csvRowNumber,
        code: "NonPositiveAmount",
        field: "quantity",
        message: "Quantity must be greater than zero",
      });
      continue;
    }
    if (!(priceUsd.greaterThan(0))) {
      errors.push({
        rowNumber: csvRowNumber,
        code: "NonPositiveAmount",
        field: "price_usd",
        message: "Price must be greater than zero",
      });
      continue;
    }
    if (feeUsd.isNegative()) {
      errors.push({
        rowNumber: csvRowNumber,
        code: "NegativeFee",
        field: "fee_usd",
        message: "Fee must be zero or greater",
      });
      continue;
    }

    parsedTrades.push({
      tradeId: row.trade_id,
      timestamp: row.timestamp,
      exchange: row.exchange,
      symbol: row.symbol,
      side: row.side,
      quantity,
      priceUsd,
      feeUsd,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Sort trades ascending by timestamp, then by trade id for stability
  parsedTrades.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : a.tradeId.localeCompare(b.tradeId)));

  // Short-sell validation: ensure cumulative quantity for each symbol never goes negative
  const qtyBySymbol = new Map<string, Decimal>();
  for (const t of parsedTrades) {
    const prev = qtyBySymbol.get(t.symbol) ?? new Decimal(0);
    const delta = t.side === "BUY" ? t.quantity : t.quantity.negated();
    const next = prev.add(delta);
    if (next.isNegative()) {
      const rowNumber = result.data.findIndex((r) => r.trade_id === t.tradeId) + 2;
      errors.push({
        rowNumber: rowNumber > 1 ? rowNumber : 0,
        code: "ShortSell",
        message: `SELL of ${t.quantity.toFixed()} ${t.symbol} exceeds available quantity at this point in history`,
        field: "quantity",
        tradeId: t.tradeId,
      });
      break;
    }
    qtyBySymbol.set(t.symbol, next);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, trades: parsedTrades };
}

export function parsePricesCsv(csvText: string): PricesSnapshot {
  const result = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader(h) {
      return h.trim();
    },
  });

  const rows: Array<{ as_of: string; symbol: string; price_usd: string }> = result.data as any;
  // Validate and collect
  const pricesBySymbol: PricesSnapshot["pricesBySymbol"] = {
    BTC: undefined,
    ETH: undefined,
    SOL: undefined,
    CKB: undefined,
    DOGE: undefined,
  };
  let asOf: string | null = null;

  for (let i = 0; i < rows.length; i++) {
    const csvRow = rows[i];
    const parse = PriceCsvSchema.safeParse(csvRow);
    if (!parse.success) {
      // Skip invalid rows silently; the UI will surface missing symbols later
      continue;
    }
    const row = parse.data;
    const price = new Decimal(normalizeDecimalString(row.price_usd));
    pricesBySymbol[row.symbol] = price;
    // Track the max as_of (latest)
    if (!asOf || row.as_of > asOf) {
      asOf = row.as_of;
    }
  }

  const missingSymbols = (Object.keys(pricesBySymbol) as Array<keyof typeof pricesBySymbol>).filter(
    (s) => pricesBySymbol[s] === undefined
  ) as PricesSnapshot["missingSymbols"];

  return {
    asOf: asOf ?? null,
    pricesBySymbol,
    missingSymbols,
  };
}

