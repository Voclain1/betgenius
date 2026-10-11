import type { Metadata } from "next";
import Link from "next/link";
import { readUnsubscribeToken, UNSUBSCRIBE_LABEL } from "@/lib/mail/unsubscribe";
import { UnsubscribeButton } from "@/components/UnsubscribeButton";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

/**
 * Where the Unsubscribe link in an email lands. Showing the page changes
 * nothing — the button does — because mail providers open links to scan them,
 * and a page that unsubscribed on load would unsubscribe people who never
 * clicked. See /api/email/unsubscribe.
 */
export default function UnsubscribePage({ searchParams }: { searchParams: { t?: string } }) {
  const parsed = readUnsubscribeToken(searchParams.t);
  return (
    <div className="mx-auto max-w-lg space-y-4 py-10">
      <h1 className="text-3xl font-bold">Unsubscribe</h1>
      {parsed ? (
        <>
          <p className="text-gray-300">Stop receiving {UNSUBSCRIBE_LABEL[parsed.kind]}? Receipts and messages about your account and payments will still reach you.</p>
          <UnsubscribeButton token={searchParams.t!} label={UNSUBSCRIBE_LABEL[parsed.kind]} />
        </>
      ) : (
        <p className="text-gray-300">
          This unsubscribe link isn&apos;t valid. It may have been cut short when it was copied. You can manage every email from your{" "}
          <Link href="/notifications" className="font-medium text-brand underline">notification settings</Link>.
        </p>
      )}
    </div>
  );
}
