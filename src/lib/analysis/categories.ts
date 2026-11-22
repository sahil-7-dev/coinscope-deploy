// CoinGecko tags mix real sectors ("Lending/Borrowing Protocols") with broad
// labels ("Ethereum Ecosystem", "Coinbase 50 Index"). Specific sectors explain
// moves better, so they're ranked first.

const GENERIC = /ecosystem|portfolio|index|holdings|native|governance|proof of|smart contract platform|layer 1|alleged|made in|launchpool|launchpad|binance|coinlist|megadrop|spotlight/i;

export const isGenericCategory = (c: string) => GENERIC.test(c);

/** Specific sectors first, original order otherwise preserved. */
export function rankCategories(categories: string[]): string[] {
  return [...categories.filter((c) => !isGenericCategory(c)), ...categories.filter(isGenericCategory)];
}
