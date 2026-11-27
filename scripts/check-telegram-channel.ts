import assert from "node:assert/strict";
import { TelegramChannel } from "../src/lib/telegram/channel";

async function main() {
  const requests: { method: string; body: Record<string, unknown> }[] = [];
  const client = new TelegramChannel({
    token: "123:fake-token",
    channel: "-100123",
    fetcher: async (input, init) => {
      requests.push({ method: String(input).split("/").pop()!, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 });
    },
  });
  assert.deepEqual(await client.sendText("Match preview", [{ text: "View", url: "https://www.betgenius.ng/predictions/today" }]), { status: "ok", result: { message_id: 42 } });
  assert.equal(requests[0].method, "sendMessage");
  assert.equal(requests[0].body.chat_id, "-100123");
  assert.throws(() => client.sendText("test", [{ text: "Bad", url: "https://betgenius.ng.evil.example/" }]));
  assert.throws(() => client.delete(-1));
  assert.throws(() => new TelegramChannel({ token: "123:fake-token", channel: "@other" }));
  await client.pin(42);
  assert.deepEqual(requests[1].body, { message_id: 42, disable_notification: true, chat_id: "-100123" });
  const failing = new TelegramChannel({ token: "123:fake-token", channel: "-100123", fetcher: async () => { throw new Error("secret URL"); } });
  assert.deepEqual(await failing.sendText("test"), { status: "uncertain" });
  const limited = new TelegramChannel({ token: "123:fake-token", channel: "-100123", fetcher: async () => new Response(JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 30 } }), { status: 429 }) });
  assert.deepEqual(await limited.sendText("test"), { status: "rejected", code: 429, retryAfter: 30 });
  const gateway = new TelegramChannel({ token: "123:fake-token", channel: "-100123", fetcher: async () => new Response("bad gateway", { status: 502 }) });
  assert.deepEqual(await gateway.sendText("test"), { status: "uncertain" });
  console.log("Telegram transport checks passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
