/**
 * Client helper for the admin forms: run a save, and if the server says the
 * teams do not match the chosen competition (HTTP 409 LEAGUE_TEAM_MISMATCH),
 * ask the admin to confirm and send it again with the confirmation flag.
 * Returns the response the caller should read.
 */
export async function withLeagueConfirm(send: (leagueConfirmed: boolean) => Promise<Response>): Promise<Response> {
  const first = await send(false);
  if (first.status !== 409) return first;
  const body = await first.clone().json().catch(() => null);
  if (body?.code !== "LEAGUE_TEAM_MISMATCH") return first;
  if (typeof window !== "undefined" && window.confirm(`${body.error}\n\nSave it under this competition anyway?`)) return send(true);
  return first;
}
