import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { parsePricesCsv, parseTradesCsv } from "@/lib/import";
import { computePortfolio } from "@/lib/portfolio";
import { portfolioToJson } from "@/lib/serialize";
import path from "path";

export async function GET() {
  try {
    const tradesPath = path.join(process.cwd(), "data", "trades.csv");
    const pricesPath = path.join(process.cwd(), "data", "prices.csv");
    const [tradesCsv, pricesCsv] = await Promise.all([readFile(tradesPath, "utf8"), readFile(pricesPath, "utf8")]);
    const parsedTrades = parseTradesCsv(tradesCsv);
    if (!parsedTrades.ok) {
      return NextResponse.json({ ok: false, errors: parsedTrades.errors }, { status: 400 });
    }
    const prices = parsePricesCsv(pricesCsv);
    const portfolio = computePortfolio(parsedTrades.trades, prices);
    return NextResponse.json({ ok: true, data: portfolioToJson(portfolio) }, { status: 200 });
  } catch (e: unknown) {
    const message = typeof e === "object" && e && "message" in e ? String((e as any).message) : "Failed to load sample data";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

