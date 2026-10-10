// BML's published USD rate, shared by the /api/exchange-rates route and the Telegram bot.
export const BML_RATES_URL = "https://www.bankofmaldives.com.mv/exchange-rates";
const FALLBACK_BML_RATE = {
  usdBuyRate: 15,
  usdSellRate: 15.42,
  updatedAt: "8 October 2026 08:33 AM",
  source: BML_RATES_URL,
  fallback: true,
};

// fetchOptions lets the Next route add its caching hint; plain Node ignores it.
export async function fetchBmlUsdRate(fetchOptions = {}) {
  try {
    const response = await fetch(BML_RATES_URL, {
      headers: { "User-Agent": "Phish personal finance tracker" },
      ...fetchOptions,
    });
    if (!response.ok) throw new Error(`BML rates returned ${response.status}`);

    const html = await response.text();
    const pageText = html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ");
    const usdRow = pageText.match(/USD\s+US\s+Dollar\s*\*?\s+([\d.]+)\s+([\d.]+)/i);
    const updated = pageText.match(/Last Updated At:\s*(.+?)\s+Additional information/i)?.[1]?.trim();
    if (!usdRow || !Number.isFinite(Number(usdRow[2]))) throw new Error("Could not read BML's USD rate");

    return {
      usdBuyRate: Number(usdRow[1]),
      usdSellRate: Number(usdRow[2]),
      updatedAt: updated || "Latest rate shown by BML",
      source: BML_RATES_URL,
      fallback: false,
    };
  } catch {
    return FALLBACK_BML_RATE;
  }
}
