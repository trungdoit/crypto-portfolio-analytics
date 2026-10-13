"use client";
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
  Cell,
} from "recharts";
import {
  AdjustmentsHorizontalIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  CircleStackIcon,
} from "@heroicons/react/24/outline";
import type { PortfolioDTO, PositionHistoryEntryDTO } from "@/lib/serialize";
import { colorForAsset, withAlpha } from "@/lib/colors";
import { resolvePositions } from "@/lib/positionEngine";

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioDTO | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [missingPrices, setMissingPrices] = useState<string[]>([]);
  const [pricesCsv, setPricesCsv] = useState<string | null>(null);
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [history, setHistory] = useState<PositionHistoryEntryDTO[] | null>(null);
  const [loadedSource, setLoadedSource] = useState<"sample" | "uploaded">("sample");
  const [loadedTradesName, setLoadedTradesName] = useState<string>("trades.csv");
  const [loadedPricesName, setLoadedPricesName] = useState<string>("prices.csv");
  const [importedAt, setImportedAt] = useState<string | null>(null);
  const [tradesFile, setTradesFile] = useState<File | null>(null);
  const [pricesFile, setPricesFile] = useState<File | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [filters, setFilters] = useState<{ symbol: string; exchange: string; side: string; from: string; to: string }>({
    symbol: "ALL",
    exchange: "ALL",
    side: "ALL",
    from: "",
    to: "",
  });
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [activeTab, setActiveTab] = useState<"positions" | "transactions">("positions");
  const [posFilters, setPosFilters] = useState<{ status: "ALL" | "OPEN" | "CLOSED"; symbol: string }>({
    status: "ALL",
    symbol: "ALL",
  });
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);

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
      setHistory(json.history ?? null);
      // Load sample CSVs too for transaction explorer and reset
      const [tCsv, pCsv] = await Promise.all([fetch("/data/trades.csv").then((r) => r.text()), fetch("/data/prices.csv").then((r) => r.text())]);
      setPricesCsv(pCsv);
      const parsed = parseTradesCsv(tCsv);
      if (parsed.ok) setTrades(parsed.trades);
      // Persist in localStorage to simulate "session"
      localStorage.setItem("portfolio.tradesCsv", tCsv);
      localStorage.setItem("portfolio.pricesCsv", pCsv);
      localStorage.setItem("portfolio.source", "sample");
      const nowIso = new Date().toISOString();
      localStorage.setItem("portfolio.tradesFileName", "trades.csv");
      localStorage.setItem("portfolio.pricesFileName", "prices.csv");
      localStorage.setItem("portfolio.importedAt", nowIso);
      setLoadedSource("sample");
      setLoadedTradesName("trades.csv");
      setLoadedPricesName("prices.csv");
      setImportedAt(nowIso);
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
    const savedSource = (localStorage.getItem("portfolio.source") as "sample" | "uploaded" | null) ?? null;
    const savedTradesName = localStorage.getItem("portfolio.tradesFileName");
    const savedPricesName = localStorage.getItem("portfolio.pricesFileName");
    const savedImportedAt = localStorage.getItem("portfolio.importedAt");
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
          setHistory(json.history ?? null);
          const parsed = parseTradesCsv(savedTrades);
          if (parsed.ok) setTrades(parsed.trades);
          setError(null);
          if (savedSource) setLoadedSource(savedSource);
          if (savedTradesName) setLoadedTradesName(savedTradesName);
          if (savedPricesName) setLoadedPricesName(savedPricesName);
          if (savedImportedAt) setImportedAt(savedImportedAt);
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
      setHistory(json.history ?? null);
      setPricesCsv(pCsv);
      const parsed = parseTradesCsv(tCsv);
      if (parsed.ok) setTrades(parsed.trades);
      localStorage.setItem("portfolio.tradesCsv", tCsv);
      localStorage.setItem("portfolio.pricesCsv", pCsv);
      localStorage.setItem("portfolio.source", "uploaded");
      const nowIso = new Date().toISOString();
      localStorage.setItem("portfolio.tradesFileName", fileTrades?.name ?? "trades.csv");
      localStorage.setItem("portfolio.pricesFileName", filePrices?.name ?? "prices.csv");
      localStorage.setItem("portfolio.importedAt", nowIso);
      setLoadedSource("uploaded");
      setLoadedTradesName(fileTrades?.name ?? "trades.csv");
      setLoadedPricesName(filePrices?.name ?? "prices.csv");
      setImportedAt(nowIso);
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

  // Build a prices snapshot for the client positions engine from the portfolio DTO
  const clientPrices = useMemo(() => {
    const map: Record<"BTC" | "ETH" | "SOL" | "CKB" | "DOGE", Decimal | undefined> = {
      BTC: undefined,
      ETH: undefined,
      SOL: undefined,
      CKB: undefined,
      DOGE: undefined,
    };
    if (portfolio) {
      for (const p of portfolio.positions) {
        const cp = p.currentPrice ? new Decimal(p.currentPrice) : undefined;
        // @ts-ignore DTO symbol is compatible with keys
        map[p.symbol] = cp;
      }
    }
    return {
      asOf,
      pricesBySymbol: map,
      missingSymbols: (portfolio?.missingPriceSymbols ?? []) as Array<"BTC" | "ETH" | "SOL" | "CKB" | "DOGE">,
    };
  }, [portfolio, asOf]);

  const lifecyclePositions = useMemo(() => {
    if (!trades || !portfolio) return [];
    return resolvePositions(trades, clientPrices);
  }, [trades, portfolio, clientPrices]);

  const filteredLifecyclePositions = useMemo(() => {
    return lifecyclePositions
      .filter((p) => (posFilters.status === "ALL" ? true : p.status === posFilters.status))
      .filter((p) => (posFilters.symbol === "ALL" ? true : p.asset === (posFilters.symbol as any)));
  }, [lifecyclePositions, posFilters]);

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

  type AssetSymbol = "BTC" | "ETH" | "SOL" | "CKB" | "DOGE";
  type Exchange = "Binance" | "Coinbase";
  type Side = "BUY" | "SELL";

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
  const historyMap = useMemo(() => {
    const m = new Map<string, PositionHistoryEntryDTO>();
    if (!history) return m;
    for (const e of history) m.set(e.tradeId, e);
    return m;
  }, [history]);
  const totalsForFilter = useMemo(() => {
    const gross = filteredTrades.reduce((acc, t) => acc.add(t.quantity.mul(t.priceUsd)), new Decimal(0));
    const fees = filteredTrades.reduce((acc, t) => acc.add(t.feeUsd), new Decimal(0));
    return { gross, fees };
  }, [filteredTrades]);

  return (
    <div className="min-h-screen w-full bg-zinc-50 text-zinc-900">
      <header className="sticky top-0 z-40 border-b bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/70">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-6">Crypto Portfolio Analytics</h1>
            <p className="mt-0.5 text-[11px] text-zinc-600">
              Price snapshot as of: <span className="font-mono">{asOf ?? "Unknown"}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="group relative inline-flex items-center gap-2 rounded-md border bg-zinc-50 px-3 text-xs text-zinc-800 h-9 max-w-[40vw] truncate"
              title={loadedSource === "sample" ? "Bundled sample data" : loadedTradesName}
              aria-label={`Data source: ${loadedSource === "sample" ? "Sample" : loadedTradesName}`}
            >
              <CircleStackIcon className="h-4 w-4 text-zinc-500" aria-hidden="true" />
              <span className="truncate">
                Data: {loadedSource === "sample" ? "Sample" : loadedTradesName}
              </span>
              <span
                className={`ml-1 inline-block h-2 w-2 rounded-full ${
                  loadedSource === "sample" ? "bg-zinc-400" : "bg-emerald-500"
                }`}
                aria-hidden="true"
              />
            </span>
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border text-sm hover:bg-zinc-50 active:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600 focus-visible:ring-offset-2"
              onClick={() => setInfoOpen(true)}
              title="About and rules"
              aria-haspopup="dialog"
              aria-label="Info"
            >
              <InformationCircleIcon className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md bg-black text-white px-3 text-sm hover:bg-zinc-800 active:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-700 focus-visible:ring-offset-2"
              onClick={() => setImportOpen(true)}
              title="Open import dialog"
              aria-haspopup="dialog"
              aria-label="Import data"
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Import data</span>
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        {/* Modal trigger and indicators are in the header */}

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
              <Kpi title="Portfolio Value" value={formatCurrency(new Decimal(portfolio.totals.value || "0"))} positive />
              <Kpi title="Cost Basis" value={formatCurrency(new Decimal(portfolio.totals.costBasis || "0"))} />
              <Kpi
                title="Realized P&L"
                value={formatCurrency(new Decimal(portfolio.totals.realized || "0"))}
                positive={new Decimal(portfolio.totals.realized || "0").greaterThanOrEqualTo(0)}
              />
              <Kpi
                title="Unrealized P&L"
                value={formatCurrency(new Decimal(portfolio.totals.unrealized || "0"))}
                positive={new Decimal(portfolio.totals.unrealized || "0").greaterThanOrEqualTo(0)}
              />
              <Kpi
                title="Total P&L"
                value={formatCurrency(new Decimal(portfolio.totals.totalPnL || "0"))}
                positive={new Decimal(portfolio.totals.totalPnL || "0").greaterThanOrEqualTo(0)}
              />
              <Kpi title="Total Fees" value={formatCurrency(new Decimal(portfolio.totals.fees || "0"))} />
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
                      <Pie data={allocationData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                        {allocationData.map((entry) => (
                          // Stable color per asset
                          <Cell key={entry.name} fill={colorForAsset(entry.name)} />
                        ))}
                      </Pie>
                      <Legend />
                      <Tooltip />
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
                      <Bar dataKey="realized">
                        {pnlByAsset.map((entry) => (
                          <Cell key={`realized-${entry.symbol}`} fill={colorForAsset(entry.symbol)} />
                        ))}
                      </Bar>
                      <Bar dataKey="unrealized">
                        {pnlByAsset.map((entry) => (
                          <Cell key={`unrealized-${entry.symbol}`} fill={withAlpha(colorForAsset(entry.symbol), 0.45)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>

            {/* Tabs: Positions | Transactions */}
            <section className="mb-24">
              <div className="mb-3 flex items-center gap-2">
                <button
                  className={`rounded-md border px-3 py-1.5 text-sm ${activeTab === "positions" ? "bg-black text-white border-black" : "bg-white hover:bg-zinc-50"}`}
                  onClick={() => setActiveTab("positions")}
                >
                  Positions
                </button>
                <button
                  className={`rounded-md border px-3 py-1.5 text-sm ${activeTab === "transactions" ? "bg-black text-white border-black" : "bg-white hover:bg-zinc-50"}`}
                  onClick={() => setActiveTab("transactions")}
                >
                  Transactions
                </button>
              </div>
              {activeTab === "positions" ? (
                <>
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-lg font-semibold">Positions</h2>
                    <div className="flex items-center gap-2">
                      <select
                        className="rounded-md border px-2 py-1 text-sm"
                        value={posFilters.status}
                        onChange={(e) => setPosFilters((f) => ({ ...f, status: e.target.value as any }))}
                      >
                        <option value="ALL">All</option>
                        <option value="OPEN">Open</option>
                        <option value="CLOSED">Closed</option>
                      </select>
                      <select
                        className="rounded-md border px-2 py-1 text-sm"
                        value={posFilters.symbol}
                        onChange={(e) => setPosFilters((f) => ({ ...f, symbol: e.target.value }))}
                      >
                        <option value="ALL">All assets</option>
                        {["BTC", "ETH", "SOL", "CKB", "DOGE"].map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-md border bg-white">
                    <table className="min-w-full text-sm">
                      <thead className="bg-zinc-50 text-left">
                        <tr>
                          <Th>Status</Th>
                          <Th>Asset</Th>
                          <Th>Opened</Th>
                          <Th>Closed</Th>
                          <Th>Trades</Th>
                          <Th>Current Qty</Th>
                          <Th>Peak Qty</Th>
                          <Th>Avg Cost</Th>
                          <Th>Cost Basis</Th>
                          <Th>Realized</Th>
                          <Th>Unrealized</Th>
                          <Th>Fees</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLifecyclePositions.map((p) => {
                          const statusClass =
                            p.status === "OPEN"
                              ? "inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-600/20"
                              : "inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700 ring-1 ring-zinc-400/30";
                          return (
                            <tr
                              key={p.id}
                              className="border-t hover:bg-zinc-50 cursor-pointer"
                              onClick={() => setSelectedPositionId(p.id)}
                            >
                              <Td>
                                <span className={statusClass}>{p.status}</span>
                              </Td>
                              <Td className="font-medium">{p.asset}</Td>
                              <Td>{new Date(p.openedAt).toLocaleString()}</Td>
                              <Td>{p.closedAt ? new Date(p.closedAt).toLocaleString() : "—"}</Td>
                              <Td className="text-center">{p.tradeCount}</Td>
                              <Td>{formatQuantity(p.currentQuantity)}</Td>
                              <Td>{formatQuantity(p.peakQuantity)}</Td>
                              <Td>{formatCurrency(p.averageCost)}</Td>
                              <Td>{formatCurrency(p.costBasis)}</Td>
                              <Td className={p.realizedPnL.isNegative() ? "text-red-700" : "text-emerald-700"}>
                                {p.realizedPnL.isNegative() ? "−" : "+"}
                                {formatCurrency(p.realizedPnL.abs())}
                              </Td>
                              <Td className={p.unrealizedPnL.isNegative() ? "text-red-700" : "text-emerald-700"}>
                                {p.unrealizedPnL.isNegative() ? "−" : "+"}
                                {formatCurrency(p.unrealizedPnL.abs())}
                              </Td>
                              <Td>{formatCurrency(p.totalFees)}</Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <>
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
                          <Th>Realized P&amp;L</Th>
                          <Th>Avg cost after</Th>
                          <Th>Qty after</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageItems.map((t) => {
                          const gross = t.quantity.mul(t.priceUsd);
                          const h = historyMap.get(t.tradeId) || null;
                          const realized = h ? new Decimal(h.realizedPnl) : new Decimal(0);
                          const avgAfter = h ? new Decimal(h.avgCostAfter) : null;
                          const qtyAfter = h ? new Decimal(h.qtyAfter) : null;
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
                              <Td className={t.side === "SELL" && realized.isNegative() ? "text-red-700" : "text-emerald-700"}>
                                {t.side === "SELL" ? formatCurrency(realized) : "—"}
                              </Td>
                              <Td>{avgAfter ? formatCurrency(avgAfter) : "—"}</Td>
                              <Td>{qtyAfter ? formatQuantity(qtyAfter) : "—"}</Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-sm text-zinc-600">Page {page} of {totalPages} • {filteredTrades.length} transactions</span>
                    <span className="text-sm text-zinc-700">
                      Total (filtered): Gross {formatCurrency(totalsForFilter.gross)} • Fees {formatCurrency(totalsForFilter.fees)}
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
                </>
              )}
            </section>
          </>
        )}
      </main>
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        state={{
          loadedSource,
          loadedTradesName,
          loadedPricesName,
          trades,
          importedAt,
          asOf,
          missingPrices,
          tradesFile,
          pricesFile,
        }}
        setState={{
          setTradesFile,
          setPricesFile,
        }}
        onImport={handleImport}
        onReset={resetToSample}
        error={error}
      />
      <InfoModal open={infoOpen} onClose={() => setInfoOpen(false)} />
      <PositionModal
        open={selectedPositionId != null}
        onClose={() => setSelectedPositionId(null)}
        position={lifecyclePositions.find((p) => p.id === selectedPositionId) ?? null}
      />
      <footer className="border-t bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 text-xs text-zinc-500">
          Built for the take-home assessment. No live prices or accounts; sample data bundled. Import is client-side and ephemeral.
        </div>
      </footer>
    </div>
  );
}

function ImportModal({
  open,
  onClose,
  state,
  setState,
  onImport,
  onReset,
  error,
}: {
  open: boolean;
  onClose: () => void;
  state: {
    loadedSource: "sample" | "uploaded";
    loadedTradesName: string;
    loadedPricesName: string;
    trades: Trade[] | null;
    importedAt: string | null;
    asOf: string | null;
    missingPrices: string[];
    tradesFile: File | null;
    pricesFile: File | null;
  };
  setState: {
    setTradesFile: (f: File | null) => void;
    setPricesFile: (f: File | null) => void;
  };
  onImport: (t: File | null, p: File | null) => void;
  onReset: () => void;
  error: string | null;
}) {
  const containerId = "import-dialog-title";
  useEffect(() => {
    if (open) {
      document.body.classList.add("overflow-hidden");
    } else {
      document.body.classList.remove("overflow-hidden");
    }
    return () => document.body.classList.remove("overflow-hidden");
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab") {
        // trap focus
        const modal = document.getElementById("import-modal");
        if (!modal) return;
        const focusables = modal.querySelectorAll<HTMLElement>(
          'a[href], button, textarea, input[type="text"], input[type="file"], input[type="date"], select, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            last.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === last) {
            first.focus();
            e.preventDefault();
          }
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={containerId}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        id="import-modal"
        className="relative z-10 w-[95%] max-w-3xl rounded-md border bg-white p-4 shadow-lg outline-none"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id={containerId} className="text-lg font-semibold">
            Import data
          </h2>
          <button
            className="rounded-md border px-2 py-1 text-sm hover:bg-zinc-50"
            onClick={onClose}
            aria-label="Close import dialog"
          >
            Close
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-zinc-600">Data source</dt>
              <dd className="font-medium">
                {state.loadedSource === "sample" ? "Bundled sample" : "Uploaded"}
              </dd>
              <dt className="text-zinc-600">Trades file</dt>
              <dd className="font-mono truncate" title={state.loadedTradesName}>
                {state.loadedTradesName}
              </dd>
              <dt className="text-zinc-600">Prices file</dt>
              <dd className="font-mono truncate" title={state.loadedPricesName}>
                {state.loadedPricesName}
              </dd>
              <dt className="text-zinc-600">Rows</dt>
              <dd className="font-medium">{state.trades ? state.trades.length : "—"}</dd>
              <dt className="text-zinc-600">Imported at</dt>
              <dd className="font-mono">
                {state.importedAt ? new Date(state.importedAt).toLocaleString() : "—"}
              </dd>
              <dt className="text-zinc-600">Price as_of</dt>
              <dd className="font-mono">{state.asOf ?? "Unknown"}</dd>
            </dl>
            {state.missingPrices.length > 0 && (
              <p className="mt-2 inline-flex items-center gap-2 text-sm text-amber-700">
                <ExclamationTriangleIcon className="h-4 w-4" />
                Missing prices for: {state.missingPrices.join(", ")}
              </p>
            )}
            {error && (
              <div
                role="alert"
                aria-live="polite"
                className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800"
              >
                {error}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Trades CSV</span>
              <div className="flex items-center gap-2">
                <ArrowDownTrayIcon className="h-4 w-4" />
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => setState.setTradesFile(e.target.files?.[0] ?? null)}
                  aria-label="Upload trades CSV"
                />
              </div>
              <span className="text-xs text-zinc-600 truncate" aria-live="polite" title={state.tradesFile?.name}>
                {state.tradesFile ? `Selected: ${state.tradesFile.name}` : "No trades file selected"}
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Prices CSV (optional)</span>
              <div className="flex items-center gap-2">
                <ArrowDownTrayIcon className="h-4 w-4" />
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => setState.setPricesFile(e.target.files?.[0] ?? null)}
                  aria-label="Upload prices CSV (optional)"
                />
              </div>
              <span className="text-xs text-zinc-600 truncate" aria-live="polite" title={state.pricesFile?.name}>
                {state.pricesFile ? `Selected: ${state.pricesFile.name}` : "No prices file selected"}
              </span>
            </label>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded-md bg-black px-3 py-2 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
              onClick={() => onImport(state.tradesFile, state.pricesFile)}
              disabled={!state.tradesFile}
            >
              Import
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-zinc-50"
              onClick={onReset}
              title="Reset to bundled sample data"
            >
              <ArrowPathIcon className="h-4 w-4" />
              Reset to sample
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <a
              className="rounded-md border px-2 py-1 hover:bg-zinc-50"
              href="/data/trades.csv"
              download
              aria-label="Download sample trades.csv"
            >
              Download sample trades.csv
            </a>
            <a
              className="rounded-md border px-2 py-1 hover:bg-zinc-50"
              href="/data/prices.csv"
              download
              aria-label="Download sample prices.csv"
            >
              Download sample prices.csv
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const titleId = "info-dialog-title";
  useEffect(() => {
    if (open) document.body.classList.add("overflow-hidden");
    else document.body.classList.remove("overflow-hidden");
    return () => document.body.classList.remove("overflow-hidden");
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab") {
        const modal = document.getElementById("info-modal");
        if (!modal) return;
        const focusables = modal.querySelectorAll<HTMLElement>(
          'a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            last.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === last) {
            first.focus();
            e.preventDefault();
          }
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div id="info-modal" className="relative z-10 w-[95%] max-w-2xl rounded-md border bg-white p-4 shadow-lg outline-none">
        <div className="mb-3 flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold">
            About & Calculation Rules
          </h2>
          <button className="rounded-md border px-2 py-1 text-sm hover:bg-zinc-50" onClick={onClose} aria-label="Close info dialog">
            Close
          </button>
        </div>
        <div className="prose prose-zinc max-w-none text-sm">
          <p className="m-0">
            This app shows portfolio holdings and P&L using weighted‑average cost basis. All math uses Decimal for precision; API returns decimal strings.
            Values are rounded only for display (currency 2dp, quantity up to 8dp, percent 2dp).
          </p>
          <h3 className="mt-3 mb-1 text-base font-medium">Processing</h3>
          <ul className="mt-0 mb-2 list-disc pl-5">
            <li>Per‑asset, in ascending timestamp order</li>
            <li>Weighted‑average cost basis</li>
          </ul>
          <h3 className="mt-3 mb-1 text-base font-medium">BUY</h3>
          <ul className="mt-0 mb-2 list-disc pl-5">
            <li>gross = quantity × price</li>
            <li>cost added = gross + fee (fee capitalized)</li>
            <li>new quantity = prev qty + buy qty</li>
            <li>new cost basis = prev cost basis + cost added</li>
            <li>average cost = new cost basis ÷ new quantity</li>
          </ul>
          <h3 className="mt-3 mb-1 text-base font-medium">SELL</h3>
          <ul className="mt-0 mb-2 list-disc pl-5">
            <li>gross proceeds = quantity × price</li>
            <li>net proceeds = gross − fee</li>
            <li>cost removed = average cost (before sale) × sell qty</li>
            <li>realized P&amp;L = net proceeds − cost removed</li>
            <li>avg cost unchanged for remainder; on full close, qty and cost basis reset to 0</li>
          </ul>
          <h3 className="mt-3 mb-1 text-base font-medium">Current valuation</h3>
          <ul className="mt-0 mb-2 list-disc pl-5">
            <li>value = qty × current price</li>
            <li>unrealized = value − cost basis</li>
            <li>total P&amp;L = realized + unrealized</li>
            <li>allocation = asset value ÷ portfolio value</li>
            <li>total fees = sum of all BUY + SELL fees</li>
          </ul>
          <h3 className="mt-3 mb-1 text-base font-medium">Import validation</h3>
          <ul className="mt-0 mb-0 list-disc pl-5">
            <li>Required columns present; timestamps valid</li>
            <li>Supported exchange, symbol, side</li>
            <li>Quantity &gt; 0, price &gt; 0; fee ≥ 0</li>
            <li>trade_id unique; SELL never exceeds available qty</li>
            <li>All‑or‑nothing: any error aborts import</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function PositionModal({
  open,
  onClose,
  position,
}: {
  open: boolean;
  onClose: () => void;
  position: ReturnType<typeof resolvePositions>[number] | null;
}) {
  const titleId = "position-dialog-title";
  useEffect(() => {
    if (open) document.body.classList.add("overflow-hidden");
    else document.body.classList.remove("overflow-hidden");
    return () => document.body.classList.remove("overflow-hidden");
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || !position) return null;
  const statusClass =
    position.status === "OPEN"
      ? "inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-600/20"
      : "inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700 ring-1 ring-zinc-400/30";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-[95%] max-w-4xl rounded-md border bg-white p-4 shadow-lg outline-none">
        <div className="mb-3 flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold">
            {position.asset} Position <span className={statusClass}>&nbsp;{position.status}</span>
          </h2>
          <button className="rounded-md border px-2 py-1 text-sm hover:bg-zinc-50" onClick={onClose} aria-label="Close position dialog">
            Close
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 mb-3">
          <Kpi title="Opened" value={new Date(position.openedAt).toLocaleString()} />
          <Kpi title="Closed" value={position.closedAt ? new Date(position.closedAt).toLocaleString() : "—"} />
          <Kpi title="Trades" value={String(position.tradeCount)} />
          <Kpi title="Peak Qty" value={formatQuantity(position.peakQuantity)} />
          <Kpi title="Current Qty" value={formatQuantity(position.currentQuantity)} />
          <Kpi title="Avg Cost" value={formatCurrency(position.averageCost)} />
          <Kpi title="Cost Basis" value={formatCurrency(position.costBasis)} />
          <Kpi title="Realized" value={formatCurrency(position.realizedPnL)} positive={position.realizedPnL.greaterThanOrEqualTo(0)} />
        </div>
        <div className="overflow-x-auto rounded-md border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-left">
              <tr>
                <Th>Date</Th>
                <Th>Side</Th>
                <Th>Qty</Th>
                <Th>Price</Th>
                <Th>Fee</Th>
                <Th>Qty After</Th>
                <Th>Avg Cost After</Th>
                <Th>Realized (Δ)</Th>
                <Th>Cumulative Realized</Th>
              </tr>
            </thead>
            <tbody>
              {position.trades.map((t) => (
                <tr key={t.tradeId} className="border-t">
                  <Td>{new Date(t.timestamp).toLocaleString()}</Td>
                  <Td className={t.side === "BUY" ? "text-emerald-700" : "text-blue-700"}>{t.side}</Td>
                  <Td>{formatQuantity(t.quantity)}</Td>
                  <Td>{formatCurrency(t.priceUsd)}</Td>
                  <Td>{formatCurrency(t.feeUsd)}</Td>
                  <Td>{formatQuantity(t.afterQuantity)}</Td>
                  <Td>{formatCurrency(t.afterAverageCost)}</Td>
                  <Td className={t.realizedDelta.isNegative() ? "text-red-700" : "text-emerald-700"}>
                    {t.realizedDelta.isNegative() ? "−" : "+"}
                    {formatCurrency(t.realizedDelta.abs())}
                  </Td>
                  <Td className={t.cumulativeRealized.isNegative() ? "text-red-700" : "text-emerald-700"}>
                    {t.cumulativeRealized.isNegative() ? "−" : "+"}
                    {formatCurrency(t.cumulativeRealized.abs())}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
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

// end
