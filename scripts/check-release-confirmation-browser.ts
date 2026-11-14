import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
async function main() {
  const esbuild = require("esbuild");
  const bundle = await esbuild.build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{PaymentConfirmation}from'./src/components/PaymentConfirmation';const root=createRoot(document.getElementById('root'));window.mount=(props)=>root.render(React.createElement(PaymentConfirmation,props));`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "local-component-stubs",
        setup(b: any) {
          b.onResolve(
            { filter: /^(next\/navigation|next\/link|next-auth\/react)$/ },
            (a: any) => ({ path: a.path, namespace: "stub" }),
          );
          b.onLoad({ filter: /.*/, namespace: "stub" }, (a: any) => ({
            contents:
              a.path === "next/navigation"
                ? `export const useRouter=()=>({refresh(){}});`
                : a.path === "next-auth/react"
                  ? `export const useSession=()=>({update:async()=>{}});`
                  : `import React from'react';export default function Link(p){return React.createElement('a',p,p.children)}`,
            loader: "js",
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  const { chromium } = require(
    process.env.PLAYWRIGHT_CORE_PATH ?? "playwright-core",
  );
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
    args: ["--no-sandbox"],
  });
  let checks = 0;
  mkdirSync("work/release-screenshots", { recursive: true });
  const css = readdirSync(".next/static/css")
    .map((f) => readFileSync(".next/static/css/" + f, "utf8"))
    .join("\n");
  try {
    for (const provider of ["paystack", "korapay", "flutterwave", "unknown"]) {
      const p = await browser.newPage();
      const errors: string[] = [];
      p.on("pageerror", (e: any) => {
        errors.push(e.message);
        console.error("COMPONENT PAGE ERROR", e.message);
      });
      await p.setContent(
        "<style>" +
          css +
          '</style><body style="background:#0b1017;color:white;padding:24px"><p>LOCAL COMPONENT QA · MOCKED PAYMENT RESPONSE</p><div id="root"></div></body>',
      );
      await p.evaluate(
        `(() => {document.documentElement.dataset.theme="dark";window.events=[];window.gtag=(...a)=>window.events.push(a);Object.defineProperty(window,'sessionStorage',{get(){throw new DOMException('Blocked','SecurityError')}});window.fetch=async()=>({json:async()=>({activated:false,paymentStatus:window.qaStatus||'failed'})});})()`,
      );
      await p.addScriptTag({ content: bundle.outputFiles[0].text });
      await p.evaluate(
        (provider: string) =>
          (window as any).mount({
            activated: false,
            reference: "local-qa-reference",
            transactionId: "123",
            provider,
          }),
        provider,
      );
      await p
        .getByText(
          `${provider === "paystack" ? "Paystack" : provider === "korapay" ? "Korapay" : provider === "flutterwave" ? "Flutterwave" : "Your payment provider"} declined this payment`,
          { exact: false },
        )
        .waitFor({ timeout: 5000 });
      checks++;
      for (const width of [390, 1440]) {
        await p.setViewportSize({ width, height: 500 });
        await p.screenshot({
          path: `work/release-screenshots/${width}-confirmation-${provider}-failed.png`,
        });
      }
      for (const status of ["pending", "not_completed"]) {
        await p.evaluate(
          ({ provider, status }: { provider: string; status: string }) => {
            (window as any).qaStatus = status;
            (window as any).mount({
              key: status,
              activated: false,
              reference: "local-qa-reference",
              transactionId: "123",
              provider,
            });
          },
          { provider, status },
        );
        const name =
          provider === "paystack"
            ? "Paystack"
            : provider === "korapay"
              ? "Korapay"
              : provider === "flutterwave" ? "Flutterwave" : "Your payment provider";
        await p
          .getByText(
            status === "pending"
              ? `${name} is still confirming your payment`
              : `${name} hasn't received this payment`,
            { exact: false },
          )
          .waitFor({ timeout: 5000 });
        checks++;
      }
      await p.evaluate(
        (provider: string) =>
          (window as any).mount({
            activated: true,
            reference: "local-qa-reference",
            tier: "VIP",
            value: 20000,
            provider,
          }),
        provider,
      );
      await p
        .getByText("Payment received — your subscription is active.", {
          exact: true,
        })
        .waitFor({ timeout: 5000 });
      checks++;
      await p.evaluate(
        (provider: string) =>
          (window as any).mount({
            activated: true,
            reference: "local-qa-reference",
            tier: "VIP",
            value: 20000,
            provider,
          }),
        provider,
      );
      await p.waitForTimeout(100);
      const events = await p.evaluate(() => (window as any).events);
      assert.equal(events.filter((e: any) => e[1] === "purchase").length, 1);
      checks++;
      assert.deepEqual(errors, []);
      checks++;
      await p.close();
    }
  } finally {
    await browser.close();
  }
  console.log(
    `Confirmation browser: ${checks} assertions passed; actual component, mocked verification/session, blocked storage; no provider calls`,
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
