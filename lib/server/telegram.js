// Phish Telegram bot, run inside the website: Telegram posts each update to /api/telegram.
// Forward a BML SMS (or send "85 taxi") to log it, get budget alerts, and a Sunday summary via Vercel Cron.
// Server-only: this module uses the Supabase secret key, so never import it from a client component.
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { fetchBmlUsdRate } from "../bmlRate.js";
import { formatMoney } from "../format.js";
import { CATEGORIES } from "../records.js";
import { guessCategory, parseSms } from "../sms.js";

// Created on first use so the site still builds when the bot isn't configured.
let client;
function db() {
  const { SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL } = process.env;
  if (!SUPABASE_SERVICE_ROLE_KEY || !NEXT_PUBLIC_SUPABASE_URL) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL.");
  client ||= createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
// Where the bot's login link points: the production site on Vercel, or PHISH_URL elsewhere.
const PHISH_URL = (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : process.env.PHISH_URL || "http://localhost:3000").replace(/\/$/, "");

const HELP = [
  "Forward or paste a BML transaction SMS and I'll log it in Phish.",
  "No SMS? Send the amount and what it was, like <code>85 taxi</code> or <code>USD 12 netflix</code>.",
  "",
  "/month — this month so far",
  "/week — the last 7 days",
  "/disconnect — unlink this chat",
].join("\n");
const CONNECT_HELP = "This chat isn't connected to Phish yet. Send /start and I'll give you a link to log in.";

// ---------- Telegram ----------
async function tg(method, body) {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("Set TELEGRAM_BOT_TOKEN.");
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
}
const send = (chatId, text, extra = {}) => tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- Time: Maldives is UTC+5 all year; purchased_at stores local wall-clock time ----------
const pad = (n) => String(n).padStart(2, "0");
const mvtNow = () => new Date(Date.now() + 5 * 3600 * 1000); // read with getUTC* only
const localStamp = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
const nextMonth = (month) => {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
};
const monthName = (month) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
const shortDate = (stamp) => new Date(`${stamp.slice(0, 19)}Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const round2 = (n) => Math.round(n * 100) / 100;

// ---------- Data ----------
// The secret key bypasses row-level security, so every query filters by the user_id linked to the chat.
async function linkedUser(chatId) {
  const { data, error } = await db().from("telegram_links").select("user_id").eq("chat_id", chatId).maybeSingle();
  if (error) throw error;
  return data?.user_id || null;
}

async function rowsBetween(userId, from, to) {
  const { data, error } = await db().from("transactions").select("merchant, category, mvr_amount")
    .eq("user_id", userId).gte("purchased_at", from).lt("purchased_at", to);
  if (error) throw error;
  return data;
}
const spend = (rows) => rows.reduce((sum, row) => sum + Number(row.mvr_amount || 0), 0);
const monthRows = (userId, month) => rowsBetween(userId, `${month}-01T00:00:00`, `${nextMonth(month)}-01T00:00:00`);

async function monthBudget(userId, month) {
  const { data, error } = await db().from("monthly_budgets").select("amount_mvr").eq("user_id", userId).eq("month", month).maybeSingle();
  if (error) throw error;
  return data ? Number(data.amount_mvr) : 0;
}

function budgetLine(month, spent, budget) {
  if (!budget) return `${monthName(month)}: ${formatMoney(spent)} spent`;
  return spent > budget
    ? `${monthName(month)}: ${formatMoney(spent)} spent · <b>${formatMoney(spent - budget)} over</b> your ${formatMoney(budget)} budget`
    : `${monthName(month)}: ${formatMoney(spent)} spent · ${formatMoney(budget - spent)} left of ${formatMoney(budget)}`;
}

function topCategories(rows, limit = 3) {
  const totals = {};
  rows.forEach((row) => { totals[row.category] = (totals[row.category] || 0) + Number(row.mvr_amount || 0); });
  return Object.entries(totals).filter(([, total]) => total > 0).sort((a, b) => b[1] - a[1]).slice(0, limit)
    .map(([name, total]) => `• ${esc(name)} — ${formatMoney(total)}`);
}

// ---------- Logging a purchase ----------
async function logEntry(chatId, userId, entry, source) {
  if (entry.reference) {
    const { data, error } = await db().from("transactions").select("id").eq("user_id", userId).eq("reference", entry.reference).limit(1);
    if (error) throw error;
    if (data.length) return send(chatId, "Already logged — that BML reference number is in Phish.");
  }
  const rate = entry.currency === "USD" ? await fetchBmlUsdRate() : null;
  const mvrAmount = entry.currency === "MVR" ? entry.amount : rate ? round2(entry.amount * rate.usdSellRate) : null;
  const month = entry.date.slice(0, 7);
  const before = spend(await monthRows(userId, month));

  const row = {
    id: randomUUID(), user_id: userId, merchant: entry.merchant, amount: entry.amount, currency: entry.currency, mvr_amount: mvrAmount,
    exchange_rate: rate?.usdSellRate ?? null, exchange_rate_date: rate?.updatedAt ?? null, exchange_rate_is_fallback: Boolean(rate?.fallback),
    category: entry.category, purchased_at: `${entry.date}T${entry.time}`, note: "", message: source,
    card_suffix: entry.cardSuffix || "", reference: entry.reference || "", approval_code: entry.approvalCode || "", sample: false,
  };
  const { error } = await db().from("transactions").insert(row);
  if (error) throw error;

  const after = before + (mvrAmount || 0);
  const budget = await monthBudget(userId, month);
  const alert = !budget ? ""
    : before <= budget && after > budget ? `\n\n🚨 That takes you over your ${monthName(month)} budget.`
    : before < budget * 0.8 && after >= budget * 0.8 ? `\n\n⚠️ You've used ${Math.round((after / budget) * 100)}% of your ${monthName(month)} budget.`
    : "";
  return send(chatId, describe(row, after, budget) + alert, { reply_markup: rowKeyboard(row.id) });
}

function describe(row, monthSpent, budget) {
  const usd = row.currency === "USD" && row.mvr_amount != null ? ` (≈ ${formatMoney(row.mvr_amount)})` : "";
  return [
    `✅ <b>${formatMoney(row.amount, false, row.currency)}</b>${usd} at <b>${esc(row.merchant)}</b>`,
    `${esc(row.category)} · ${shortDate(row.purchased_at)}, ${String(row.purchased_at).slice(11, 16)}`,
    "",
    budgetLine(String(row.purchased_at).slice(0, 7), monthSpent, budget),
  ].join("\n");
}

const rowKeyboard = (id) => ({ inline_keyboard: [[{ text: "Change category", callback_data: `c:${id}` }, { text: "Undo", callback_data: `u:${id}` }]] });
const categoryKeyboard = (id) => ({
  inline_keyboard: [
    ...Array.from({ length: Math.ceil(CATEGORIES.length / 3) }, (_, r) =>
      CATEGORIES.slice(r * 3, r * 3 + 3).map((name, i) => ({ text: name, callback_data: `k:${id}:${r * 3 + i}` }))),
    [{ text: "‹ Back", callback_data: `b:${id}` }],
  ],
});

// ---------- Reports ----------
async function monthReport(userId) {
  const month = localStamp(mvtNow()).slice(0, 7);
  const rows = await monthRows(userId, month);
  if (!rows.length) return `Nothing logged in ${monthName(month)} yet.`;
  return [
    `<b>${monthName(month)} so far</b>`,
    budgetLine(month, spend(rows), await monthBudget(userId, month)),
    `${rows.length} ${rows.length === 1 ? "purchase" : "purchases"}`,
    "", ...topCategories(rows),
  ].join("\n");
}

async function weekReport(userId) {
  const now = mvtNow();
  const start = new Date(now.getTime() - 6 * 86400 * 1000);
  const tomorrow = new Date(now.getTime() + 86400 * 1000);
  const rows = await rowsBetween(userId, `${localStamp(start).slice(0, 10)}T00:00:00`, `${localStamp(tomorrow).slice(0, 10)}T00:00:00`);
  const month = localStamp(now).slice(0, 7);
  const monthLine = budgetLine(month, spend(await monthRows(userId, month)), await monthBudget(userId, month));
  if (!rows.length) return `No purchases in the last 7 days.\n\n${monthLine}`;
  const biggest = rows.reduce((max, row) => Number(row.mvr_amount || 0) > Number(max.mvr_amount || 0) ? row : max);
  return [
    `<b>Last 7 days: ${formatMoney(spend(rows))}</b> across ${rows.length} ${rows.length === 1 ? "purchase" : "purchases"}`,
    "", ...topCategories(rows),
    "", `Biggest: ${esc(biggest.merchant)} (${formatMoney(biggest.mvr_amount)})`,
    monthLine,
  ].join("\n");
}

// Run by Vercel Cron on Sunday evening; last_summary_week stops a retried run from sending twice.
export async function sendWeeklySummaries() {
  const week = localStamp(mvtNow()).slice(0, 10);
  const { data, error } = await db().from("telegram_links").select("user_id, chat_id, last_summary_week");
  if (error) throw error;
  for (const link of data.filter((item) => item.last_summary_week !== week)) {
    try {
      await send(link.chat_id, `🗓 <b>Your week</b>\n\n${await weekReport(link.user_id)}`);
      await db().from("telegram_links").update({ last_summary_week: week }).eq("user_id", link.user_id);
    } catch (error) {
      console.error("weekly summary failed for", link.user_id, error.message);
    }
  }
}

// ---------- Handlers ----------
// /start for an unlinked chat: store a one-time code and send a login link carrying it.
async function sendLoginLink(message) {
  const chatId = message.chat.id;
  const code = randomBytes(18).toString("base64url");
  const from = message.from || {};
  const telegramName = from.username ? `@${from.username}` : [from.first_name, from.last_name].filter(Boolean).join(" ");
  const { error } = await db().from("telegram_link_requests").insert({
    code, chat_id: chatId, telegram_name: telegramName, expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });
  if (error) throw error;
  const url = `${PHISH_URL}/?telegram=${code}`;
  const text = `Welcome to Phish 👋\n\nLog in to connect this chat to your account. The link works for 15 minutes.\n\n${esc(url)}`;
  try {
    return await send(chatId, text, { reply_markup: { inline_keyboard: [[{ text: "Log in to Phish", url }]] } });
  } catch {
    return send(chatId, text); // Telegram refuses buttons for some URLs (like localhost); the link in the text still works.
  }
}

// Called by /api/telegram/greet right after the user confirms the link on the website.
export async function greetUser(userId) {
  const { data: link, error } = await db().from("telegram_links").select("chat_id").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!link) return false;
  const { data: found } = await db().auth.admin.getUserById(userId);
  const user = found?.user;
  const name = user?.user_metadata?.username || user?.email?.split("@")[0] || "there";
  await send(link.chat_id, `👋 Hello <b>${esc(name)}</b>! This chat is now connected to Phish.\n\n${HELP}`);
  // Tidy up login links nobody used.
  await db().from("telegram_link_requests").delete().lt("expires_at", new Date(Date.now() - 86400 * 1000).toISOString());
  return true;
}

