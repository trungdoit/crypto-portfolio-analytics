import Decimal from "decimal.js";

export function formatCurrency(d: Decimal | number | string): string {
  const v = d instanceof Decimal ? d.toNumber() : typeof d === "string" ? Number(d) : d;
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  return `${sign}$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatQuantity(d: Decimal | number | string, decimals = 8): string {
  const v = d instanceof Decimal ? d.toNumber() : typeof d === "string" ? Number(d) : d;
  return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

export function formatPercent(d: Decimal): string {
  return `${d.mul(100).toNumber().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

