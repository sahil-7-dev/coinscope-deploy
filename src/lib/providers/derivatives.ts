// Perpetual futures data (funding rate, open interest) from Binance, falling
// back to Bybit. Public endpoints, no key. Matched by ticker symbol, then checked
// against the spot price so a different coin with the same ticker is rejected.

import type { Derivatives } from "@/lib/types";
import { cached, MINUTE } from "@/lib/server/cache";
import { getJson } from "@/lib/server/http";

const change = (now: number | undefined, then: number | undefined) => (now && then ? now / then - 1 : null);

/** Futures mark price should be within 10% of spot (after the 1000× multiplier). */
const priceMatches = (mark: number, spot: number, multiplier: number) => spot > 0 && Math.abs(mark / multiplier / spot - 1) < 0.1;

async function fromBinance(symbol: string, spot: number): Promise<Derivatives | null> {
  for (const [contract, multiplier] of [
    [`${symbol}USDT`, 1],
    [`1000${symbol}USDT`, 1000],
  ] as const) {
    try {
      const idx = await getJson<{ markPrice: string; lastFundingRate: string }>(
        `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${contract}`,
        { timeoutMs: 8000 },
      );
      if (!priceMatches(Number(idx.markPrice), spot, multiplier)) continue;
      const hist = await getJson<{ sumOpenInterestValue: string }[]>(
        `https://fapi.binance.com/futures/data/openInterestHist?symbol=${contract}&period=1d&limit=30`,
        { timeoutMs: 8000 },
      ).catch(() => []);
      const oi = hist.map((h) => Number(h.sumOpenInterestValue));
      const last = oi[oi.length - 1];
      return {
        venue: "Binance",
        symbol: contract,
        fundingRate: Number(idx.lastFundingRate),
        openInterestUsd: last ?? null,
        oiChange7d: change(last, oi[oi.length - 8]),
        oiChange30d: change(last, oi[0]),
      };
    } catch {
      // not listed under this contract name, or Binance unreachable
    }
  }
  return null;
}

async function fromBybit(symbol: string, spot: number): Promise<Derivatives | null> {
  for (const [contract, multiplier] of [
    [`${symbol}USDT`, 1],
    [`1000${symbol}USDT`, 1000],
  ] as const) {
    try {
      const t = await getJson<{ result?: { list?: { markPrice: string; fundingRate: string; openInterestValue: string }[] } }>(
        `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${contract}`,
        { timeoutMs: 8000 },
      );
      const row = t.result?.list?.[0];
      if (!row || !priceMatches(Number(row.markPrice), spot, multiplier)) continue;
      const hist = await getJson<{ result?: { list?: { openInterest: string }[] } }>(
        `https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${contract}&intervalTime=1d&limit=30`,
        { timeoutMs: 8000 },
      ).catch(() => ({ result: { list: [] } }));
      const oi = (hist.result?.list ?? []).map((h) => Number(h.openInterest)); // newest first
      return {
        venue: "Bybit",
        symbol: contract,
        fundingRate: Number(row.fundingRate),
        openInterestUsd: Number(row.openInterestValue) || null,
        oiChange7d: change(oi[0], oi[7]),
        oiChange30d: change(oi[0], oi[oi.length - 1]),
      };
    } catch {
      // not listed
    }
  }
  return null;
}

export const getDerivatives = (symbol: string, spotPrice: number) =>
  cached(`deriv:${symbol}`, 10 * MINUTE, async () => {
    const sym = symbol.toUpperCase();
    if (!/^[A-Z0-9]{2,15}$/.test(sym)) return null;
    return (await fromBinance(sym, spotPrice)) ?? (await fromBybit(sym, spotPrice));
  });
