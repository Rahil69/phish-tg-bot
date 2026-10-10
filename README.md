# Phish Telegram bot

Telegram bot for Phish, a personal finance tracker (Next.js + Supabase). Forward a Bank of Maldives SMS to log a purchase, or send `85 taxi`. It also sends budget alerts and `/month` and `/week` summaries.

The bot is `lib/server/telegram.js`; Telegram posts updates to `app/api/telegram/route.js`.
