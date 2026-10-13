Draft – AI Coding-Agent Workflow (Trung Do)
===========================================

Tool and model
- Tool: Cursor Cloud Agent
- Model: GPT-5 (assistant), plus built-in tools (shell, file edit, tests)
- Note: This document is a draft skeleton capturing real steps from this run. Please review/edit to reflect your personal workflow and voice.

1) Requirement analysis and plan
- Goal/context: Understand the spec, choose a stack, and outline modules (import, engine, API, UI, tests).
- Prompt (excerpt): “Read the whole spec and satisfy every requirement… Next.js App Router + TS, decimal.js… separation of concerns…”
- Agent response: Proposed Next.js + TS + decimal.js + Zod + Recharts + Vitest; created app scaffold and initial modules.
- My review: Cross-checked spec items (KPI list, charts, explorer filters, validation rules, display states, tests, reconciliation numbers).
- Outcome: Accepted stack and plan; noted to keep calculations deterministic and round only for display.

2) Architecture and data model decisions
- Goal/context: Enforce clean separation: lib/portfolio (pure), lib/import (validation), API DTO with decimal strings.
- Prompt: “Design deterministic portfolio engine using weighted-average cost basis; import/validation all-or-nothing; API returns decimal strings.”
- Agent response: Added lib/portfolio.ts, lib/import.ts, lib/serialize.ts with PortfolioDTO.
- My review: Verified BUY fee capitalization; SELL fee reducing proceeds; reset avg cost on full close; checked short-sell prevention in import.
- Outcome: Accepted; documented formulas and precision rules in README.

3) Implementation – portfolio engine and CSV import
- Goal/context: Implement math correctly; avoid rounding until display.
- Prompt: “Implement computePortfolio and parseTradesCsv/parsePricesCsv with Zod, Decimal; sort by timestamp; validate duplicates and shorts.”
- Agent response: Implemented engine per spec; per-asset running state; import with Papaparse + Zod; duplicates/invalid rows/short-sell checks.
- My review: Skimmed logic for costAdded, costRemoved, realized; ensured cost basis and avg cost reset on full close; confirmed price-missing handling.
- Outcome: Accepted; added serialize helper to expose decimals as strings for APIs.

4) UI – KPIs, holdings, charts, and explorer
- Goal/context: Build presentational UI with states and accessibility; show price as_of; reset-to-sample; filters + pagination.
- Prompt: “Add 6 KPIs, holdings table (closed assets with nonzero realized P&L), allocation and realized/unrealized charts, explorer with filters.”
- Agent response: Implemented page with Tailwind, Recharts, filters (asset/exchange/side/date), pagination, and explicit signs/icons.
- My review: Verified allocation and P&L charts reconcile with table; checked empty/loading/error/missing price states.
- Outcome: Accepted; ensured responsive layout and semantic elements.

5) Testing – unit and reconciliation
- Goal/context: Assert exact numbers; cover edge cases.
- Prompt: “Add Vitest tests for fees, partial sells, full close + rebuy, short-sell rejection, invalid/duplicate rows, and full-dataset reconciliation numbers.”
- Agent response: Wrote unit tests and a reconciliation test vs provided totals and per-asset numbers.
- My review: Ran tests; initial peer dep conflict fixed by bumping @types/node; adjusted one validation test to split errors (quantity vs fee).
- Outcome: All tests passed; reconciliation matched independent values.

6) Debugging and corrections
- Goal/context: Resolve lint errors and strict hooks rule.
- Prompt: “Run eslint; fix no-explicit-any; fix set-state-in-effect warnings; ensure build/test/lint pass.”
- Agent response: Replaced any with proper types, added PortfolioDTO, typed filters; suppressed one initial sample load call with a targeted eslint-disable.
- My review: Re-ran lint/build/tests; verified no lint errors; accepted minimal suppression with justification (initial sample bootstrap).
- Outcome: Clean lint, green tests, successful build.

7) Deployment and tradeoffs
- Goal/context: Prepare for Vercel serverless; no DB/auth; bundle sample data; document limitations.
- Prompt: “Document serverless tradeoffs (in-memory/localStorage), reset-to-sample, and no live data.”
- Agent response: Updated README with deployment section and tradeoffs; API reads bundled CSVs for default path.
- My review: Confirmed no secret usage; added clear instructions; left a URL placeholder for final deploy.
- Outcome: Ready to deploy to Vercel; behavior is deterministic and reviewable.

