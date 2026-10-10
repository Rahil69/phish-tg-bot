export const FALLBACK_USD_MVR_RATE = 15.42;

export function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
export function monthDate(key) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1, 12);
}
export function moveMonth(key, offset) {
  const date = monthDate(key);
  date.setMonth(date.getMonth() + offset);
  return monthKey(date);
}
export function formatMonth(key) {
  if (!key) return "This month";
  return monthDate(key).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
export function formatMoney(amount, compact = false, currency = "MVR") {
  return `${currency} ${Number(amount || 0).toLocaleString("en-US", {
    minimumFractionDigits: compact && Number(amount) >= 1000 ? 0 : 2,
    maximumFractionDigits: compact && Number(amount) >= 1000 ? 0 : 2,
  })}`;
}
export function formatCurrencyTotals(totals) {
  return Object.entries(totals)
    .filter(([, amount]) => amount > 0)
    .map(([currency, amount]) => formatMoney(amount, false, currency))
    .join(" · ");
}
export function recordMvrAmount(record, rate = FALLBACK_USD_MVR_RATE) {
  if (Number.isFinite(Number(record.mvrAmount))) return Number(record.mvrAmount);
  const amount = Number(record.amount || 0);
  const currency = record.currency || "MVR";
  if (currency === "MVR") return amount;
  if (currency === "USD") return Math.round(amount * Number(record.exchangeRate || rate) * 100) / 100;
  return 0;
}
export function sumMvr(records, rate) {
  return records.reduce((sum, record) => sum + recordMvrAmount(record, rate), 0);
}
export function formatDay(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
