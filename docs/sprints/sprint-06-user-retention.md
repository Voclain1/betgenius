# Sprint 06 — User Retention & Return Experience

A returning-user sprint, kept deliberately small. The audit found most of what
a returning reader needs already built in Sprint 01 (dashboard, saved
predictions, follows, preferences, onboarding, notification settings). What was
missing was reach and correctness on a phone: the user's own sections were far
down the page, one account page was unreachable from the dashboard, and several
account pages overflowed sideways at narrow widths. This sprint fixes those,
adds three privacy-safe analytics events, and builds nothing that nags.

Starting master: `1978bde` (PR #184 merged). PR #189 (forecasting research) is
open and was not touched. No schema, no migration, no new request, no new
service, no push or email.

## 1. Existing retention feature inventory

| Capability | Where | State |
| --- | --- | --- |
| Account dashboard: For you today, Upcoming for you, Saved, Favourites, categories | `/dashboard` (`OverviewSection`) | exists (Sprint 01) |
| Saved predictions with snapshots, filters, settlement | `/dashboard/saved`, `SavedRow` | exists |
| Follows (teams, competitions, tips, categories) in `UserFollow` | `/following`, `FollowButton`, `/api/follows` | exists; page sits outside the dashboard shell |
| Preferences, timezone, onboarding, welcome flow | `/dashboard/preferences`, `/dashboard/welcome` | exists |
| Notification and email settings | `/notifications`, `/email` | exists; linked from Account |
| Account menu with Saved and Following | `Nav` | exists (Sprint 01) |
| Analytics: `dashboard_view`, save/unsave, follow, preference and onboarding events | `src/lib/engagement.ts` | exists; no event for the saved list, Following, or shortcuts |
| A last-visit timestamp | — | **does not exist** (verified: no such column) |

## 2. Verified returning-user friction

Measured on a real build with seeded demo users (a returning VIP user with 5
saved picks and 3 follows, a free user with none, a brand-new account), at 320,
375, 414, 768 and 1440px.

1. **The reader's own sections are far down.** On a 375px phone the Saved
   section starts 1,226px down (Favourites at 2,024px), under up to eight of
   today's picks. There was no way to jump to it.
2. **Following was not reachable from the dashboard.** No dashboard page linked
   to `/following` (0 of 20 measured dashboard and saved-list views); it was
   only in the public account menu. `/following` has none of the dashboard's
   navigation and no link back.
3. **Sideways page overflow on account pages (6 of 30 measured views):**
   `/dashboard/saved` at 320, 375 and 414px (page 437px wide: a scrolling filter
   bar inside a flex column that could not shrink), `/dashboard` at 320px, and
   `/following` at 320px for any signed-in reader.
4. **The signed-in header was too tight on a phone.** At 320px the theme toggle
   was squeezed to 18px (30px at 360px) and the bar overflowed by 12px: the
   menu button was 54px wide because `.btn`'s padding overrides `p-2`.
5. **A closed phone sidebar stayed in the keyboard and screen-reader order:** 20
   off-screen controls were focusable behind the page.
6. **Following used a fixed WAT** for kickoffs while the dashboard and saved
   list honour the reader's saved timezone; and it showed no result or status,
   so a finished match looked like an upcoming one.
7. **"Recently settled" was not recent:** it lists the latest results with no
   time window, so a result from months ago was labelled "recently"; and a
   settled row did not say when it settled.
8. **No measurement** for opening the saved list, the Following feed, or a
   shortcut.

Checked and found fine, so left alone: the saved list's filters and snapshot
rules, the account menu, the welcome redirect for new accounts, empty states on
the dashboard, premium masking on saved and following rows, no polling.

## 3. Protected-workstream ownership matrix

| Area | Owner | Sprint 06 |
| --- | --- | --- |
| Prediction discovery, evidence, market comparison, publishing, odds (merged #184) | VIP Reliability | not touched; no import from it |
| Forecasting research (`research/**`, research workflow and docs, PR #189) | Forecasting research | not touched; no import |
| Generation, selection, settlement, odds collection, entitlements, payments | protected | not touched |
| Dashboard, saved list, Following page, account sidebar, header, engagement events | Sprint 01 personalization | edited here |
| `package.json` | shared | script lines only, mid-block |

Overlap with #189's 36 files: `package.json` only. No file under `research/`,
`docs/research/` or `.github/` was changed. A static test fails if any edited
file imports from discovery, odds, generation, settlement or research.

## 4. Changes implemented

- **Jump row** (`JumpRow`, `src/lib/returnShortcuts.ts`): one line of four text
  links under the dashboard greeting, below `lg` only — Upcoming, Saved,
  Favourites (in-page anchors to the sections that already exist) and Following.
  A count shows only when positive, from data the dashboard already loaded. A
  tap on Saved lands the section at the top of a 375px screen (was 1,226px
  away). No second dashboard, no new cards.
- **Following in the account sidebar**, next to Saved predictions, and a small
  account links row on the Following page (Dashboard, Saved predictions,
  Preferences). An empty Following offers "Choose teams and competitions".
- **Following feed card** (`FollowingFeedCard`): kickoff in the reader's own
  timezone; a recorded result with FT score for readers allowed to see it;
  "Awaiting result" / "Kicked off" for a match past kickoff with no result;
  nothing for an upcoming match; a locked row shows neither pick nor result.
  Ordering and query are unchanged.
- **Saved rows** say when a result was recorded ("settled 13 Nov", from the
  stored settlement time, unlocked picks only) and the dashboard heading is now
  "Latest results". The saved price is still the snapshot, labelled "when saved".
- **Layout and access fixes:** the shell's content column can shrink (`min-w-0`);
  a closed phone sidebar is `invisible`, so it leaves the tab and reading order;
  the signed-in header fits at 320px (menu button padding fixed; the app-download
  icon is hidden below 360px, the drawer entry stays) and every control is at
  least 36px.
- **Analytics** (three events, fixed enums only — see section 9).

## 5. Intentionally excluded

- **"Since your last visit".** No last-visit time exists. Adding one means a new
  column written on page requests (a write path on every visit, a migration,
  and a new piece of personal data), and "new since you looked" would also be
  wrong across devices. Rejected as not worth its cost or privacy weight. The
  existing timestamps (`settledAt`, `savedAt`, kickoff) are shown instead, so
  readers see what settled and when. The data to do this properly is documented
  in section 11.
- Notifications, email, push, SMS, WhatsApp, streaks, leaderboards, urgency
  copy, upsell prompts, a second dashboard or account menu, a new messaging
  system, changes to the homepage or category pages, anything in prediction
  generation, discovery, odds or settlement.

## 6. Before and after

`docs/sprints/screenshots/sprint-06/{before,after}/` — real renders of the
running app, `before` = `master`, `after` = this branch, with the same seeded
users. **Demonstration data:** a throwaway local database with invented
fixtures and demo accounts (a VIP reader, a free reader, a new account); not
production. Crests are blocked images in this environment.

| Measure (320/375/414/768/1440px, 30 views) | Before | After |
| --- | --- | --- |
| Views with sideways page overflow | 6 | 0 |
| Saved section position on a 375px phone | 1,226px down | one tap (top of screen) |
| Dashboard views linking to Following | 0 of 20 | 20 of 20 |
| Focusable controls behind a closed phone sidebar | 20 | 0 |
| Signed-in header at 320px | 332px wide; theme toggle 18px | fits; all controls ≥ 36px |

## 7. Tests

| Check | Result |
| --- | --- |
| `check-return-experience` (shortcuts, anchors, nav, analytics privacy/duplicates, no last-visit, boundaries) | 45 pass |
| `check-return-experience-render` (jump row, settled dates, Following card incl. timezone and masking, sidebar) | 26 pass |
| `check-return-experience-browser` (Chromium, 320/360/375/414/768/1440; fails on the old shell and header: page 483px, 21 focusable, theme 18px) | pass |
| Real-app journey on the built site (below) | 26 pass |
| Sprint 01–05 checks (personalization, prediction-experience, category-navigation, odds-presentation, SEO, nav-fit) | pass |
| `tsc --noEmit`, `next build`, page budgets | pass |
| `npm run preflight` (site up) | 100/103 |
| Integration, one at a time, throwaway Postgres: tier-provenance 30, vip-premium-gate 30, betofday-targeting 7, personalization-db 65, match-centre-db 9, prediction-experience-db 9 | all pass |

The three preflight failures are baseline, unrelated to this branch:
`check-house-banners` and `check-goals-category` (fail on `master`) and
`check-db-safety` (only because a local `.env` database identity is present).
`check-sitemap-scoping` now passes: PR #184 fixed it.

**Real-app journey (seeded demo users, built site, GA stubbed to capture
events):** signed-out `/dashboard`, `/dashboard/saved` and `/following` redirect
to sign-in with a way back and show nothing private; a new account lands in the
welcome flow and sees an honest empty Following; a free reader's followed and
saved VIP picks are locked (no pick, market or price); the free reader's jump row
shows the real counts; the returning reader's jump row reads "Saved 5",
"Favourites 3"; tapping Saved scrolls it into view; `dashboard_view` fired once
with a 0/1 flag; the shortcut sent `target` and `surface` only; the sidebar
Following click reported `sidebar`; `following_view` sent a bucket; Following
showed WAT kickoffs, a result with FT score and "Awaiting result"; the saved list
showed "settled 13 Nov" and "when saved"; no event contained a name, email, team,
id or pick.

## 8. Security and privacy review

- No schema, migration, route, query or write was added; `/following` and the
  saved list keep their existing server-side gating, and the Following card
  receives the page's own `allowed` decision per row. Status (clock label) is
  shown for locked rows, a result and score are not.
- Settlement dates appear only for picks the reader can see.
- Analytics carry two or one fixed word(s) plus `page_template`; follows are
  bucketed (`0`, `1_5`, `6_plus`). A static test fails if a registered
  parameter looks like a name, email, id, label, team, pick or odds.
- No new third party, no cookie, no storage, no polling, no external request.
- Unauthenticated access is unchanged (redirect to sign-in).

## 9. Analytics measurement plan

New events (registered in `PERSONALIZATION_EVENTS`, listed in
`docs/SEO_ANALYTICS_EVENTS.md`): `saved_view {filter}`, `following_view
{follows}`, `account_shortcut {target, surface}`. `dashboard_view` already
existed and is not duplicated; each tracker fires once per mount. In GA4
register `filter`, `follows`, `target` and `surface` as event-scoped custom
dimensions (they collect only from registration).

None of these events measures retention by itself; they show that a useful
thing was done. Meaningful outcomes, from GA4 with no new tool:

- **Returning-reader rate:** engaged users who also have a session in an
  earlier period, out of all engaged users, over a fixed window (Explore →
  Cohort exploration, return criteria "any event"; or Retention overview).
  Report it for visitors who have signed in (an audience of users with
  `dashboard_view` in the last 28 days) to avoid counting anonymous traffic.
- **Repeat engagement:** among users with `dashboard_view`, the share with
  `saved_view`, `following_view` or `prediction_save` on at least two different
  days in 28 days (Explore → Free form, rows `Date`, filter on event name,
  `Users`).
- **Shortcut use:** `account_shortcut` count by `target` and `surface`
  (jump row against account menu against sidebar), divided by `dashboard_view`
  sessions on `<lg` devices, shows whether the jump row is actually used.
- **Saved depth:** `saved_view` by `filter` (a rising share of `settled`,
  `won`, `lost` means readers come back for results).
- Caveats: consent-denied sessions send nothing; exact follow counts and
  identities are deliberately absent; compare periods, not single days.

## 10. Performance impact

No new request, query, dependency or client state. Budgets pass (75 pages):
shared JS 110.4 → 110.5 KB; match page 158.2 → 159.2 KB of 160 (+1.0 KB: the
header now reports account shortcut clicks). Dashboard +0.2 kB, saved +0.15 kB,
Following +1.4 kB (tracker and card). **The match page has under 1 KB of
headroom left.**

## 11. Known limitations

- The match page budget margin is thin (159.2 of 160 KB).
- The jump row is below `lg` only; on desktop the sections already sit side by
  side.
- Following keeps its public-layout chrome and its existing order (latest
  kickoff first); reordering would change the query and was left alone.
- A real "since your last visit" summary would need a last-active record. If
  wanted later: a nullable timestamp on `UserPreference`, updated at most once a
  day from the dashboard (not on every request), cleared by the existing
  preferences reset, with a privacy note; the summary would then count saved
  picks whose `settledAt` is after it. Not built here (section 5).
- Demonstration data only; no production capture.

## 12. Merge readiness

Ready for review. Merges cleanly into `master`; the only shared file with #189
is `package.json` (separate script lines). Not merged or deployed.
