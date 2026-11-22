// Shared types used by the API routes (server) and the dashboard (client).

export type Strength = "strong" | "moderate" | "weak";
export type Severity = "high" | "medium" | "low";
export type Tone = "good" | "neutral" | "warn" | "bad";

export interface PickedCoin {
  id: string;
  name: string;
  symbol: string;
  thumb?: string;
}

export interface SearchResult extends PickedCoin {
  rank: number | null;
}

export interface PricePoint {
  date: string; // YYYY-MM-DD (UTC)
  price: number;
  volume: number;
  marketCap: number | null;
}

/** Chart-derived features measured at one point in time. All percentages are fractions (0.25 = 25%). */
export interface Snapshot {
  date: string;
  price: number;
  marketCap: number | null;
  /** 7-day average volume ÷ average volume of the 30 days before that. */
  volTrend: number | null;
  /** 7-day average volume ÷ market cap. */
  turnover: number | null;
  vsSma20: number | null;
  vsSma50: number | null;
  /** Price vs the highest close in the series up to this point (≤ 0). */
  fromHigh: number | null;
  /** 14-day return minus the benchmark's 14-day return. */
  relStrength14d: number | null;
  return30d: number | null;
  rsi14: number | null;
  /** MACD histogram as a fraction of price (comparable across coins). */
  macdHist: number | null;
  vsSma200: number | null;
}

export interface Technicals {
  rsi14: number | null;
  macdHist: number | null;
  /** Histogram higher than 3 days ago. */
  macdRising: boolean | null;
  /** 50-day average ÷ 200-day average − 1 (> 0 = golden-cross structure). */
  sma50vs200: number | null;
  vsSma200: number | null;
  return7d: number | null;
  return90d: number | null;
  return1y: number | null;
  relStrength30d: number | null;
  relStrength90d: number | null;
  relStrength1y: number | null;
  /** Worst peak-to-trough fall over the last year (≤ 0). */
  maxDrawdown1y: number | null;
  volatility90d: number | null;
  fromHigh52w: number | null;
  fromLow52w: number | null;
}

export interface Tokenomics {
  circulatingRatio: number | null;
  fdvToMcap: number | null;
  /** Annualized growth of circulating supply over the last ~90 days (from market cap ÷ price). */
  inflationAnnual: number | null;
}

export interface Liquidity {
  exchanges: number;
  markets: number;
  tier1: string[];
  /** Sum of ±2% order-book depth across trusted markets, USD. */
  depthUsd: number | null;
  topVenue: string | null;
  topVenueShare: number | null;
  trustedShare: number | null;
}

export interface Derivatives {
  venue: "Binance" | "Bybit";
  symbol: string;
  /** Latest funding rate per 8h (0.0001 = 0.01%). */
  fundingRate: number | null;
  openInterestUsd: number | null;
  oiChange7d: number | null;
  oiChange30d: number | null;
}

export interface ScoreFactor {
  name: string;
  display: string;
  /** 0–100, or null when there's no data. */
  score: number | null;
  weight: number;
  note: string;
}

export interface HorizonScore {
  score: number | null;
  coverage: number;
  label: string;
  tone: Tone;
  factors: ScoreFactor[];
}

export interface InvestmentScores {
  short: HorizonScore;
  mid: HorizonScore;
  long: HorizonScore;
  /** Higher = riskier. */
  risk: HorizonScore;
}

export interface Rally {
  lowDate: string;
  lowPrice: number;
  peakDate: string;
  peakPrice: number;
  gain: number;
  days: number;
  /** First close above the 20-day average after the low: the point a buyer could have spotted the move. */
  breakoutDate: string;
  breakoutPrice: number;
  /** Average volume from breakout to peak ÷ average volume in the 30 days before the low. */
  volumeRatio: number | null;
  /** Benchmark return over the same low → peak window. */
  benchmarkGain: number | null;
  /** Current price vs the peak (≤ 0). */
  fromPeakNow: number;
}

