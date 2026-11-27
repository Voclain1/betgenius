/**
 * Telegram transport for a single configured channel. No publishing is
 * enabled by importing this module. All callers must enforce authorization,
 * durable command claiming, and approval before invoking a write method.
 */
export type TelegramResult =
  | { status: "ok"; result: unknown }
  | { status: "rejected"; code: number; retryAfter?: number }
  | { status: "uncertain" };

type Fetcher = typeof fetch;
type Button = { text: string; url: string };

export class TelegramChannel {
  private readonly token: string;
  private readonly channel: string;
  private readonly fetcher: Fetcher;

  constructor(config: { token: string; channel: string; fetcher?: Fetcher }) {
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(config.token)) throw new Error("Invalid Telegram token configuration");
    // Numeric channel ID avoids accidentally sending to a reassigned username.
    if (!/^-100\d+$/.test(config.channel)) throw new Error("Configure a numeric Telegram channel ID");
    this.token = config.token;
    this.channel = config.channel;
    this.fetcher = config.fetcher ?? fetch;
  }

  private async call(method: string, payload: Record<string, unknown> = {}): Promise<TelegramResult> {
    try {
      const response = await this.fetcher(
        "https://api.telegram.org/bot" + this.token + "/" + method,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, chat_id: this.channel }),
          signal: AbortSignal.timeout(15000),
          redirect: "error",
          cache: "no-store",
        },
      );
      const data = await response.json();
      if (response.ok && data?.ok === true && "result" in data) {
        return { status: "ok", result: data.result };
      }
      // A timeout, gateway error or malformed response may follow a successful
      // write. Never automatically replay such a request.
      if (data?.ok === false && Number.isInteger(data.error_code)
          && data.error_code >= 400 && data.error_code < 500) {
        const retryAfter = data.parameters?.retry_after;
        return {
          status: "rejected", code: data.error_code,
          ...(Number.isInteger(retryAfter) && retryAfter > 0 ? { retryAfter } : {}),
        };
      }
      return { status: "uncertain" };
    } catch {
      // Never return/log the URL, token, response body or exception.
      return { status: "uncertain" };
    }
  }

  private buttons(buttons?: Button[]) {
    if (!buttons?.length) return {};
    if (buttons.length > 5) throw new Error("Too many buttons");
    for (const button of buttons) {
      const url = new URL(button.url);
      if (url.protocol !== "https:" || !["betgenius.ng", "www.betgenius.ng"].includes(url.hostname)
          || url.username || url.password || url.port || !button.text.trim() || button.text.length > 64) {
        throw new Error("Invalid channel button");
      }
    }
    return { reply_markup: { inline_keyboard: buttons.map((b) => [{ text: b.text, url: b.url }]) } };
  }

  private messageId(id: number) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid message ID");
    return { message_id: id };
  }

  getChannel() { return this.call("getChat"); }
  getMemberCount() { return this.call("getChatMemberCount"); }

  sendText(text: string, buttons?: Button[]) {
    if (!text.trim() || text.length > 4096) throw new Error("Invalid message length");
    return this.call("sendMessage", { text, ...this.buttons(buttons) });
  }

  editText(id: number, text: string, buttons?: Button[]) {
    if (!text.trim() || text.length > 4096) throw new Error("Invalid message length");
    return this.call("editMessageText", {
      ...this.messageId(id), text, ...this.buttons(buttons),
    });
  }

  pin(id: number) {
    return this.call("pinChatMessage", { ...this.messageId(id), disable_notification: true });
  }

  unpin(id: number) { return this.call("unpinChatMessage", this.messageId(id)); }
  delete(id: number) { return this.call("deleteMessage", this.messageId(id)); }

  setTitle(title: string) {
    if (!title.trim() || title.length > 128) throw new Error("Invalid title length");
    return this.call("setChatTitle", { title });
  }

  setDescription(description: string) {
    if (description.length > 255) throw new Error("Invalid description length");
    return this.call("setChatDescription", { description });
  }
}
