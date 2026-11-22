// Decision journal storage and pricing. Logging a decision records what the
// app said at that moment (verdict, score, narrative stage, your thesis) and
// the coin's and BTC's prices, so the result can be judged later.

import { buildProfiles } from "@/lib/analysis/profile";
import { verdictFor } from "@/lib/analysis/verdict";
import { decisionResult, journalSummary, MIN_DAYS } from "@/lib/analysis/journal";
import * as cg from "@/lib/providers/coingecko";
import { livePrice } from "@/lib/providers/binance";
import { matchTicker, paprikaTickers } from "@/lib/providers/coinpaprika";
import { cryptoProvider } from "@/lib/providers/crypto";
import { longBars } from "@/lib/server/history";
import { addDecision, closeDecision, getDecision, getResearch, listDecisions } from "@/lib/server/db";
import type { Decision, DecisionAction, JournalResponse } from "@/lib/types";

export class JournalError extends Error {}

const today = () => new Date().toISOString().slice(0, 10);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkDate(on: string | undefined): string {
  const date = on || today();
  if (!DATE.test(date) || Number.isNaN(Date.parse(date))) throw new JournalError("Use a date like 2026-11-22");
  if (date > today()) throw new JournalError("The date can't be in the future");
  return date;
}

/** BTC's close on a past day (Binance), or its live price today. */
async function btcOn(date: string): Promise<number> {
  if (date === today()) {
    const ref = (await cg.getMarkets().catch(() => [])).find((c) => c.id === "bitcoin")?.current_price ?? 0;
    const live = ref ? await livePrice("BTC", ref) : null;
    if (live?.price || ref) return live?.price ?? ref;
  }
  const bars = await longBars("BTC");
  const bar = [...(bars ?? [])].reverse().find((b) => b.date <= date);
  if (!bar) throw new JournalError("Couldn't find BTC's price for that date");
  return bar.close;
}

/** A coin's close on a past day within the last year (CoinGecko's daily chart). */
async function coinOn(coinId: string, date: string): Promise<number | null> {
  const chart = await cg.getMarketChart(coinId, 365).catch(() => null);
  const point = [...(chart?.prices ?? [])].reverse().find(([ms]) => new Date(ms).toISOString().slice(0, 10) <= date);
  return point ? point[1] : null;
}

/**
 * Current prices for many coins: the cached top-250 list first, then
 * CoinPaprika (free) for the rest, CoinGecko's batched price call only for
 * what's still missing, then Binance's live price where listed.
 */
async function currentPrices(coins: { coinId: string; symbol: string; name: string; price?: number }[]): Promise<Map<string, number>> {
  const markets = new Map((await cg.getMarkets().catch(() => [])).map((c) => [c.id, c.current_price]));
  const tickers = coins.some((c) => !markets.get(c.coinId)) ? await paprikaTickers().catch(() => null) : null;
  const paprika = new Map(
    coins.flatMap((c) => {
      const t = !markets.get(c.coinId) && tickers ? matchTicker(tickers, { symbol: c.symbol, name: c.name }) : null;
      return t ? [[c.coinId, t.quotes.USD.price] as const] : [];
    }),
  );
  const missing = [...new Set(coins.filter((c) => !markets.get(c.coinId) && !paprika.get(c.coinId)).map((c) => c.coinId))];
  const simple = missing.length ? await cg.getSimplePrices(missing).catch(() => ({}) as Record<string, { usd?: number }>) : {};
  const out = new Map<string, number>();
  await Promise.all(
    coins.map(async (c) => {
      const ref = markets.get(c.coinId) ?? paprika.get(c.coinId) ?? simple[c.coinId]?.usd ?? null;
      if (!ref) return;
      const live = await livePrice(c.symbol, ref);
      out.set(c.coinId, live?.price ?? ref);
    }),
  );
  return out;
}

export async function logDecision(input: { coinId: string; action: DecisionAction; decidedOn?: string; price?: number | null; note?: string }): Promise<Decision> {
  if (input.action !== "buy" && input.action !== "pass") throw new JournalError("Action must be buy or pass");
  const on = checkDate(input.decidedOn);
  const res = await buildProfiles(cryptoProvider, [input.coinId]);
  const p = res.profiles[0];
  if (!p) throw new JournalError(res.errors[0]?.message ?? "Coin not found");
  const research = (await getResearch([p.id]))[p.id] ?? null;
  const v = verdictFor(p, { research });

  const price = input.price && input.price > 0 ? input.price : on === today() ? p.price : await coinOn(p.id, on);
  if (!price) throw new JournalError("No price on record for that date: enter the price you paid");
  return addDecision(
    {
      coinId: p.id,
      symbol: p.symbol.toUpperCase(),
      name: p.name,
      image: p.image,
      action: input.action,
      decidedOn: on,
      price,
      btcPrice: await btcOn(on),
      note: (input.note ?? "").slice(0, 2000),
    },
    {
      verdict: v.kind,
      verdictLabel: v.label,
      score: v.fundamentals.score,
      confidence: v.fundamentals.confidence,
      sector: p.narrative?.sector ?? null,
      stage: p.narrative?.stage ?? null,
      attention: p.narrative?.attention ?? null,
      thesis: research?.thesis?.summary ?? "",
    },
  );
}

/** Marks a buy as sold, at today's price or a given date and price; `reopen` undoes it. */
export async function closeBuy(id: number, input: { closedOn?: string; price?: number | null; reopen?: boolean }): Promise<void> {
  const d = await getDecision(id);
  if (!d) throw new JournalError("Decision not found");
  if (input.reopen) return closeDecision(id, null);
  if (d.action !== "buy") throw new JournalError("Only buys can be sold");
  const on = checkDate(input.closedOn);
  if (on < d.decidedOn) throw new JournalError("The sell date is before the buy");
  const price = input.price && input.price > 0 ? input.price : on === today() ? (await currentPrices([d])).get(d.coinId) : await coinOn(d.coinId, on);
  if (!price) throw new JournalError("No price on record for that date: enter the price you sold at");
  await closeDecision(id, { on, price, btcPrice: await btcOn(on) });
}

export async function journal(): Promise<JournalResponse> {
  const decisions = await listDecisions();
  const open = decisions.filter((d) => d.closedOn === null);
  const [prices, btc] = await Promise.all([currentPrices(open), decisions.length ? btcOn(today()).catch(() => null) : Promise.resolve(null)]);
  const results = decisions.map((d) => decisionResult(d, { price: prices.get(d.coinId) ?? null, btcPrice: btc }, today()));
  return { decisions: results, minDays: MIN_DAYS, summary: journalSummary(results), updatedAt: new Date().toISOString() };
}
