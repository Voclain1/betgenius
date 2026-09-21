/**
 * Proves the dashboard exposes Log out, and that it is the SAME safe flow the
 * public Nav uses — not a second, weaker copy.
 *
 * "Weaker" has a specific meaning here: a sign-out that skips detaching this
 * browser's PushSubscription leaves the device receiving the previous user's
 * notifications. That failure is invisible in a screenshot — both buttons say
 * "Log out" and both end signed out — so it is asserted three ways:
 *
 *   1. RENDER. DashboardShell's markup carries the shared LogoutButton (desktop
 *      sidebar and mobile drawer are the same <aside>, so one control is both).
 *   2. WIRING. Both Nav and DashboardShell use LogoutButton, which calls
 *      logOut(); neither touches pushManager, /api/push-subscriptions or
 *      NextAuth's signOut directly. A reintroduced inline handler fails here.
 *   3. BEHAVIOUR. logOut() against a fake browser: the server row is deleted
 *      and the browser unsubscribed BEFORE signOut, and no push failure — a
 *      rejected fetch, a throwing unsubscribe, no service worker — can stop
 *      signOut from running.
 *
 * No browser, no network, no database.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render.json scripts/check-dashboard-logout.tsx
 */
export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardShell } from "../src/components/DashboardShell";
import { detachPushForLogout, logOut, type LogoutEnvironment } from "../src/lib/logout";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

async function main() {
  console.log("render: the dashboard shell exposes Log out:");
  const html = renderToStaticMarkup(
    <DashboardShell items={[{ key: "overview", href: "/dashboard", label: "Overview" }]} activeKey="overview" title="Overview" userEmail="reader@example.com">
      <p>body</p>
    </DashboardShell>,
  );
  check("a Log out button is rendered", /<button[^>]*data-logout[^>]*>Log out<\/button>/.test(html));
  check("it is inside the sidebar <aside> (desktop sidebar and mobile drawer)", /<aside[\s\S]*data-logout[\s\S]*<\/aside>/.test(html));
  check("the signed-in email is still shown beside it", html.includes("reader@example.com"));
  check("exactly one Log out control (no duplicate)", (html.match(/data-logout/g) ?? []).length === 1);

  console.log("\nwiring: one flow, shared by both surfaces:");
  const shell = src("src/components/DashboardShell.tsx");
  const nav = src("src/components/Nav.tsx");
  const button = src("src/components/LogoutButton.tsx");
  check("DashboardShell renders the shared LogoutButton", /import \{ LogoutButton \} from "@\/components\/LogoutButton"/.test(shell) && shell.includes("<LogoutButton"));
  check("Nav renders the shared LogoutButton", /import \{ LogoutButton \} from "@\/components\/LogoutButton"/.test(nav) && nav.includes("<LogoutButton"));
  check("LogoutButton calls logOut() from src/lib/logout", /import \{ logOut \} from "@\/lib\/logout"/.test(button) && button.includes("await logOut("));
  for (const [name, text] of [["DashboardShell", shell], ["Nav", nav], ["LogoutButton", button]] as const) {
    check(`${name} has no inline push cleanup (pushManager)`, !text.includes("pushManager"));
    check(`${name} does not call /api/push-subscriptions itself`, !text.includes("/api/push-subscriptions"));
    check(`${name} does not call NextAuth signOut directly`, !/\bsignOut\s*\(/.test(text) && !/import[^;]*\bsignOut\b[^;]*next-auth/.test(text));
  }
  check("dashboard sends a signed-out visitor home, not back to a gated route", /<LogoutButton[^>]*callbackUrl="\/"/.test(shell));

  console.log("\nbehaviour: push is detached before sign-out:");
  const run = async (env: Partial<LogoutEnvironment> & { unsubscribe?: () => Promise<unknown> }, endpoint: string | null = "https://push.example/abc") => {
    const log: string[] = [];
    const full: LogoutEnvironment = {
      getSubscription:
        env.getSubscription ??
        (async () => (endpoint ? { endpoint, unsubscribe: env.unsubscribe ?? (async () => { log.push("unsubscribe"); }) } : null)),
      deleteServerSubscription: env.deleteServerSubscription ?? (async (e) => { log.push(`delete:${e}`); }),
    };
    let signOutArgs: unknown = "not called";
    await logOut({ env: full, callbackUrl: "/", signOut: async (o) => { log.push("signOut"); signOutArgs = o; } });
    return { log, signOutArgs };
  };

  const happy = await run({});
  check("server row deleted for this browser's endpoint", happy.log[0] === "delete:https://push.example/abc", happy.log.join(","));
  check("browser unsubscribed after the server delete", happy.log[1] === "unsubscribe", happy.log.join(","));
  check("signOut runs last", happy.log[2] === "signOut" && happy.log.length === 3, happy.log.join(","));
  check("callbackUrl reaches NextAuth", JSON.stringify(happy.signOutArgs) === '{"callbackUrl":"/"}');

  const deleteFails = await run({ deleteServerSubscription: async () => { throw new Error("offline"); } });
  check("a failed server delete still unsubscribes (dead endpoint is the backstop)", deleteFails.log.includes("unsubscribe"), deleteFails.log.join(","));
  check("a failed server delete still signs out", deleteFails.log.at(-1) === "signOut");

  const unsubFails = await run({ unsubscribe: async () => { throw new Error("gone"); } });
  check("a throwing unsubscribe still signs out", unsubFails.log.at(-1) === "signOut", unsubFails.log.join(","));

  const regFails = await run({ getSubscription: async () => { throw new Error("SecurityError"); } });
  check("a throwing service-worker lookup still signs out", regFails.log.join(",") === "signOut", regFails.log.join(","));

  const noSub = await run({}, null);
  check("no subscription: no delete request, straight to sign-out", noSub.log.join(",") === "signOut", noSub.log.join(","));

  // Default browser environment with no navigator.serviceWorker (Node has a
  // navigator but no service worker — the same shape as an unsupported browser).
  const detached = await detachPushForLogout();
  check("no service worker at all: nothing attempted, nothing thrown", detached.endpoint === null && !detached.serverDeleted && !detached.unsubscribed);

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll dashboard logout checks passed.");
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
