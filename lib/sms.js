export function parseSms(text) {
  // BML OTPs carry no amount or payee; the OTP is sent just before a transfer, so prefill a Transfer entry.
  const otp = text.match(/\bBML Internet Banking: Your One Time Password\b.*?\b(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/is);
  if (otp) return {
    merchant: "BML transfer", amount: "", currency: "MVR", category: "Transfer",
    date: `${otp[3]}-${otp[2].padStart(2, "0")}-${otp[1].padStart(2, "0")}`, time: `${otp[4].padStart(2, "0")}:${otp[5]}:${otp[6]}`,
    cardSuffix: "", reference: "", approvalCode: "", parsed: false, otp: true,
  };
  const amountMatch = text.match(/\b(USD|MVR|EUR|GBP|AUD|CAD|SGD|JPY)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i)
    || text.match(/\b(Rf\.?|ރ)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
  const currency = amountMatch ? (/^rf\.?$|^ރ$/i.test(amountMatch[1]) ? "MVR" : amountMatch[1].toUpperCase()) : "MVR";
  const value = amountMatch ? Number(amountMatch[2].replaceAll(",", "")) : "";
  const merchantMatch = text.match(/\bfor\s+(?:USD|MVR|EUR|GBP|AUD|CAD|SGD|JPY)\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?\s+at\s+(.+?)\s+was\s+processed\b/i)
    || text.match(/\bat\s+(.+?)\s+was\s+processed\b/i)
    || text.match(/\b(?:at|to)\s+(.+?)(?=\s+(?:for|on|amount|card|ending|ref|reference|date|time)\b|[.;]|$)/i);
  let merchant = merchantMatch?.[1]?.trim().replace(/["']/g, "").replace(/\s+[A-Z]{2}$/, "") || "";
  const bmlDate = text.match(/\bon\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/i);
  const isoDate = text.match(/\b(20\d{2})[-/]([01]?\d)[-/]([0-3]?\d)/);
  let date = new Date().toISOString().slice(0, 10);
  if (bmlDate) {
    const year = bmlDate[3].length === 2 ? `20${bmlDate[3]}` : bmlDate[3];
    date = `${year}-${bmlDate[2].padStart(2, "0")}-${bmlDate[1].padStart(2, "0")}`;
  } else if (isoDate) date = `${isoDate[1]}-${isoDate[2].padStart(2, "0")}-${isoDate[3].padStart(2, "0")}`;
  const timeMatch = text.match(/\bat\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/i);
  const time = timeMatch ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}:${(timeMatch[3] || "00")}` : "12:00:00";
  const cardSuffix = text.match(/\bfrom\s+(\d{4})\b/i)?.[1] || "";
  const reference = text.match(/\bReference\s+No\s*:\s*([\w-]+)/i)?.[1] || "";
  const approvalCode = text.match(/\bApproval\s+Code\s*:\s*([\w-]+)/i)?.[1] || "";
  const category = guessCategory(merchant);
  return { merchant, amount: value, currency, date, time, category, cardSuffix, reference, approvalCode, parsed: Boolean(merchant && value && bmlDate && timeMatch) };
}

export function guessCategory(text) {
  const normalized = text.toLowerCase();
  if (/cafe|coffee|restaurant|food|pizza|bakery|tea/.test(normalized)) return "Food & drink";
  if (/market|grocery|supermarket|store|mart/.test(normalized)) return "Groceries";
  if (/fuel|taxi|bus|transport|petrol|ride/.test(normalized)) return "Transport";
  if (/shop|mall|fashion|clothing|retail/.test(normalized)) return "Shopping";
  if (/hotel|air|travel|resort/.test(normalized)) return "Travel";
  if (/transfer/.test(normalized)) return "Transfer";
  if (/bill|utility|dhiraagu|ooredoo|electric|apple\.com\/bill|itunes|app store|google play/.test(normalized)) return "Bills";
  return "Other";
}
