import { sendWeeklySummaries } from "../../../../lib/server/telegram";

export const dynamic = "force-dynamic";

// Vercel Cron calls this (see vercel.json) with "Authorization: Bearer <CRON_SECRET>".
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Forbidden", { status: 403 });
  await sendWeeklySummaries();
  return new Response("ok");
}
