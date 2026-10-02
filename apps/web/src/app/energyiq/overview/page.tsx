import { redirect } from "next/navigation";

/** "/energyiq/overview" is the address people and older links use for the Overview, which lives at /key-points. */
export default async function OverviewAddress({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") query.set(key, value);
  }
  redirect(`/energyiq/key-points${query.size ? `?${query.toString()}` : ""}`);
}
