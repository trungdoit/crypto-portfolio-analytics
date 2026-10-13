import { useEffect, useMemo, useState } from "react";
import { formatCurrency, formatPercent, formatQuantity } from "@/lib/format";
import { Trade } from "@/lib/types";
import { parseTradesCsv } from "@/lib/import";
import Decimal from "decimal.js";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AdjustmentsHorizontalIcon, ArrowDownTrayIcon, ArrowPathIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import type { PortfolioDTO } from "@/lib/serialize";

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioDTO | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [missingPrices, setMissingPrices] = useState<string[]>([]);
  const [pricesCsv, setPricesCsv] = useState<string | null>(null);
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [filters, setFilters] = useState<{ symbol: string; exchange: string; side: string; from: string; to: string }>({
    symbol: "ALL",
    exchange: "ALL",
    side: "ALL",
    from: "",
    to: "",
  });
  const [page, setPage] = useState(1);
  const pageSize = 20;

  async function loadSample() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sample", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Failed to load sample");
      setPortfolio(json.data);
      setAsOf(json.data.asOf);
      setMissingPrices(json.data.missingPriceSymbols ?? []);
      // Load sample CSVs too for transaction explorer and reset
      const [tCsv, pCsv] = await Promise.all([fetch("/data/trades.csv").then((r) => r.text()), fetch("/data/prices.csv").then((r) => r.text())]);
      setPricesCsv(pCsv);
      const parsed = parseTradesCsv(tCsv);
      if (parsed.ok) setTrades(parsed.trades);
      // Persist in localStorage to simulate "session"
      localStorage.setItem("portfolio.tradesCsv", tCsv);
      localStorage.setItem("portfolio.pricesCsv", pCsv);
      localStorage.setItem("portfolio.source", "sample");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setLoading(false);
      setPage(1);
    }
  }

  useEffect(() => {
    // Try to load from localStorage if present, else sample
    const savedTrades = localStorage.getItem("portfolio.tradesCsv");
    const savedPrices = localStorage.getItem("portfolio.pricesCsv");
    if (savedTrades) {
      // Recompute via API for deterministic server math
      fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradesCsv: savedTrades, pricesCsv: savedPrices ?? "" }),
      })
        .then((r) => r.json())
        .then((json) => {
          if (!json.ok) throw new Error(json.error ?? "Import failed");
          setPortfolio(json.data);
          setAsOf(json.data.asOf);
          setMissingPrices(json.data.missingPriceSymbols ?? []);
          const parsed = parseTradesCsv(savedTrades);
          if (parsed.ok) setTrades(parsed.trades);
          setError(null);
        })
        .catch((e) => setError(e.message || "Unexpected error"))
        .finally(() => setLoading(false));
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadSample();
    }
  }, []);

  async function handleImport(fileTrades: File | null, filePrices: File | null) {
    setError(null);
    if (!fileTrades) {
      setError("Please select a trades.csv file to import");
      return;
    }
    setLoading(true);
    try {
      const [tCsv, pCsv] = await Promise.all([fileTrades.text(), filePrices?.text() ?? Promise.resolve(pricesCsv ?? "")]);
      // Validate trades first
      const val = await fetch("/api/import/validate", { method: "POST", body: tCsv });
      const vjson = await val.json();
      if (!vjson.ok) {
        const first = vjson.errors?.[0]?.message ?? "Invalid CSV";
        throw new Error(first);
      }
      // Compute portfolio
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradesCsv: tCsv, pricesCsv: pCsv }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Import failed");
      setPortfolio(json.data);
      setAsOf(json.data.asOf);
      setMissingPrices(json.data.missingPriceSymbols ?? []);
      setPricesCsv(pCsv);
      const parsed = parseTradesCsv(tCsv);
      if (parsed.ok) setTrades(parsed.trades);
      localStorage.setItem("portfolio.tradesCsv", tCsv);
      localStorage.setItem("portfolio.pricesCsv", pCsv);
      localStorage.setItem("portfolio.source", "uploaded");
      setPage(1);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  function resetToSample() {
    localStorage.removeItem("portfolio.tradesCsv");
    localStorage.removeItem("portfolio.pricesCsv");
    localStorage.setItem("portfolio.source", "sample");
    loadSample();
  }

  const positions = useMemo(() => {
    if (!portfolio) return [];
    // Keep closed assets with nonzero realized P&L
    return portfolio.positions.filter((p) => new Decimal(p.quantity || "0").greaterThan(0) || !new Decimal(p.realizedPnL || "0").equals(0));
  }, [portfolio]);

  const allocationData = useMemo(
    () =>
      positions.map((p) => ({
        name: p.symbol,
        value: Number(new Decimal(p.value || "0").toFixed(2)),
      })),
    [positions]
  );

  const pnlByAsset = useMemo(
    () =>
      positions.map((p) => ({
        symbol: p.symbol,
        realized: Number(new Decimal(p.realizedPnL || "0").toFixed(2)),
        unrealized: Number(new Decimal(p.unrealizedPnL || "0").toFixed(2)),
      })),
    [positions]
  );

  const symbols = ["BTC", "ETH", "SOL", "CKB", "DOGE"] as const;
  const exchanges = ["Binance", "Coinbase"] as const;
  const sides = ["BUY", "SELL"] as const;
  type AssetSymbol = typeof symbols[number];
  type Exchange = typeof exchanges[number];
  type Side = typeof sides[number];

  const filteredTrades = useMemo(() => {
    if (!trades) return [];
    const { symbol, exchange, side, from, to } = filters;
    return trades
      .filter((t) => (symbol === "ALL" ? true : t.symbol === (symbol as AssetSymbol)))
      .filter((t) => (exchange === "ALL" ? true : t.exchange === (exchange as Exchange)))
      .filter((t) => (side === "ALL" ? true : t.side === (side as Side)))
      .filter((t) => (from ? t.timestamp >= new Date(from).toISOString() : true))
      .filter((t) => (to ? t.timestamp <= new Date(to).toISOString() : true))
      .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  }, [trades, filters]);

  const totalPages = Math.max(1, Math.ceil(filteredTrades.length / pageSize));
  const pageItems = filteredTrades.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="min-h-screen w-full bg-zinc-50 text-zinc-900">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">AI-Assisted Crypto Portfolio Analytics</h1>
          <div className="flex items-center gap-2">
            <button
              className="inline-flex items-center gap-2 rounded-md bg-black text-white px-3 py-2 text-sm hover:bg-zinc-800"
              onClick={() => resetToSample()}
              title="Reset to bundled sample data"
            >
              <ArrowPathIcon className="h-4 w-4" />
              Reset to sample
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        {/* Price as_of and importer */}
        <section className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-zinc-600">
              Price snapshot as of: <span className="font-medium">{asOf ?? "Unknown"}</span>
            </p>
            {missingPrices.length > 0 && (
              <p className="mt-1 inline-flex items-center gap-2 text-sm text-amber-700">
                <ExclamationTriangleIcon className="h-4 w-4" />
                Missing prices for: {missingPrices.join(", ")}
              </p>
            )}
          </div>
          <ImportControls onImport={handleImport} />
        </section>

        {/* Loading / error / empty states */}
        {loading && (
          <div className="flex items-center gap-2 text-zinc-600">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} fill="none" />
            </svg>
            Loading...
          </div>
        )}
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {portfolio && !loading && (
          <>
            {/* KPIs */}
            <section className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-6 mb-6">
              <Kpi title="Portfolio Value" value={formatCurrency(new Decimal(portfolio.totals.value))} positive />
              <Kpi title="Cost Basis" value={formatCurrency(new Decimal(portfolio.totals.costBasis))} />
              <Kpi
                title="Realized P&L"
                value={formatCurrency(new Decimal(portfolio.totals.realized))}
                positive={new Decimal(portfolio.totals.realized).greaterThanOrEqualTo(0)}
              />
              <Kpi
                title="Unrealized P&L"
                value={formatCurrency(new Decimal(portfolio.totals.unrealized))}
                positive={new Decimal(portfolio.totals.unrealized).greaterThanOrEqualTo(0)}
              />
              <Kpi
                title="Total P&L"
                value={formatCurrency(new Decimal(portfolio.totals.totalPnL))}
                positive={new Decimal(portfolio.totals.totalPnL).greaterThanOrEqualTo(0)}
              />
              <Kpi title="Total Fees" value={formatCurrency(new Decimal(portfolio.totals.fees))} />
            </section>

            {/* Holdings table */}
            <section className="mb-8">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Holdings</h2>
                <span className="text-xs text-zinc-600">Sign and arrow indicate gain/loss</span>
              </div>
              <div className="overflow-x-auto rounded-md border bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-zinc-50 text-left">
                    <tr>
                      <Th>Asset</Th>
                      <Th>Qty</Th>
                      <Th>Avg Cost</Th>
                      <Th>Price</Th>
                      <Th>Cost Basis</Th>
                      <Th>Value</Th>
                      <Th>Realized</Th>
                      <Th>Unrealized</Th>
                      <Th>Total P&L</Th>
                      <Th>Allocation</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p) => {
                      const pos = new Decimal(p.totalPnL || "0");
                      const icon = pos.isPositive() ? "▲" : pos.isNegative() ? "▼" : "•";
                      return (
                        <tr key={p.symbol} className="border-t">
                          <Td className="font-medium">{p.symbol}</Td>
                          <Td>{formatQuantity(new Decimal(p.quantity || "0"))}</Td>
                          <Td>{p.quantity === "0" ? "$0.00" : formatCurrency(new Decimal(p.averageCost || "0"))}</Td>
                          <Td>{p.currentPrice ? formatCurrency(new Decimal(p.currentPrice)) : "—"}</Td>
                          <Td>{formatCurrency(new Decimal(p.costBasis || "0"))}</Td>
                          <Td>{formatCurrency(new Decimal(p.value || "0"))}</Td>
                          <Td className={new Decimal(p.realizedPnL || "0").isNegative() ? "text-red-700" : "text-emerald-700"}>
                            {new Decimal(p.realizedPnL || "0").isNegative() ? "−" : "+"}
                            {formatCurrency(new Decimal(p.realizedPnL || "0").abs())} {icon}
                          </Td>
                          <Td className={new Decimal(p.unrealizedPnL || "0").isNegative() ? "text-red-700" : "text-emerald-700"}>
                            {new Decimal(p.unrealizedPnL || "0").isNegative() ? "−" : "+"}
                            {formatCurrency(new Decimal(p.unrealizedPnL || "0").abs())}
                          </Td>
                          <Td className={pos.isNegative() ? "text-red-700" : "text-emerald-700"}>
                            {pos.isNegative() ? "−" : "+"}
                            {formatCurrency(pos.abs())}
                          </Td>
                          <Td>{formatPercent(new Decimal(p.allocation || "0"))}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Charts */}
            <section className="grid grid-cols-1 gap-6 md:grid-cols-2 mb-10">
              <div className="rounded-md border bg-white p-4">
                <h3 className="mb-2 font-medium">Allocation by Value</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={allocationData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} />
                      <Tooltip formatter={(v: number, name) => [`$${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, name]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="rounded-md border bg-white p-4">
                <h3 className="mb-2 font-medium">Realized vs Unrealized P&L</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={pnlByAsset}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="symbol" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="realized" fill="#0ea5e9" />
                      <Bar dataKey="unrealized" fill="#10b981" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>

            {/* Transaction explorer */}
            <section className="mb-24">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Transaction Explorer</h2>
                <div className="flex items-center gap-2 text-sm text-zinc-600">
                  <AdjustmentsHorizontalIcon className="h-4 w-4" />
                  Filters
                </div>
              </div>
              <div className="mb-3 grid grid-cols-2 md:grid-cols-6 gap-2">
                <select
                  className="rounded-md border px-2 py-1 text-sm"
                  value={filters.symbol}
                  onChange={(e) => {
                    setFilters((f) => ({ ...f, symbol: e.target.value }));
                    setPage(1);
                  }}
                >
                  <option value="ALL">All assets</option>
                  {["BTC", "ETH", "SOL", "CKB", "DOGE"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  className="rounded-md border px-2 py-1 text-sm"
                  value={filters.exchange}
                  onChange={(e) => {
                    setFilters((f) => ({ ...f, exchange: e.target.value }));
                    setPage(1);
                  }}
                >
                  <option value="ALL">All exchanges</option>
                  {["Binance", "Coinbase"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  className="rounded-md border px-2 py-1 text-sm"
                  value={filters.side}
                  onChange={(e) => {
                    setFilters((f) => ({ ...f, side: e.target.value }));
                    setPage(1);
                  }}
                >
                  <option value="ALL">All sides</option>
                  {["BUY", "SELL"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  className="rounded-md border px-2 py-1 text-sm"
                  value={filters.from}
                  onChange={(e) => {
                    setFilters((f) => ({ ...f, from: e.target.value }));
                    setPage(1);
                  }}
                />
                <input
                  type="date"
                  className="rounded-md border px-2 py-1 text-sm"
                  value={filters.to}
                  onChange={(e) => {
                    setFilters((f) => ({ ...f, to: e.target.value }));
                    setPage(1);
                  }}
                />
                <div className="flex items-center justify-end">
                  <button
                    className="rounded-md border px-2 py-1 text-sm"
                    onClick={() => {
                      setFilters({ symbol: "ALL", exchange: "ALL", side: "ALL", from: "", to: "" });
                      setPage(1);
                    }}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto rounded-md border bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-zinc-50 text-left">
                    <tr>
                      <Th>ID</Th>
                      <Th>Time</Th>
                      <Th>Exchange</Th>
                      <Th>Asset</Th>
                      <Th>Side</Th>
                      <Th>Qty</Th>
                      <Th>Price</Th>
                      <Th>Gross</Th>
                      <Th>Fee</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((t) => {
                      const gross = t.quantity.mul(t.priceUsd);
                      return (
                        <tr key={t.tradeId} className="border-t">
                          <Td className="font-mono">{t.tradeId}</Td>
                          <Td>{new Date(t.timestamp).toLocaleString()}</Td>
                          <Td>{t.exchange}</Td>
                          <Td>{t.symbol}</Td>
                          <Td className={t.side === "BUY" ? "text-emerald-700" : "text-blue-700"}>{t.side}</Td>
                          <Td>{formatQuantity(t.quantity)}</Td>
                          <Td>{formatCurrency(t.priceUsd)}</Td>
                          <Td>{formatCurrency(gross)}</Td>
                          <Td>{formatCurrency(t.feeUsd)}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm text-zinc-600">
                  Page {page} of {totalPages} • {filteredTrades.length} transactions
                </span>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-md border px-2 py-1 text-sm disabled:opacity-50"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    Prev
                  </button>
                  <button
                    className="rounded-md border px-2 py-1 text-sm disabled:opacity-50"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>
          </>
        )}
      </main>
      <footer className="border-t bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 text-xs text-zinc-500">
          Built for the take-home assessment. No live prices or accounts; sample data bundled. Import is client-side and ephemeral.
        </div>
      </footer>
    </div>
  );
}

function Kpi({ title, value, positive = true }: { title: string; value: string; positive?: boolean }) {
  return (
    <div className="rounded-md border bg-white p-3">
      <div className="text-xs text-zinc-600">{title}</div>
      <div className={`mt-1 text-lg font-semibold ${positive ? "text-emerald-700" : "text-red-700"}`}>{value}</div>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-600 ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}

function ImportControls({ onImport }: { onImport: (trades: File | null, prices: File | null) => void }) {
  const [tradesFile, setTradesFile] = useState<File | null>(null);
  const [pricesFile, setPricesFile] = useState<File | null>(null);
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <label className="flex items-center gap-2 text-sm">
        <ArrowDownTrayIcon className="h-4 w-4" />
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setTradesFile(e.target.files?.[0] ?? null)}
          aria-label="Upload trades CSV"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <ArrowDownTrayIcon className="h-4 w-4" />
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setPricesFile(e.target.files?.[0] ?? null)}
          aria-label="Upload prices CSV (optional)"
        />
      </label>
      <button
        className="rounded-md bg-black px-3 py-2 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
        onClick={() => onImport(tradesFile, pricesFile)}
        disabled={!tradesFile}
      >
        Import
      </button>
    </div>
  );
}