export interface Fundamentals {
  source: "DefiLlama";
  /** DefiLlama slug for its fee history. */
  slug: string;
  kind: "protocol" | "chain";
  name: string;
  /** Null for fee-only chains and apps (no locked value tracked). */
  tvl: number | null;
  tvlChange7d: number | null;
  mcapToTvl: number | null;
  fees30d: number | null;
  feesPrev30d: number | null;
  fees90d: number | null;
  feesPrev90d: number | null;
  revenue30d: number | null;
  revenue90d: number | null;
  revenuePrev90d: number | null;
  /** Fees over the last 30 days × 12.2. */
  feesAnnualized: number | null;
  revenueAnnualized: number | null;
  /** Market cap ÷ annualized fees. */
  priceToFees: number | null;
  /** Market cap ÷ annualized revenue. */
  priceToSales: number | null;
  feesGrowth30d: number | null;
  feesGrowth90d: number | null;
  revenueGrowth90d: number | null;
  /** Fees paid out to token holders over 30 days (buybacks, burns, staking payouts). */
  holdersRevenue30d: number | null;
  /** Holders revenue / fees: how much of the activity the token itself captures. */
  holderShare: number | null;
  /** Protocol revenue / fees: how much the protocol keeps (the rest goes to LPs, validators and so on). */
  revenueShare: number | null;
  /** DefiLlama category ("Lending", "Dexs", "Chain"...). */
  category: string | null;
  /** Share of its category's fees over the last 30 days, its rank, and how many peers earn fees. */
  categoryShare: number | null;
  categoryRank: number | null;
  categoryPeers: number | null;
  audits: number | null;
  hacks: { count: number; lostUsd: number; last: string | null } | null;
  /** When DefiLlama started tracking it (YYYY-MM-DD). */
  listedAt: string | null;
  /** Chains only: stablecoins held on the chain and their change (capital arriving or leaving). */
  stablecoins: { current: number; change7d: number | null; change30d: number | null } | null;
  /** Chains only: new protocols launched on the chain in the last 90 days vs the 90 before. */
  launches: { last90: number; prev90: number } | null;
  /** Biggest fee earners in the same DefiLlama category (including itself), for a competitor view. */
  peers: Peer[];
}

export interface Peer {
  name: string;
  fees30d: number;
  feesGrowth30d: number | null;
  share: number;
  marketCap: number | null;
  priceToFees: number | null;
  isSelf: boolean;
}

/** Developer activity on the project's main GitHub repo. */
export interface DevActivity {
  repo: string;
  commits12w: number;
  commitsPrev12w: number;
  /** Weeks with at least one commit, of the last 12. */
  activeWeeks12: number;
  contributors: number | null;
}

/** Snapshot governance activity across the project's spaces. */
export interface Governance {
  space: string;
  proposals90d: number;
  proposalsPrev90d: number;
  avgVotes: number | null;
  lastProposal: string | null;
}

export type DriverKind =
  | "volume"
  | "momentum"
  | "market"
  | "narrative"
  | "fundamental"
  | "supply"
  | "size"
  | "catalyst";

export interface Driver {
  kind: DriverKind;
  title: string;
  detail: string;
  strength: Strength;
}

export interface RedFlag {
  title: string;
  detail: string;
  severity: Severity;
}

/** What the project is, in its own words, plus where to read more. */
export interface AssetAbout {
  description: string | null;
  homepage: string | null;
  whitepaper: string | null;
  twitter: string | null;
  github: string | null;
}

export interface AssetChange {
  d1: number | null;
  d7: number | null;
  d30: number | null;
  d60: number | null;
  d200: number | null;
  y1: number | null;
}

