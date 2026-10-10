import { greetUser, userIdFromToken } from "../../../../lib/server/telegram";

export const dynamic = "force-dynamic";

// Called by the website right after the user confirms the Telegram link; the bot then says hello.
export async function POST(request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const userId = token ? await userIdFromToken(token) : null;
  if (!userId) return Response.json({ error: "Sign in first." }, { status: 401 });
  try {
    return Response.json({ sent: await greetUser(userId) });
  } catch (error) {
    console.error(error);
    return Response.json({ sent: false }, { status: 500 });
  }
}
