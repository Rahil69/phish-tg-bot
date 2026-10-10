import { setupWebhook } from "../../../../lib/server/telegram";

export const dynamic = "force-dynamic";

// Open /api/telegram/setup?secret=<TELEGRAM_WEBHOOK_SECRET> once after deploying to point the bot at this site.
export async function GET(request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const url = new URL(request.url);
  if (!secret || url.searchParams.get("secret") !== secret) return new Response("Forbidden", { status: 403 });
  try {
    const bot = await setupWebhook(`${url.origin}/api/telegram`, secret);
    return Response.json({ ok: true, bot: `@${bot}`, webhook: `${url.origin}/api/telegram` });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