export interface CoinProfile {
  id: string;
  symbol: string;
  name: string;
  image: string | null;
  rank: number | null;
  categories: string[];
  /** Categories that are trending on the data source right now. */
  trendingCategories: string[];
  price: number;
  /** Price is live from Binance (otherwise it's CoinGecko's, up to a few hours old). */
  priceLive: boolean;
  marketCap: number | null;
  fdv: number | null;
  volume24h: number | null;
  change: AssetChange;
  athChange: number | null;
  supply: {
    circulating: number | null;
    total: number | null;
    max: number | null;
    /** Circulating ÷ max (or total) supply. */
    circulatingRatio: number | null;
  };
  dev: { commits4w: number | null; stars: number | null; hasRepo: boolean } | null;
  devActivity: DevActivity | null;
  governance: Governance | null;
  about: AssetAbout | null;
  /** Share of bullish community votes (0–1). */
  sentimentUp: number | null;
  fundamentals: Fundamentals | null;
  technicals: Technicals;
  tokenomics: Tokenomics;
  liquidity: Liquidity | null;
  derivatives: Derivatives | null;
  /** In CoinGecko's trending searches right now. */
  trendingCoin: boolean;
  genesisDate: string | null;
  /** Days since genesis, or since the first price on record if newer than our history window. */
  ageDays: number | null;
  /** The coin's strongest tracked narrative (sector), once the Narratives page has loaded at least once. */
  narrative: CoinNarrative | null;
  /** Narrative data was available when this profile was built. */
  narrativeLoaded: boolean;
  scores: InvestmentScores;
  /** Label of the benchmark asset, e.g. "BTC". */
  benchmark: string;
  volatility30d: number | null;
  historyDays: number;
  series: PricePoint[];
  now: Snapshot;
  rally: Rally | null;
  /** Snapshot at the rally breakout, or `now` when there was no rally. */
  setup: Snapshot;
  drivers: Driver[];
  redFlags: RedFlag[];
  /** Scheduled unlocks in the next 90 days (AlphaGrowth); undefined on profiles saved before this existed. */
  unlocks?: UnlockInfo | null;
  /** Who holds the token on Ethereum or Optimism (Blockscout, Ethplorer as backup); null for native coins. */
  holders?: HolderConcentration | null;
  fetchedAt: string;
}

/** Upcoming unlocks from published emission schedules (AlphaGrowth). */
export interface UnlockInfo {
  /** Cliff unlocks in the next 30 and 90 days as a share of circulating supply. */
  next30: number;
  next90: number;
  value90Usd: number | null;
  /** Share of the next 90 days' unlocked tokens going to team, advisors and investors. */
  insiderShare: number | null;
  events: { date: string; share: number | null; valueUsd: number | null; tokens: number; who: string[] }[];
  /** Linear vesting also changes pace in the window (not counted in the shares above). */
  linear: boolean;
  asOf: string;
}

export type HolderKind = "wallet" | "contract" | "exchange" | "burn";

/** How concentrated a token's holders are on one chain. */
export interface HolderConcentration {
  chain: string;
  source: "Blockscout" | "Ethplorer";
  holders: number | null;
  /** Top-10 holders' share of the supply on that chain, burned tokens excluded. */
  top10: number;
  /** Top-10 share counting only plain wallets (not contracts, exchanges or burn addresses); null when labels aren't available. */
  top10Wallets: number | null;
  top: { address: string; share: number; kind: HolderKind | null; label: string | null }[];
  asOf: string;
}

/** Backers and community for the coin page (AlphaGrowth), loaded separately since nothing is scored from them. */
export interface CoinExtras {
  project: { slug: string; name: string; page: string } | null;
  funding: {
    totalRaised: number | null;
    rounds: { date: string | null; type: string; amount: number | null; valuation: number | null; url: string | null }[];
    investors: string[];
  } | null;
  community: { network: string; followers: number; change7d: number | null; change30d: number | null }[];
}

export interface ProfilesResponse {
  profiles: CoinProfile[];
  errors: { id: string; message: string }[];
}

// ---- Market pulse ----

