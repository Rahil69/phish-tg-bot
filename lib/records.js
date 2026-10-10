import { monthDate } from "./format.js";

export const CATEGORIES = ["Food & drink", "Groceries", "Transport", "Shopping", "Bills", "Health", "Travel", "Transfer", "Other"];

export function inMonth(records, key) {
  return records.filter((record) => record.date.slice(0, 7) === key);
}

// crypto.randomUUID only exists on secure (HTTPS or localhost) pages; getRandomValues works everywhere.
export function newId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function makeSamples(key) {
  const base = monthDate(key);
  const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const samples = [
    ["Moshi Moshi", 285, "Food & drink", 2, "Dinner with friends"],
    ["Redwave Market", 416.8, "Groceries", 4, "Weekly groceries"],
    ["Taxi ride", 85, "Transport", 6, "Airport run"],
    ["Oevaali Art Shop", 320, "Shopping", 9, "A little treat"],
    ["Coffee Residencies", 72, "Food & drink", 11, "Coffee"],
    ["Dhiraagu", 399, "Bills", 14, "Monthly data"],
    ["Green Mart", 187.5, "Groceries", 17, "Essentials"],
    ["Seagull Cafe", 145, "Food & drink", 20, "Lunch"],
  ];
  return samples.map(([merchant, amount, category, day, note]) => ({
    id: newId(), merchant, amount, currency: "MVR", category,
    date: `${key}-${String(Math.min(day, daysInMonth)).padStart(2, "0")}T12:00:00`, note, message: "", sample: true,
  }));
}

// Supabase rows <-> in-app records. purchased_at is a local wall-clock timestamp (no time zone).
export function fromRow(row) {
  return {
    id: row.id, merchant: row.merchant, amount: Number(row.amount), currency: row.currency,
    mvrAmount: row.mvr_amount == null ? null : Number(row.mvr_amount),
    exchangeRate: row.exchange_rate == null ? null : Number(row.exchange_rate),
    exchangeRateDate: row.exchange_rate_date, exchangeRateIsFallback: row.exchange_rate_is_fallback,
    category: row.category, date: String(row.purchased_at).slice(0, 19), note: row.note, message: row.message,
    cardSuffix: row.card_suffix, reference: row.reference, approvalCode: row.approval_code, sample: row.sample,
  };
}
export function toRow(record, userId) {
  const currency = record.currency || "MVR";
  return {
    id: record.id, user_id: userId, merchant: record.merchant, amount: record.amount, currency,
    mvr_amount: Number.isFinite(record.mvrAmount) ? record.mvrAmount : currency === "MVR" ? record.amount : null,
    exchange_rate: record.exchangeRate ?? null, exchange_rate_date: record.exchangeRateDate ?? null,
    exchange_rate_is_fallback: Boolean(record.exchangeRateIsFallback), category: record.category,
    purchased_at: record.date.slice(0, 19), note: record.note || "", message: record.message || "",
    card_suffix: record.cardSuffix || "", reference: record.reference || "", approval_code: record.approvalCode || "",
    sample: Boolean(record.sample),
  };
}
