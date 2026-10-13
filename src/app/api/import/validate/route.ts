import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { parseTradesCsv } from "@/lib/import";

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const parsed = parseTradesCsv(body);
    if (parsed.ok) {
      return NextResponse.json({ ok: true, count: parsed.trades.length }, { status: 200 });
    } else {
      return NextResponse.json({ ok: false, errors: parsed.errors }, { status: 400 });
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

