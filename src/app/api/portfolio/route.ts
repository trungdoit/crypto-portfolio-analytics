import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { TradeCsvSchema, PriceCsvSchema } from "@/lib/types";
import { parsePricesCsv, parseTradesCsv } from "@/lib/import";
import { computePortfolio } from "@/lib/portfolio";
import { portfolioToJson } from "@/lib/serialize";

const JsonRequestSchema = z.object({
  trades: z.array(TradeCsvSchema),
  prices: z.array(PriceCsvSchema),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if ("tradesCsv" in body && "pricesCsv" in body) {
      const parsedTrades = parseTradesCsv(body.tradesCsv);
      if (!parsedTrades.ok) {
        return NextResponse.json({ ok: false, errors: parsedTrades.errors }, { status: 400 });
      }
      const prices = parsePricesCsv(body.pricesCsv);
      const portfolio = computePortfolio(parsedTrades.trades, prices);
      return NextResponse.json({ ok: true, data: portfolioToJson(portfolio) }, { status: 200 });
    }
    // JSON arrays path
    const jsonParse = JsonRequestSchema.safeParse(body);
    if (!jsonParse.success) {
      return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
    }
    const tradesCsvLike = jsonParse.data.trades;
    const csvText = [
      "trade_id,timestamp,exchange,symbol,side,quantity,price_usd,fee_usd",
      ...tradesCsvLike.map(
        (r) => `${r.trade_id},${r.timestamp},${r.exchange},${r.symbol},${r.side},${r.quantity},${r.price_usd},${r.fee_usd}`
      ),
    ].join("\n");
    const parsedTrades = parseTradesCsv(csvText);
    if (!parsedTrades.ok) {
      return NextResponse.json({ ok: false, errors: parsedTrades.errors }, { status: 400 });
    }
    const pricesText = [
      "as_of,symbol,price_usd",
      ...jsonParse.data.prices.map((r) => `${r.as_of},${r.symbol},${r.price_usd}`),
    ].join("\n");
    const prices = parsePricesCsv(pricesText);
    const portfolio = computePortfolio(parsedTrades.trades, prices);
    return NextResponse.json({ ok: true, data: portfolioToJson(portfolio) }, { status: 200 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

