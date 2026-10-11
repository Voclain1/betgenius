# Editorial and release workflow

Who approves what reaches readers, the checks it passes first, and how it is
undone. Covers SEO-006. Roles are named by GitHub account; there is one
owner today, so every approval and rollback sits with them.

| Role | Who |
|---|---|
| Approver (content and code) | Repository owner, GitHub `Voclain1` |
| Rollback owner | Repository owner, GitHub `Voclain1` |
| Drafting | The owner, or Claude Code sessions working on the owner's request |

## Content

### Predictions

1. Generation writes every pick as `PENDING_REVIEW`. Nothing ordinary
   publishes itself (`src/lib/generation/worker.ts`).
2. The approver reads the pick and its reasoning in Admin → Predictions and
   publishes, edits or archives it. A pick whose match has kicked off can no
   longer be approved or published (`reviewBlockedByKickoff`).
3. Exceptions, each gated more strictly than a human review: the Goals pass
   and the VIP/Premium pass auto-publish only picks that clear their own
   market gates (`docs/GENERATION_SCHEDULING.md`). The European-club lane
   archives anything that is not Market-Confirmed, and the one draft it
   keeps still waits for a human (`docs/EUROPEAN_CLUB_COVERAGE.md`).
4. Settled results are never edited to improve the record. A wrong
   settlement is corrected on the prediction's admin page (Admin →
   Predictions → the pick → outcome), from the real score.

### Guides and other editorial pages

1. Drafted in `src/content/guides.tsx` (or the page file) on a branch.
2. QA gates:
   - `npx tsx scripts/check-seo.ts` passes. It checks unique slugs, that
     every related link resolves, that each guide links into the product,
     that worked examples are arithmetically right and that the copy makes
     no certainty promises.
   - The approver reads the whole piece on the Vercel preview, on a phone,
     before merging: facts, tone, responsible-betting framing, links.
3. Set `reviewedAt` to the date of that review. It is shown on the page and
   used as the sitemap `lastmod`, so update it whenever a guide is revised.
4. Attribution is the BetGenius Editorial Desk (`src/lib/editorialTeam.ts`);
   no invented individual authors.

## Code and configuration

1. Every change goes through a pull request into `master`. No direct pushes.
2. QA gates before merge:
   - `npm run preflight` passes locally: pure checks plus `tsc`, no database
     and no network (`docs/PREFLIGHT.md`).
   - GitHub `preflight` is green: the schema matches the live database,
     typecheck, production build.
   - The Vercel preview deploys, and the approver checks the changed pages on
     it, at 390px and desktop width for anything visual.
3. Schema changes are additive only. Run Actions → **db-push** on the PR's
   branch **before** merging, then re-run preflight. The workflow refuses
   drops, type changes and renames.
4. Anything run by cron-job.org (a new `?european=1` style pass) is not live
   until its scheduler entry exists. Add it in the same session as the merge
   and confirm the first run in `/admin/jobs`.
5. Squash-merge with the PR title as the commit title.

## Rollback

The rollback owner decides, and acts within the hour once a release is
confirmed broken.

| What went wrong | Undo |
|---|---|
| A deploy breaks pages | Vercel → Deployments → the last good deployment → **Instant Rollback**. Then revert the PR on GitHub so the next deploy does not bring it back. |
| A wrong or harmful published pick | Admin → Predictions → Archive. It leaves every feed at once. |
| A guide or page with a factual error | Revert or fix by PR; set `reviewedAt` again on the corrected version. |
| A scheduled pass misbehaving | Pause its entry on cron-job.org. Nothing else needs touching; every pass stands down on its own when not poked. |
| A schema change | Additive only, so an older deploy keeps working against the newer database. Roll back the code; leave the columns. |
| Email | Unset `RESEND_API_KEY` in Vercel and redeploy to stop all sending (`docs/EMAIL.md`). |

## After release

- Check the changed pages on the live site, and Search Console URL
  inspection for any new indexable page.
- Record the release in the SEO tracker (`docs/SEO_GROWTH_PROGRAMME.md`)
  when it closes or advances an SEO item.
