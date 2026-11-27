# BetGenius Telegram control — implementation contract

This branch contains the first, inert Telegram transport and mock checks only. Do not deploy as a functional bot or enable publishing until the remaining acceptance gates pass.

## Architecture

Keep Telegram credentials and all publishing logic on the existing Contabo infrastructure. The website remains the source of truth for public predictions; Telegram must not alter generation, odds consumption, premium entitlements, SEO, or published website predictions.

ChatGPT control: prefer a private authenticated MCP service where the account supports write tools. For personal accounts lacking custom write-capable MCP, implement a private Google Sheets command queue using the existing connected Google Drive/Sheets app and a dedicated Google service account scoped to that one spreadsheet. This is an explicit asynchronous bridge, not a native Telegram connector. Do not use public GitHub issues, a public spreadsheet, or unauthenticated inbound webhooks as a command queue. Keep the queue private, share only with the owner and dedicated service account, and verify permissions before enabling. No token, password, subscriber data or private paid prediction data in the sheet.

## Consolidated remaining sprint

- Audit current repository for Telegram integration and reuse existing libraries; use the existing Google authentication library for a scoped service account, existing database for durable commands and audit records, and existing deployment patterns. Feature disabled by default.
- Define versioned structured commands: preview, publish text/photo, schedule/cancel scheduled post, edit, pin/unpin, set title/description/photo, get status/member count, delete individual bot-managed post. No arbitrary API methods or arbitrary channel IDs. Add explicit test and production channel configuration; never infer destination from user text.
- Private queue schema: command ID, action, structured JSON payload, execution time (UTC), expiration, approval status, status/result, Telegram message ID. Treat all cell content as untrusted data, never as model instructions. Use RAW cell values; validate limits, ownership and allowlisted fields/URLs; reject formulas and unknown actions. Process only explicitly approved commands; destructive and branding changes require separately recorded confirmation. Re-read approved payload and reject mutations after approval. Restrict edits/deletions to the bot's own recorded messages unless an owner explicitly authorizes a known target.
- Durable database unique command IDs and payload hashes, atomic claim/lease, transaction-backed state machine, audit trail, cancellation, rate limiting, bounded polling, timeout handling. Ambiguous writes remain UNKNOWN pending operator reconciliation; never blindly retry or report success. Retry explicit rate limits only after retry-after and only if still valid. Confirm final status from a Telegram API response.
- Generate and preview branded cards using the existing logo/teal assets and verified website picks. Revalidate eligibility, kickoff, date (Africa/Lagos), odds, tier and publication status at actual send time; no invented odds or fixtures, paid data leaks, or guaranteed-win language. Include responsible gambling / 18+ notice as appropriate. Report all settled picks, including losses/voids, with honest provenance. No API-Football calls for Telegram; reuse persisted website data.
- Owner-facing admin page: drafts, preview, queue, status, history, explicit confirm/cancel and emergency pause. MCP adapter may expose the same narrow service tools, with OAuth and owner authorization, not a generic command executor. No arbitrary code/shell execution.
- Photo upload: accept only validated owned media, enforce size/MIME limits, no arbitrary server-side URL fetch. Add Bot API methods using safe multipart/Telegram file IDs; do not use external URL fetching for private assets.
- Test mocked success, errors, rate limits, ambiguous delivery, duplicate concurrent processing, unauthorized/expired/mutated commands, schedule cancellation and paused service, malformed content, tier leakage, started matches, and secret redaction. Run full CI and a private test channel end-to-end before production. Record actual Telegram message IDs, then get owner production approval.
- Deploy with isolated service account credentials, bot token in server secret configuration (not Git, chats, sheets, or logs), numeric channel ID, least Telegram admin permissions, explicit enable flag and rollback/pause controls. Do not grant promote-admin or ownership-transfer permissions.

## Owner setup (not yet performed)

Create bot with official @BotFather and store its token privately in server secrets. Create a private test channel, grant only necessary admin permissions, and configure its numeric channel ID. Later repeat for the official channel after acceptance. Create the private command spreadsheet only when the worker is ready; restrict sharing and do not reuse a public spreadsheet.

Run the initial mock tests with `npx tsx scripts/check-telegram-channel.ts`. These are not a substitute for end-to-end delivery and queue tests.
