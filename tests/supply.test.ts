import { describe, expect, it } from "vitest";
import { pickProject, summarizeUnlocks, type AgProjectHit, type AgUnlock } from "@/lib/providers/alphagrowth";
import { kindOf, summarize } from "@/lib/providers/holders";
import { matchTicker, type PaprikaTicker } from "@/lib/providers/coinpaprika";
import { scoreFundamentals } from "@/lib/analysis/fundamentals";
import { faInputsWith } from "./fixtures";

const NOW = Date.parse("2026-01-01T00:00:00Z");
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

function unlock(o: Partial<AgUnlock> & { days: number; tokens: number; category?: string }): AgUnlock {
  return {
    gecko_id: "test",
    token: "TST",
    unlock_at: day(o.days),
    tokens: o.tokens,
    value_usd: o.value_usd ?? o.tokens,
    pct_of_circulating: o.pct_of_circulating ?? null,
    implausible: o.implausible ?? false,
    allocations: o.allocations ?? [{ category: o.category ?? "insiders", recipient: null, tokens: o.tokens, unlock_type: "cliff" }],
  };
}

describe("unlocks", () => {
  it("adds up cliff unlocks as a share of circulating supply, and who gets them", () => {
    const u = summarizeUnlocks(
      [unlock({ days: 10, tokens: 20, category: "insiders" }), unlock({ days: 60, tokens: 30, category: "privateSale" }), unlock({ days: 80, tokens: 50, category: "ecosystem" })],
      1000,
      "2026-01-01",
      NOW,
    );
    expect(u.next30).toBeCloseTo(0.02);
    expect(u.next90).toBeCloseTo(0.1);
    expect(u.insiderShare).toBeCloseTo(0.5);
    expect(u.events.map((e) => e.who[0])).toEqual(["team & advisors", "investors", "ecosystem"]);
  });

  it("merges a day's unlock entries into one row", () => {
    const u = summarizeUnlocks([unlock({ days: 5, tokens: 10, category: "insiders" }), unlock({ days: 5, tokens: 20, category: "privateSale" })], 1000, "2026-01-01", NOW);
    expect(u.events).toHaveLength(1);
    expect(u.events[0].share).toBeCloseTo(0.03);
    expect(u.events[0].who).toEqual(["team & advisors", "investors"]);
  });

  it("prefers the calendar's own share, and skips implausible schedules", () => {
    const u = summarizeUnlocks([unlock({ days: 5, tokens: 1, pct_of_circulating: 3 }), unlock({ days: 6, tokens: 1e12, implausible: true })], 1000, "2026-01-01", NOW);
    expect(u.next90).toBeCloseTo(0.03);
    expect(u.value90Usd).toBe(1);
  });

  it("doesn't count linear vesting changes as unlocked tokens, but notes them", () => {
    const u = summarizeUnlocks(
      [unlock({ days: 5, tokens: 0, allocations: [{ category: "liquidity", recipient: null, unlock_type: "linear_rate_change" }] })],
      1000,
      "2026-01-01",
      NOW,
    );
    expect(u.next90).toBe(0);
    expect(u.linear).toBe(true);
    expect(u.events).toEqual([]);
  });

  it("lowers the tokenomics score for a big unlock and ignores it when unknown", () => {
    const tokenomics = (unlocks90: number | null) => scoreFundamentals(faInputsWith({ circulatingRatio: 0.8, unlocks90 })).categories.find((c) => c.key === "tokenomics")?.score;
    expect(tokenomics(0.15) as number).toBeLessThan(tokenomics(0) as number);
    expect(tokenomics(null)).toBe(scoreFundamentals(faInputsWith({ circulatingRatio: 0.8 })).categories.find((c) => c.key === "tokenomics")?.score);
  });
});

describe("holder concentration", () => {
  const addr = (hash: string, o: { contract?: boolean; tag?: string } = {}) => ({ hash, is_contract: !!o.contract, name: null, metadata: o.tag ? { tags: [{ name: o.tag }] } : null });

  it("labels burn addresses, exchanges, contracts and wallets", () => {
    expect(kindOf(addr("0x000000000000000000000000000000000000dEaD")).kind).toBe("burn");
    expect(kindOf(addr("0x1", { tag: "Binance: Hot Wallet 20" })).kind).toBe("exchange");
    expect(kindOf(addr("0x2", { contract: true, tag: "Uniswap V2: UNI Timelock" })).kind).toBe("contract");
    expect(kindOf(addr("0x3")).kind).toBe("wallet");
  });

  it("takes burned tokens out of the supply and counts plain wallets separately", () => {
    const h = summarize("Ethereum", "Blockscout", 100, [
      { address: "0xdead", share: 0.5, kind: "burn", label: "Burn" },
      { address: "0xa", share: 0.2, kind: "wallet", label: null },
      { address: "0xb", share: 0.1, kind: "exchange", label: "Binance" },
    ]);
    expect(h.top10).toBeCloseTo(0.6);
    expect(h.top10Wallets).toBeCloseTo(0.4);
    expect(h.top.map((r) => r.address)).toEqual(["0xa", "0xb"]);
  });

  it("can't tell wallets apart without labels", () => {
    expect(summarize("Ethereum", "Ethplorer", null, [{ address: "0xa", share: 0.3, kind: null, label: null }]).top10Wallets).toBeNull();
  });
});

describe("CoinPaprika matching", () => {
  const t = (id: string, symbol: string, name: string, price: number, rank: number) => ({ id, symbol, name, rank, quotes: { USD: { price } } }) as unknown as PaprikaTicker;
  const list = [t("uni-uniswap", "UNI", "Uniswap", 5, 30), t("uni-unicorn", "UNI", "Unicorn", 0.01, 900)];

  it("matches by symbol and name", () => {
    expect(matchTicker(list, { symbol: "uni", name: "Uniswap" })?.id).toBe("uni-uniswap");
  });

  it("uses a recent price to pick between clashing tickers when names differ", () => {
    expect(matchTicker(list, { symbol: "UNI", name: "Uniswap Protocol", price: 0.011 })?.id).toBe("uni-unicorn");
    expect(matchTicker(list, { symbol: "UNI", name: "Uniswap Protocol" })).toBeNull();
  });
});

describe("AlphaGrowth project matching", () => {
  const hit = (slug: string, symbol: string | null, mcap: number | null): AgProjectHit => ({ slug, name: "Ethena", symbol, market_cap_usd: mcap, page: "" });
  const coin = { id: "ethena", name: "Ethena", symbol: "ENA", marketCap: 1.3e9 };

  it("prefers the listing whose slug is the coin's id over a near-duplicate", () => {
    expect(pickProject([hit("ethena-x6i", "ena", 1.31e9), hit("ethena", "ENA", 1.31e9)], coin)?.slug).toBe("ethena");
  });

  it("otherwise takes the same ticker with the closest market cap, within 3x", () => {
    expect(pickProject([hit("ena-old", "ENA", 9e9), hit("ena-main", "ENA", 1.2e9)], { ...coin, id: "x" })?.slug).toBe("ena-main");
    expect(pickProject([hit("ena-old", "ENA", 9e9)], { ...coin, id: "x" })).toBeNull();
  });
});