export interface MarketCoin {
  id: string;
  symbol: string;
  name: string;
  image: string;
  rank: number | null;
  price: number;
  marketCap: number;
  volume: number;
  turnover: number | null;
  change: { h1: number | null; h24: number | null; d7: number | null; d30: number | null; y1: number | null };
  /** ~7 days of prices, downsampled for the table sparkline. */
  sparkline: number[];
}

export interface GlobalStats {
  totalMarketCap: number;
  totalVolume: number;
  change24h: number | null;
  btcDominance: number | null;
  ethDominance: number | null;
  activeCoins: number | null;
  fearGreed: { value: number; label: string } | null;
  /** CoinGecko calls this app made this calendar month (UTC), against the plan's monthly budget. */
  apiUsage: { month: string; calls: number; limit: number };
}

export interface MarketPulse {
  global: {
    totalMarketCap: number;
    totalVolume: number;
    change24h: number | null;
    btcDominance: number | null;
    ethDominance: number | null;
    activeCoins: number | null;
  };
  fearGreed: { value: number; label: string; history: { date: string; value: number }[] } | null;
  btc: { price: number; d7: number | null; d30: number | null } | null;
  breadth: { up7d: number; up30d: number; sample: number };
  /** Median 30d return of the top alts minus BTC's 30d return. */
  altVsBtc30d: number | null;
  regime: { label: "Risk-on" | "Neutral" | "Risk-off"; tone: Tone; points: string[] };
  coins: MarketCoin[];
  trending: { id: string; name: string; symbol: string; thumb: string; rank: number | null; change24h: number | null }[];
  hotCategories: { id: string; name: string; marketCap: number; change24h: number; top3: string[] }[];
  updatedAt: string;
}

// ---- Sectors, news, library, watchlist, backtest ----

/** Market phase: how a narrative's coins are moving against BTC. */
export type NarrativePhase = "Emerging" | "Running" | "Overheated" | "Cooling" | "Out of favor";

/** Fundamentals-only stage: how a narrative's fees (and builders) move against the market's. No price. */
export type NarrativeStage = "Emerging" | "Accelerating" | "Maturing" | "Quiet" | "Fading";

/** How much the market has noticed a narrative, from price vs BTC. Context only, never scored. */
export type NarrativeAttention = "Unnoticed" | "Noticed" | "Crowded";

/** A sector's index vs BTC at one point in time. Returns are fractions; rel = index return − BTC return. */
export interface NarrativeReading {
  rel7: number | null;
  rel30: number | null;
  rel90: number | null;
  /** Median member's 7-day volume ÷ its prior 30-day average. */
  volTrend: number | null;
  /** Share of members beating BTC over 7 / 30 days. */
  breadth7: number | null;
  breadth30: number | null;
}

export interface CoinNarrative {
  sector: string;
  stage: NarrativeStage;
  attention: NarrativeAttention;
  phase: NarrativePhase;
  /** 0–100: how good the narrative's fundamental backdrop is (from the stage only). */
  strength: number;
  rel30: number | null;
  rel7: number | null;
  /** First day of the current phase. */
  since: string | null;
}

export interface NarrativeStat {
  id: string;
  name: string;
  marketCap: number;
  change24h: number | null;
  reading: NarrativeReading;
  stage: NarrativeStage | null;
  attention: NarrativeAttention | null;
  /** New protocols launched in its coins' DefiLlama categories and chains (90d vs the 90 before). */
  builders: { last90: number; prev90: number } | null;
  /** Fee growth across its coins: the fundamental signal behind the stage. */
  fundamentals: { feeGrowth30d: number | null; feeGrowth90d: number | null; withFees: number; growing: number };
  /** Recent news headlines mentioning the narrative or its coins. */
  mentions: number | null;
  /** Daily mention counts saved by this app: last 7 days vs the 7 before (null until 14 days are saved). */
  mentionTrend: { last7: number; prev7: number } | null;
  phase: NarrativePhase | null;
  strength: number | null;
  /** First day of the current market phase. */
  since: string | null;
  /** First day of the current stage, and the stage before it (from the reconstructed daily history). */
  stageSince: string | null;
  previousStage: NarrativeStage | null;
  /** Daily stage over the last year, rebuilt from data known on each day. */
  stageHistory: { date: string; stage: NarrativeStage | null }[];
  /** Plain-language reasons: fundamentals first, then the market phase. */
  signals: string[];
  /** In CoinGecko's trending categories right now. */
  trending: boolean;
  /** Weekly samples over the last year: index ÷ BTC, rebased to 1 at the start. */
  history: { date: string; ratio: number; phase: NarrativePhase | null }[];
  /** Coins the index is built from. */
  members: { id: string; symbol: string; name: string; image: string; change30d: number | null }[];
}

