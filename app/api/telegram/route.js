import { handleUpdate } from "../../../lib/server/telegram";

export const dynamic = "force-dynamic";

// Telegram posts every bot update here. The secret header proves the request came from Telegram.
export async function POST(request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || request.headers.get("x-telegram-bot-api-secret-token") !== secret) return new Response("Forbidden", { status: 403 });
  await handleUpdate(await request.json());
  return new Response("ok");
}
