/**
 * The generation kickoff window.
 *
 * Extracted from generation/selector so modules that only need the BOUNDS do
 * not have to import the selector itself. generation/paidTierGrace is imported
 * BY the selector, so it importing these from there would close a cycle; the
 * numbers are load-bearing in four places and must not be duplicated to avoid
 * one. selector re-exports them, so every existing importer is unaffected.
 */

/**
 * Nothing auto-publishes, so a prediction generated closer than this is likely
 * to reach kickoff unreviewed and be wasted effort. The sweet spot the ordering
 * actually targets is ~24-36h out: firm enough team news, and a full review
 * cycle still ahead of it.
 */
export const GENERATE_FROM_HOURS = 12;
export const SAME_DAY_GENERATE_FROM_HOURS = 2;
export const GENERATE_UNTIL_HOURS = 48;