export interface NarrativeChange {
  id: string;
  sector: string;
  from: NarrativeStage | null;
  to: NarrativeStage;
  date: string;
}

export interface LaunchStat {
  name: string;
  last90: number;
  prev90: number;
}

/** One of a narrative's coins, ranked by a quick fundamentals score from DefiLlama data (no extra CoinGecko calls). */
export interface NarrativeCoin {
  id: string;
  symbol: string;
  name: string;
  image: string;
  marketCap: number | null;
  change30d: number | null;
  /** One of the coins the narrative's price index is built from. */
  inIndex: boolean;
  hasFees: boolean;
  fees30d: number | null;
  feesGrowth30d: number | null;
  feesGrowth90d: number | null;
  holderShare: number | null;
  priceToFees: number | null;
  /** Quick score from usage, value capture, valuation and the narrative stage only; the full scorecard is on the coin page. */
  quickScore: number | null;
}

export interface NarrativeDetail {
  stat: NarrativeStat;
  coins: NarrativeCoin[];
  /** The DefiLlama categories and chains its builder counts come from. */
  builderSources: { name: string; kind: "category" | "chain"; last90: number; prev90: number }[];
  /** Recent headlines mentioning the narrative or its coins. */
  headlines: NewsItem[];
  marketFees: { g30: number | null; g90: number | null };
  /** Its stage changes over its whole history and what followed each (null until the stage check has run). */
  track: StageValidation["tracks"][number] | null;
  /** How each stage did across all narratives, for comparison. */
  stageResults: StageCallStats[] | null;
}

/** One day a narrative's confirmed stage changed, and what its coins did next. */
export interface StageCall {
  date: string;
  from: NarrativeStage | null;
  to: NarrativeStage;
  /** How long the stage lasted (so far, when ongoing). */
  days: number;
  ongoing: boolean;
  /** Index return relative to BTC's over the next 30 / 90 / 180 days (null when not enough time has passed). */
  vsBtc30: number | null;
  vsBtc90: number | null;
  vsBtc180: number | null;
  /** 90-day result minus the median tracked narrative's over the same days. */
  vsOthers90: number | null;
}

/** How calls of one stage did. Results are medians, so one huge run can't carry them. */
export interface StageCallStats {
  stage: NarrativeStage;
  calls: number;
  /** Calls with 90 days of results so far. */
  measured: number;
  vsBtc30: number | null;
  vsBtc90: number | null;
  vsBtc180: number | null;
  beatBtc90: number | null;
  vsOthers90: number | null;
  vsOthers90Mean: number | null;
  beatOthers90: number | null;
  /** Every day spent in the stage (not just its first), vs the other narratives over the next 90 days. */
  everyDayVsOthers90: number | null;
  medianDays: number | null;
  /** Share of new stages that changed again within 30 days. */
  reversed: number | null;
}

