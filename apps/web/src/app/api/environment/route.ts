// Which deployment this web server belongs to, read at request time so one release artifact can be promoted from
// staging to production unchanged.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Response {
  const declared = process.env.ENERGYX_ENVIRONMENT?.trim().toLowerCase();
  const environment = declared === "staging" || declared === "development" || declared === "production"
    ? declared
    : process.env.NODE_ENV === "production" ? "production" : "development";
  return Response.json({ environment }, { headers: { "Cache-Control": "no-store" } });
}