async function onMessage(message) {
  if (message.chat.type !== "private") return;
  const chatId = message.chat.id;
  const text = (message.text || message.caption || "").trim();
  const [command] = text.split(/\s+/);

  const userId = await linkedUser(chatId);
  if (!userId) return command === "/start" ? sendLoginLink(message) : send(chatId, CONNECT_HELP);
  if (!text) return send(chatId, "Send the SMS as text and I'll log it.");
  if (command === "/start" || command === "/help") return send(chatId, HELP);
  if (command === "/month") return send(chatId, await monthReport(userId));
  if (command === "/week") return send(chatId, await weekReport(userId));
  if (command === "/disconnect") {
    const { error } = await db().from("telegram_links").delete().eq("user_id", userId);
    if (error) throw error;
    return send(chatId, "Disconnected. Your purchases stay in Phish. Send /start to connect again.");
  }
  if (text.startsWith("/")) return send(chatId, `I don't know that command.\n\n${HELP}`);

  const sms = parseSms(text);
  if (sms.otp) return send(chatId, "That's a BML OTP, so there's no amount in it. Send the transfer like <code>500 transfer to Ali</code>.");
  if (sms.parsed) return logEntry(chatId, userId, sms, text);

  const quick = text.match(/^(?:(MVR|USD|Rf\.?)\s*)?(\d[\d,]*(?:\.\d{1,2})?)\s+(.{1,80})$/is);
  const amount = quick ? Number(quick[2].replaceAll(",", "")) : 0;
  if (quick && amount > 0) {
    const merchant = quick[3].trim();
    const stamp = localStamp(mvtNow());
    const currency = quick[1]?.toUpperCase() === "USD" ? "USD" : "MVR";
    return logEntry(chatId, userId, { merchant, amount, currency, category: guessCategory(merchant), date: stamp.slice(0, 10), time: stamp.slice(11) }, "");
  }
  return send(chatId, "I couldn't read that. Forward a BML transaction SMS, or send something like <code>85 taxi</code>.");
}

