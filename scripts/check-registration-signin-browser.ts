/** Actual registration component; local mocked registration/sign-in boundaries, no account/provider calls. */
import assert from "node:assert/strict";
async function main() {
  const esbuild = require("esbuild");
  const bundle = await esbuild.build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import RegisterPage from './src/app/(public)/register/page';createRoot(document.getElementById('root')).render(React.createElement(RegisterPage));`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "auth-test-adapters",
        setup(b: any) {
          b.onResolve(
            {
              filter:
                /^(next\/navigation|next\/link|next-auth\/react|@\/components\/GoogleSignInButton)$/,
            },
            (a: any) => ({ path: a.path, namespace: "stub" }),
          );
          b.onLoad({ filter: /.*/, namespace: "stub" }, (a: any) => ({
            loader: "js",
            resolveDir: process.cwd(),
            contents:
              a.path === "next/navigation"
                ? `export const useRouter=()=>({push:(url)=>window.routes.push(url)});export const useSearchParams=()=>new URLSearchParams({callbackUrl:window.destination});`
                : a.path === "next-auth/react"
                  ? `export async function signIn(){window.signInCalls++;if(window.outcome==='throw')throw Error('offline');return window.outcome;}`
                  : a.path === "next/link"
                    ? `import React from 'react';export default function Link(p){return React.createElement('a',p,p.children)}`
                    : `export const GoogleSignInButton=()=>null;`,
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
  try {
    for (const tier of ["vip", "premium"])
      for (const outcome of [
        { ok: true, error: null },
        { ok: false, error: "CredentialsSignin" },
        { ok: true, error: "UnexpectedError" },
        null,
        undefined,
        "throw",
      ]) {
        const page = await browser.newPage();
        page.setDefaultTimeout(5000);
        const errors: string[] = [];
        page.on("pageerror", (e: any) => errors.push(e.message));
        await page.setContent('<div id="root"></div>');
        await page.evaluate(
          ({ tier, outcome }: { tier: string; outcome: any }) => {
            (window as any).destination = `/pricing#plan-${tier}`;
            (window as any).outcome = outcome;
            (window as any).routes = [];
            (window as any).signInCalls = 0;
          },
          { tier, outcome },
        );
        await page.evaluate(`window.fetch=async()=>({ok:true});`);
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        await page
          .getByLabel("Email", { exact: true })
          .fill("auth-regression@example.invalid");
        await page
          .getByLabel("Password", { exact: true })
          .fill("Disposable-auth-test-only!");
        await page
          .getByRole("button", { name: "Create account", exact: true })
          .click();
        if (
          outcome &&
          typeof outcome === "object" &&
          outcome.ok &&
          !outcome.error
        ) {
          await page.waitForFunction(() => (window as any).routes.length === 1);
          assert.deepEqual(await page.evaluate(() => (window as any).routes), [
            `/pricing#plan-${tier}`,
          ]);
          checks++;
          assert.equal(await page.getByRole("alert").count(), 0);
          checks++;
        } else {
          await page
            .getByRole("alert")
            .filter({
              hasText: "Your account was created, but we couldn't sign you in",
            })
            .waitFor();
          checks++;
          assert.deepEqual(
            await page.evaluate(() => (window as any).routes),
            [],
          );
          checks++;
          assert.equal(
            await page
              .getByRole("link", { name: "Log in", exact: true })
              .getAttribute("href"),
            `/login?callbackUrl=${encodeURIComponent(`/pricing#plan-${tier}`)}`,
          );
          checks++;
        }
        assert.equal(await page.evaluate(() => (window as any).signInCalls), 1);
        checks++;
        assert.deepEqual(errors, []);
        checks++;
        await page.close();
      }
  } finally {
    await browser.close();
  }
  console.log(
    `Registration sign-in browser: ${checks} assertions passed (both plan returns; success, rejected/error, absent result and thrown failure)`,
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