export interface StageValidation {
  from: string | null;
  to: string | null;
  narratives: number;
  /** Total years of stage history across narratives. */
  narrativeYears: number;
  confirmDays: number;
  stages: StageCallStats[];
  periods: { label: string; stages: { stage: NarrativeStage; calls: number; vsOthers90: number | null; beatOthers90: number | null }[] }[];
  /** The same check with other confirmation lengths. */
  variants: {
    days: number;
    calls: number;
    changesPerYear: number;
    medianDays: number | null;
    reversed: number | null;
    earlyCalls: number;
    earlyVsOthers90: number | null;
    earlyBeatOthers90: number | null;
    earlyBefore: number | null;
    earlyFrom: number | null;
  }[];
  tracks: { id: string; name: string; years: number; changesPerYear: number; calls: StageCall[] }[];
  notes: string[];
  updatedAt: string;
}

export interface NarrativesResponse {
  sectors: NarrativeStat[];
  /** Stage changes over the last 30 days, newest first. */
  changes: NarrativeChange[];
  /** Where builders and capital are arriving (DefiLlama). */
  builders: {
    categories: LaunchStat[];
    chains: (LaunchStat & { stablecoins: number | null; stablecoinChange30d: number | null })[];
  };
  btc: { d7: number | null; d30: number | null };
  /** Median fee growth across every tracked coin: what a narrative's fees are measured against. */
  marketFees: { g30: number | null; g90: number | null };
  updatedAt: string;
}

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
}

export interface NewsResponse {
  items: NewsItem[];
  source: "CryptoPanic" | "RSS";
  note?: string;
}

/** How well a research answer is backed: checked against a source, a reasoned guess, or not known. */
export type EvidenceStatus = "verified" | "inferred" | "unknown";

export interface EvidenceTag {
  status: EvidenceStatus | null;
  /** Source links (http/https). */
  sources: string[];
}

/** Data a thesis assumption can be checked against automatically. */
export type CheckMetric =
  | "fundamentalScore"
  | "feesGrowth90d"
  | "feesGrowth30d"
  | "holderShare"
  | "priceToFees"
  | "inflation"
  | "devCommits12w"
  | "riskScore"
  | "narrativeStage";

export interface AssumptionCheck {
  metric: CheckMetric;
  /** "in" is for the narrative stage (one of `stages`). */
  op: ">=" | "<=" | "in";
  /** Threshold in the metric's own unit (fractions for percentages). */
  value: number | null;
  stages?: NarrativeStage[];
}

export interface Assumption {
  id: string;
  text: string;
  /** Optional rule that tells whether the assumption still holds. */
  check: AssumptionCheck | null;
}

export interface Thesis {
  stance: "bullish" | "neutral" | "bearish" | null;
  /** The thesis in one or two sentences. */
  summary: string;
  assumptions: Assumption[];
  /** Next time to re-check the research (YYYY-MM-DD). */
  reviewOn: string | null;
}

/** One entry in a coin's thesis history. */
export interface ThesisEvent {
  at: string;
  kind: "stance" | "summary" | "assumption-added" | "assumption-removed" | "assumption-broken" | "assumption-holds" | "review" | "notes";
  detail: string;
  /** For check results: which assumption. */
  ref?: string | null;
}

/** The user's own research on a coin: the parts that need judgment rather than data. */
export interface CoinResearch {
  /** 1–10, or null when not rated yet. */
  ratings: {
    useCase: number | null;
    moat: number | null;
    team: number | null;
    ambition: number | null;
    feasibility: number | null;
  };
  notes: {
    /** What problem it solves and why it needs a blockchain and its own token. */
    problem: string;
    /** What makes it hard to copy. */
    unique: string;
    /** Why demand for the product should reach the token (buybacks, fees, staking, collateral...). */
    tokenValue: string;
    /** How it compares with its competitors. */
    competitors: string;
    bull: string;
    base: string;
    bear: string;
    catalysts: string;
    invalidation: string;
  };
  thesis: Thesis;
  /** Evidence behind each note: how well it's backed, and its sources. */
  evidence: Partial<Record<keyof CoinResearch["notes"], EvidenceTag>>;
  updatedAt: string | null;
}