async function onCallback(query) {
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;
  const userId = chatId ? await linkedUser(chatId) : null;
  if (!userId) return tg("answerCallbackQuery", { callback_query_id: query.id, text: "This chat isn't connected to Phish." });

  const [action, id, index] = String(query.data).split(":");
  const { data: row, error } = await db().from("transactions").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!row) {
    await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
    return tg("answerCallbackQuery", { callback_query_id: query.id, text: "That purchase is no longer in Phish." });
  }

  if (action === "u") {
    const removed = await db().from("transactions").delete().eq("id", id).eq("user_id", userId);
    if (removed.error) throw removed.error;
    await tg("editMessageText", { chat_id: chatId, message_id: messageId, parse_mode: "HTML", text: `↩️ Removed ${formatMoney(row.amount, false, row.currency)} at ${esc(row.merchant)}.` });
    return tg("answerCallbackQuery", { callback_query_id: query.id, text: "Removed" });
  }
  if (action === "c") {
    await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: categoryKeyboard(id) });
    return tg("answerCallbackQuery", { callback_query_id: query.id });
  }
  if (action === "k" && CATEGORIES[Number(index)]) {
    const category = CATEGORIES[Number(index)];
    const updated = await db().from("transactions").update({ category }).eq("id", id).eq("user_id", userId);
    if (updated.error) throw updated.error;
    const month = String(row.purchased_at).slice(0, 7);
    await tg("editMessageText", {
      chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: rowKeyboard(id),
      text: describe({ ...row, category }, spend(await monthRows(userId, month)), await monthBudget(userId, month)),
    });
    return tg("answerCallbackQuery", { callback_query_id: query.id, text: `Moved to ${category}` });
  }
  if (action === "b") {
    await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: rowKeyboard(id) });
  }
  return tg("answerCallbackQuery", { callback_query_id: query.id });
}

// ---------- Entry points ----------
export async function handleUpdate(update) {
  try {
    if (update.message) await onMessage(update.message);
    else if (update.callback_query) await onCallback(update.callback_query);
  } catch (error) {
    console.error(error);
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chatId) await send(chatId, "Something went wrong saving that. Try again in a moment.").catch(() => {});
  }
}

// Points Telegram at the webhook and registers the command list. Run once via /api/telegram/setup.
export async function setupWebhook(url, secret) {
  await tg("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
  await tg("setMyCommands", { commands: [
    { command: "month", description: "This month so far" },
    { command: "week", description: "The last 7 days" },
    { command: "help", description: "How to log purchases" },
    { command: "disconnect", description: "Unlink this chat from Phish" },
  ] });
  return (await tg("getMe", {})).username;
}

// Resolves a signed-in user's Supabase access token (sent by the website) to their user id.
export async function userIdFromToken(token) {
  const { data, error } = await db().auth.getUser(token);
  return error ? null : data.user?.id || null;
}
