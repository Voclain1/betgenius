import type { Metadata } from "next";
import { InstallAppPanel } from "@/components/InstallAppPanel";
import { SITE_NAME } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Get the app",
  description: `Install ${SITE_NAME} on your phone's home screen: today's tips, livescores and your VIP picks in one tap.`,
  alternates: { canonical: "/app" },
};

/**
 * The permanent home of the app offer. The bottom banner can be dismissed;
 * this page, linked from the header and footer, cannot — so someone who said
 * "not now" can always change their mind.
 *
 * Copy describes only what is true of the installed app: it is this site,
 * launched from the home screen, so it is always current and there is no
 * store listing or file to download.
 */
export default function GetTheAppPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8 py-4">
      <div className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Get the BetGenius app</h1>
        <p className="text-base leading-7 text-gray-300">
          Put BetGenius on your home screen and open today&apos;s tips, livescores and your VIP picks in one tap, full screen,
          without the browser bar.
        </p>
      </div>
      <InstallAppPanel />
      <ul className="space-y-3 text-sm leading-6 text-gray-400">
        <li><strong className="text-gray-200">Always up to date.</strong> The app loads the live site, so new tips and fixes reach you without an update.</li>
        <li><strong className="text-gray-200">Small.</strong> It installs in seconds and takes almost no space on your phone.</li>
        <li><strong className="text-gray-200">Same account.</strong> Sign in and your plan and follows are all there.</li>
      </ul>
    </div>
  );
}