export interface LibraryEntry {
  id: string;
  name: string;
  symbol: string;
  image: string | null;
  note: string;
  savedAt: string;
  /** Saved profile; `series` is stripped in list responses. */
  profile: CoinProfile;
}

export interface ScorePoint {
  takenAt: string;
  price: number;
  short: number | null;
  mid: number | null;
  long: number | null;
  risk: number | null;
  /** Data-only verdict at the time (your research ratings aren't included): strong / watch / speculative / avoid. */
  verdict: string | null;
}

export interface WatchItem {
  id: string;
  name: string;
  symbol: string;
  image: string | null;
  addedAt: string;
  history: ScorePoint[];
}

export interface BacktestSignal {
  coinId: string;
  coinName: string;
  date: string;
  score: number;
  forwardReturn: number;
  benchmarkReturn: number | null;
}

export interface BacktestStats {
  count: number;
  avgReturn: number | null;
  medianReturn: number | null;
  winRate: number | null;
  beatBenchmarkRate: number | null;
}

export interface BacktestResponse {
  horizonDays: number;
  threshold: number;
  coinsTested: string[];
  criteriaUsed: string[];
  criteriaSkipped: string[];
  signals: BacktestSignal[];
  stats: BacktestStats;
  /** Every (coin, date) checked, for comparison: what you'd get buying at random. */
  baseline: BacktestStats;
  errors: { id: string; message: string }[];
}

// ---- Strategy backtest (mid-term score over years of history) ----

export interface StrategyStats {
  count: number;
  /** Net of trading costs. */
  avgReturn: number | null;
  medianReturn: number | null;
  winRate: number | null;
  beatBtcRate: number | null;
}

export interface StrategyOptions {
  horizonDays: number;
  threshold: number;
  /** Round-trip trading cost as a fraction (0.005 = 0.5%). */
  cost: number;
  /** Trading coins by current volume (delisted coins are always added). 0 = all. */
  maxCoins: number;
}

export interface StrategyBacktestResult {
  options: StrategyOptions;
  period: { from: string; to: string };
  coins: { tested: number; delisted: number; withFees: number; withNarrative: number };
  /** Mid-term factors replayed historically vs. ones that need data that only exists today. */
  factorsUsed: string[];
  factorsSkipped: string[];
  /** Share of the mid-term score's weight that could be replayed. */
  backtestedWeight: number;
  baseline: StrategyStats;
  signals: StrategyStats;
  /** Signals' average minus the baseline's, with a 90% confidence range (month-clustered bootstrap). */
  edge: { avg: number | null; low: number | null; high: number | null };
  buckets: { label: string; stats: StrategyStats }[];
  regimes: { regime: "Bull" | "Bear"; signals: StrategyStats; baseline: StrategyStats }[];
  years: { year: string; signals: StrategyStats; baseline: StrategyStats }[];
  /** Coin-days by the fundamentals-only stage of the coin's strongest narrative. */
  phases: { phase: string; stats: StrategyStats }[];
  /** Coin-days by that narrative's market attention (context, not scored). */
  attention?: { label: string; stats: StrategyStats }[];
  fa: { label: string; stats: StrategyStats }[];
  /** Average daily rank correlation between each factor and the forward return (information coefficient). */
  factors: { key: string; label: string; ic: number | null; positiveShare: number | null; dates: number }[];
  delisted: { coins: number; observations: number; avgReturn: number | null };
  recentSignals: { symbol: string; date: string; score: number; ret: number; btc: number | null; delistedExit: boolean }[];
  /** Robustness checks: does the result hold across periods, weights and stage orderings? */
  validation?: StrategyValidation;
  notes: string[];
  ranAt: string;
  durationMs: number;
}

export interface ValidationRun {
  label: string;
  /** Average daily rank correlation between the score and what happened next. */
  ic: number | null;
  positiveShare: number | null;
  signals: StrategyStats;
  baseline: StrategyStats;
  edge: number | null;
}

