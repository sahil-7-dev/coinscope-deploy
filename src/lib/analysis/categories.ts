// CoinGecko tags mix real sectors ("Lending/Borrowing Protocols") with broad
// labels ("Ethereum Ecosystem", "Coinbase 50 Index"). Specific sectors explain
// moves better, so they're ranked first.

const GENERIC = /ecosystem|portfolio|index|holdings|native|governance|proof of|smart contract platform|layer 1|alleged|made in|launchpool|launchpad|binance|coinlist|megadrop|spotlight/i;

export const isGenericCategory = (c: string) => GENERIC.test(c);

/** Business models DefiLlama's fees don't measure: for these, no fee data means "unmeasured", not "no usage". */
const NOT_FEE_BASED = /privacy|payment|proof of work|storage|depin|internet of things|wireless/i;

/** Whether fees are the right yardstick for a coin in these categories (or narrative sectors). */
export const feesExpected = (categories: string[]) => !categories.some((c) => NOT_FEE_BASED.test(c));

/** Specific sectors first, original order otherwise preserved. */
export function rankCategories(categories: string[]): string[] {
  return [...categories.filter((c) => !isGenericCategory(c)), ...categories.filter(isGenericCategory)];
}
