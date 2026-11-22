import { cached, MINUTE } from "@/lib/server/cache";
import { getJson } from "@/lib/server/http";

interface FngResponse {
  data: { value: string; value_classification: string; timestamp: string }[];
}

/** Crypto Fear & Greed index from alternative.me (latest + last 30 days, oldest first). */
export const getFearGreed = () =>
  cached("fng:30", 30 * MINUTE, async () => {
    const res = await getJson<FngResponse>("https://api.alternative.me/fng/?limit=30");
    const rows = res.data ?? [];
    if (!rows.length) return null;
    return {
      value: Number(rows[0].value),
      label: rows[0].value_classification,
      history: rows
        .map((r) => ({ date: new Date(Number(r.timestamp) * 1000).toISOString().slice(0, 10), value: Number(r.value) }))
        .reverse(),
    };
  });