export interface StrategyValidation {
  /** The scoring rules were last changed on this date; only data after it is truly out of sample. */
  frozenAt: string;
  /** The same rules on separate periods (the earlier one includes the data the rules were tuned on). */
  periods: (ValidationRun & { from: string; to: string })[];
  /** Results with each replayable category's weight set to zero. */
  leaveOneOut: ValidationRun[];
  /** Results over random weight sets (each weight scaled by 0.5–1.5×). */
  randomWeights: { runs: number; icMin: number | null; icMedian: number | null; icMax: number | null; edgeMin: number | null; edgeMedian: number | null; edgeMax: number | null; positiveEdgeShare: number | null };
  /** Narrative stage orderings compared, including the one before it was tuned on this data. */
  stageVariants: ValidationRun[];
}

// ---- Checklist ----

export type MetricKey =
  | "marketCap"
  | "volTrend"
  | "turnover"
  | "vsSma50"
  | "relStrength"
  | "fromHighDeep"
  | "fromHighNear"
  | "circulatingRatio"
  | "lowFloat"
  | "devCommits"
  | "tvlGrowth"
  | "mcapToTvl"
  | "fees30d"
  | "sentiment"
  | "rsi"
  | "priceToFees"
  | "feesGrowth"
  | "tier1"
  | "inflation";

export interface MetricItem {
  id: string;
  kind: "metric";
  metric: MetricKey;
  op: ">=" | "<=";
  threshold: number;
  weight: number;
  enabled: boolean;
  /** Ids of winners that met the threshold. */
  matched: string[];
  /** How many winners had data for this metric. */
  known: number;
  winnerMedian: number | null;
}

export interface CategoryItem {
  id: string;
  kind: "category";
  category: string;
  weight: number;
  enabled: boolean;
  matched: string[];
  known: number;
}

export type ChecklistItem = MetricItem | CategoryItem;

export interface Checklist {
  createdAt: string;
  winners: PickedCoin[];
  items: ChecklistItem[];
  notes: string[];
}

// ---- Decision journal ----

export type DecisionAction = "buy" | "pass";

/** A buy or a pass, with what the app said at the time. */
export interface Decision {
  id: number;
  coinId: string;
  symbol: string;
  name: string;
  image: string | null;
  action: DecisionAction;
  decidedOn: string;
  price: number;
  btcPrice: number;
  verdict: "strong" | "watch" | "speculative" | "avoid" | null;
  verdictLabel: string | null;
  score: number | null;
  confidence: number | null;
  sector: string | null;
  stage: NarrativeStage | null;
  attention: NarrativeAttention | null;
  /** Your thesis summary at the time, if you had one. */
  thesis: string;
  note: string;
  closedOn: string | null;
  closePrice: number | null;
  closeBtcPrice: number | null;
  createdAt: string;
  /** Logged more than a day after the decision: its verdict is from the logging day, not the decision day. */
  loggedLate?: boolean;
}

export interface DecisionResult extends Decision {
  /** Latest price, or the price it was sold at. */
  endPrice: number | null;
  endBtcPrice: number | null;
  days: number;
  return: number | null;
  btcReturn: number | null;
  /** (1 + return) ÷ (1 + BTC's return) − 1. */
  vsBtc: number | null;
  /** Old enough to count in the summary. */
  counted: boolean;
}

export interface JournalGroup {
  label: string;
  decisions: number;
  /** Median result vs BTC. */
  vsBtc: number | null;
  beatBtc: number | null;
}

export interface JournalResponse {
  decisions: DecisionResult[];
  minDays: number;
  summary: {
    buys: JournalGroup;
    passes: JournalGroup;
    /** Buys against the app (Speculative or Avoid) and passes on a Strong candidate. */
    against: JournalGroup;
    byVerdict: JournalGroup[];
    byStage: JournalGroup[];
    /** Decisions younger than minDays, not counted yet. */
    tooEarly: number;
  };
  updatedAt: string;
}
