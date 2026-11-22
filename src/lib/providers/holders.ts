// Who holds a token: the top holders' share of supply on Ethereum (or Optimism).
// Blockscout first, since it labels exchanges, contracts and burn addresses, so
// concentration can count plain wallets only; Ethplorer's public free key as a
// backup on Ethereum (shares only, no labels). Other chains' explorers block
// server requests, so tokens only on those chains get no reading.

import { getJson } from "@/lib/server/http";
import { cachedPersistent, MINUTE } from "@/lib/server/cache";
import { countApiCall } from "@/lib/server/db";
import type { HolderConcentration, HolderKind } from "@/lib/types";

/** CoinGecko platform id → chain name and Blockscout host. */
const CHAINS: [string, string, string][] = [
  ["ethereum", "Ethereum", "eth.blockscout.com"],
  ["optimistic-ethereum", "Optimism", "explorer.optimism.io"],
];
const TOP = 10;
const BURN = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]);
const EXCHANGE = /hot wallet|cold wallet|exchange|deposit|binance|coinbase|okx|kraken|bybit|bitfinex|kucoin|gate\.io|htx|huobi|upbit|bithumb|crypto\.com|robinhood|bitget|mexc/i;

export interface BsAddress {
  hash: string;
  is_contract: boolean;
  name: string | null;
  metadata?: { tags?: { name?: string }[] } | null;
}

interface BsToken {
  total_supply: string | null;
  holders_count: string | null;
}

export function kindOf(a: BsAddress): { kind: HolderKind; label: string | null } {
  const tags = (a.metadata?.tags ?? []).map((t) => t.name ?? "").filter(Boolean);
  const label = tags[0] ?? a.name ?? null;
  const text = [...tags, a.name ?? ""].join(" ");
  if (BURN.has(a.hash.toLowerCase()) || /\bburn\b|null:/i.test(text)) return { kind: "burn", label: label ?? "Burn address" };
  if (EXCHANGE.test(text)) return { kind: "exchange", label };
  return { kind: a.is_contract ? "contract" : "wallet", label };
}

/** Shares of supply after taking burned tokens out. */
export function summarize(chain: string, source: HolderConcentration["source"], holders: number | null, rows: { address: string; share: number; kind: HolderKind | null; label: string | null }[]): HolderConcentration {
  const burned = rows.filter((r) => r.kind === "burn").reduce((s, r) => s + r.share, 0);
  const live = 1 - burned;
  const top = rows
    .filter((r) => r.kind !== "burn")
    .slice(0, TOP)
    .map((r) => ({ ...r, share: live > 0 ? r.share / live : r.share }));
  const labeled = top.every((r) => r.kind !== null);
  return {
    chain,
    source,
    holders,
    top10: top.reduce((s, r) => s + r.share, 0),
    top10Wallets: labeled ? top.filter((r) => r.kind === "wallet").reduce((s, r) => s + r.share, 0) : null,
    top,
    asOf: new Date().toISOString(),
  };
}

async function fromBlockscout(chain: string, host: string, address: string): Promise<HolderConcentration | null> {
  await countApiCall("blockscout").catch(() => {});
  const [token, list] = await Promise.all([
    getJson<BsToken>(`https://${host}/api/v2/tokens/${address}`),
    getJson<{ items: { address: BsAddress; value: string }[] }>(`https://${host}/api/v2/tokens/${address}/holders`),
  ]);
  const supply = Number(token.total_supply);
  if (!(supply > 0) || !list.items.length) return null;
  // Raw integer amounts: the ratio of two big numbers is fine as floats.
  const rows = list.items.slice(0, TOP + 3).map((it) => ({ address: it.address.hash, share: Number(it.value) / supply, ...kindOf(it.address) }));
  return summarize(chain, "Blockscout", Number(token.holders_count) || null, rows);
}

async function fromEthplorer(address: string): Promise<HolderConcentration | null> {
  await countApiCall("ethplorer").catch(() => {});
  const res = await getJson<{ holders?: { address: string; share: number }[] }>(`https://api.ethplorer.io/getTopTokenHolders/${address}?apiKey=freekey&limit=${TOP + 3}`);
  if (!res.holders?.length) return null;
  const rows = res.holders.map((h) => ({
    address: h.address,
    share: h.share / 100,
    kind: BURN.has(h.address.toLowerCase()) ? ("burn" as const) : null,
    label: BURN.has(h.address.toLowerCase()) ? "Burn address" : null,
  }));
  return summarize("Ethereum", "Ethplorer", null, rows);
}

/**
 * Top-holder concentration for a token on its home chain (Ethereum or
 * Optimism). A bridged copy elsewhere would mislead: an exchange or bridge can
 * hold most of it. Null for native coins and tokens based on other chains.
 */
export function holderConcentration(coinId: string, contracts: Record<string, string>, homePlatform: string | null): Promise<HolderConcentration | null> {
  const chain = CHAINS.find(([platform]) => platform === homePlatform && contracts[platform]);
  if (!chain) return Promise.resolve(null);
  const [platform, name, host] = chain;
  const address = contracts[platform];
  // Holder lists change slowly; a day-old reading is fine and keeps calls low.
  return cachedPersistent(`holders:v1:${coinId}:${platform}`, 24 * 60 * MINUTE, async () => {
    const backup = () => (platform === "ethereum" ? fromEthplorer(address).catch(() => null) : Promise.resolve(null));
    try {
      return (await fromBlockscout(name, host, address)) ?? (await backup());
    } catch {
      return backup();
    }
  });
}
