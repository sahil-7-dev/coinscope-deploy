# CoinScope

**Fundamentals-first crypto research and narrative discovery.** Find narratives whose fundamentals improve before the crowd notices, compare coins against ones that already performed well, and get a plain verdict for each coin you're researching. No technical analysis, no AI, free data only.

![Next.js](https://img.shields.io/badge/Next.js-16-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6) ![Tailwind](https://img.shields.io/badge/Tailwind-v4-38bdf8) ![SQLite](https://img.shields.io/badge/SQLite-libSQL%20%2F%20Turso-003b57) ![Data](https://img.shields.io/badge/data-free%20APIs%20only-16a34a)

> Research tool, not financial advice. Verdicts are screens that tell you what to research next.

---

## Contents

- [The workflow](#the-workflow)
- [Features](#features)
- [How it works](#how-it-works)
  - [Fundamental scorecard](#fundamental-scorecard)
  - [Verdicts](#verdicts)
  - [Narrative stages](#narrative-stages)
  - [Benchmark comparison](#benchmark-comparison)
  - [Backtest](#backtest)
- [Data sources](#data-sources)
- [API budget and caching](#api-budget-and-caching)
- [Getting started](#getting-started)
- [Project structure](#project-structure)
- [API routes](#api-routes)
- [Local data](#local-data)
- [Limitations](#limitations)
- [Roadmap](#roadmap)

---

## The workflow

1. **Narratives:** see which sectors' fundamentals (fees vs the market's, builders arriving) are improving, and how much the market has noticed (attention, shown separately).
2. **Winners:** study coins that already performed well (e.g. ZEC for privacy) on the Winners page: every run since 2021, their fundamentals **before** each run next to **at the peak** (hindsight), and what they did and didn't share. Pick the run (or any date) each winner is compared as of.
3. **Coin Check:** paste the coins you're eyeing. Each gets a verdict (Strong candidate / Watchlist / Speculative / Avoid), its narrative stage and attention, a fundamental score with evidence confidence, its fit to the winner pattern, and where it's stronger or weaker than each benchmark (with the size of each gap and the metrics that couldn't be compared).
4. **Coin report:** open a coin for the full research view: competitors, and your own answers to why it exists, why it's hard to copy, why the token captures value, ambition vs feasibility and bull/base/bear.
5. **Thesis:** write your thesis and its key assumptions, each optionally tied to a data check. CoinScope re-checks them every time the coin is analyzed, flags broken ones in verdicts and on the Watchlist, and keeps a history.
6. **Watchlist:** track scores, verdict changes, thesis health and review dates.

## Features

| Page | What it does |
|---|---|
| **Market** `/` | Global stats, market mood (Fear & Greed, breadth, BTC trend), trending coins, top gainers, a 250-coin table with sparklines, top categories |
| **Narratives** `/narratives` | Each sector's **stage**, from fundamentals only (Emerging, Accelerating, Quiet, Maturing, Fading), and its **attention** from price vs BTC (Unnoticed, Noticed, Crowded) as context; **recent stage changes**; "in this stage since"; a 90-day stage timeline; builders per narrative; **where builders are launching** (by category); **chains' capital and builders** (stablecoins, new protocols); news mentions and their trend |
| **Narrative page** `/narratives/[id]` | One narrative in depth: stage and attention, why it's in that stage, fee growth (30d and 90d) next to the market median, **its coins ranked by a quick fundamentals score** (DefiLlama fees, fee growth, share paid to holders, P/F; no extra CoinGecko calls), a year of stage history, its **stage track record** since 2021 (each change and how its coins did over the next 90 days), index vs BTC, which DefiLlama categories and chains its builder count comes from, and headlines; one click sends the top 10 to Coin Check |
| **Winners** `/winners` | Every run of +50% or more since 2021 per winner; pick a run or any date as the comparison point (saved, and used by Coin Check); fundamentals **before** the run (known at the time) vs **at the peak** (hindsight); side-by-side table of several winners with shared ranges and **what they did not share**; a link to find coins matching the pattern |
| **Coin Check** `/similarity` | Paste tickers or names → verdict, fundamental score, evidence confidence, narrative stage and attention, risk, **winner-pattern fit**, and % match to each benchmark **before its run** (or today) with stronger/weaker lists, gap sizes and missing metrics. Lists can be bookmarked: `/similarity?coins=SUI,ONDO&benchmarks=zcash` |
| **Coin** `/coin/[id]` | Research report: verdict and reasons; what it is (description, links, DefiLlama category and rank, audits, hacks, GitHub activity, governance, chain stablecoins); the 8-category scorecard; **competitors** (top fee earners in its category with growth, share and P/F); **supply**: upcoming unlocks (dates, % of circulating, who receives them) and top holders (labeled wallets, contracts, exchanges); **backers and community** (funding rounds, investors, follower growth; context only); **Your research**: your **thesis** (stance, summary, review date, key assumptions with live data checks), structured use-case questions with **evidence tags** (Verified / Inferred / Unknown plus source links), ratings, bull/base/bear, and the thesis **history**; all saved locally; other scores; 1-year chart; drivers and red flags; all metrics; news |
| **Backtest** `/backtest` | Replays the fundamental score every 3 days since 2021 on ~440 coins (including coins Binance later delisted), after trading costs. Shows score buckets, which factors predicted returns, bull vs bear, year by year, and narrative stages. **Narrative stage check:** every narrative's stage replayed daily since 2021, how often it changed and reversed, what followed each stage vs BTC and vs the typical narrative (both periods), and the same for other confirmation lengths |
| **Analyze & Score** `/analyze` | Winners → what drove each run → editable checklist → checklist backtest → score candidates |
| **Library** `/library` | Saved benchmark coins with full metrics and notes |
| **Watchlist** `/watchlist` | Tracked coins: verdict and its latest change, **thesis** (stance, broken assumptions, review due), score history |
| **Journal** `/journal` | **Decision journal:** log each buy or pass ("Log decision" on any coin). It records what the app said at that moment (verdict, score, narrative stage, your thesis) and the coin's and BTC's prices. After 30 days each decision is judged against BTC: your buys, your passes (lower is better), decisions against the app, and **whether the app's verdicts were right**. Mark buys as sold; backdated entries are kept but left out of the verdict check |

The header shows global stats and an **API call meter** (CoinGecko calls used this month).

## How it works

All analysis is rules on real data: every number in the UI traces back to a formula you can read. The core engines in `src/lib/analysis/` are pure TypeScript, so the backtest replays exactly what the app shows.

### Fundamental scorecard

`src/lib/analysis/fundamentals.ts`: eight categories, each scored 0–100, weighted:

| Category | Weight | Measured with |
|---|---|---|
| Use case & problem | 15 | **Your rating** |
| Narrative strength & timing | 15 | Narrative stage (early beats crowded) |
| Adoption & growth | 15 | Fee growth (90d, 30d), fee level, TVL change; for chains also stablecoin inflows and new protocols launched |
| Token value capture | 15 | Share of fees paid to token holders, share kept as revenue, holder revenue |
| Tokenomics & supply pressure | 10 | Circulating share, supply inflation, FDV ÷ market cap, **unlocks in the next 90 days** (share of circulating supply, from AlphaGrowth) |
| Technology & competitive moat | 10 | Share of its DefiLlama category's fees (and rank), plus **your rating** |
| Team, execution & ecosystem | 10 | GitHub commits (12 weeks) and trend, contributors, Snapshot governance activity, age, audits, hacks, tier-1 listings, plus **your rating** |
| Valuation vs fundamentals | 10 | Usage vs price (did fees grow faster than price?), price-to-fees, price-to-sales, market cap ÷ TVL |

- Coins with **no fee data** get low fallback scores for adoption, value capture and valuation: they count against the coin, but not as evidence.
- **Evidence confidence** is the share of the weight backed by real data or your ratings. A good score is pulled toward 45 by the missing share (`score = min(raw, raw × confidence + 45 × (1 − confidence))`), so gaps can lower a score but never raise one.
- Price is used only as valuation context (P/F, usage vs price), never as a signal. Market attention never enters the score.

### Verdicts

`src/lib/analysis/verdict.ts` (every threshold is in `VERDICT_RULES`):

| Verdict | When |
|---|---|
| **Strong candidate** | Fundamental score ≥ 65, evidence ≥ 50%, narrative Accelerating or Quiet, its narrative not **Crowded** (market context, labeled as such), valuation not stretched, and risk < 70. Benchmark fit is shown as context, not required: a coin unlike your benchmark can still be strong, and the summary says so |
| **Watchlist** | Decent but something's missing; the page lists exactly what would make it strong |
| **Speculative** | The story is ahead of the evidence: a good narrative but weak or unmeasurable usage |
| **Avoid** | High-severity red flag, extreme risk, weak fundamentals with no accelerating narrative, or no measurable usage at all |

Emerging narratives (builders arriving, fees not yet beating the market) no longer count toward a Strong verdict or keep a weak coin out of Avoid: coins in them did worse than average in the backtest (−4.6%, below Fading). An Emerging story can still make a weak-evidence coin Speculative.

Coins in categories fees don't measure (privacy, payments, proof of work, storage, DePIN, IoT, wireless) and with no fee data get "unmeasured" instead of a penalty in adoption, value capture and valuation. It's still not evidence, so their confidence stays low, and they skip the "no measurable usage" Avoid rule.

Scores of 70+ carry a caution: in the backtest they were often reached at peak activity (fee spikes) and did worse than 50–69.

Your thesis feeds in too: a broken assumption is listed as a reason and rules out a Strong verdict (it's your own rule), and a review date that has arrived is flagged.

### Thesis tracking

`src/lib/analysis/thesis.ts` and `src/lib/server/thesis-log.ts`:

- Each assumption can carry a data check on the fundamental score, fee growth (30/90d), holders' share of fees, P/F, inflation, GitHub commits, risk, or the narrative stage ("is Emerging or Accelerating"). One-click starters cover the common ones.
- Checks re-run **every time a coin is analyzed** (coin page, Coin Check, Watchlist refresh). Only a change of result is logged, so the history shows when an assumption broke or recovered, alongside your own edits (stance, thesis, assumptions, review date, notes).
- Evidence tags are yours to set; links must be http(s). Nothing is inferred or fetched automatically: the app stays rules-only.

### Narrative stages

`src/lib/analysis/narrative-rules.ts` and `narratives.ts`:

The **stage** uses fundamentals only, never price:

- the median fee growth of a narrative's biggest coins, **relative to the whole market's** (a crash or bull run lifts fees everywhere);
- **builders**: new protocols launched in the DefiLlama categories and on the chains its coins operate in, **relative to DefiLlama's overall listing pace**.

| Stage | Meaning |
|---|---|
| Accelerating | Fees beating the market's on both 30 and 90 days |
| Emerging | Fees just started beating the market (30 days), or builders arriving faster than elsewhere before fees show it |
| Quiet | No fundamental signal either way |
| Maturing | A strong quarter, but the last month slowed |
| Fading | Fees shrinking against the market |

**Attention** is separate context, from each narrative's equal-weighted index of its 10 biggest coins vs BTC (and trending status): **Unnoticed**, **Noticed** or **Crowded**. It is never scored; a Crowded narrative only appears in verdicts as a labeled market-context warning.

A new stage must hold **20 days** before it shows. The stage check (Backtest page) found that 5 days flipped too often (about 7 changes a year per narrative, 60% reversed within a month); 20 days gives about 3 a year and 12% reversed. It also found that **no stage reliably picked the narratives whose coins did better over the next 90 days**, so stages describe how fundamentals are moving; they aren't a buy signal on their own. A year of stage history is rebuilt from data known on each day, which powers the timeline, the changes feed, and winners' pre-run stages. Headline mention counts are saved daily, so a 7-day trend appears after two weeks.

### Benchmark comparison

`src/lib/analysis/similarity.ts` and `winner-pattern.ts`:

- **Before its run:** for each benchmark, the app finds every run of +50% or more since 2021 (a run ends after a 30% fall from its peak) on CoinGecko's year of prices extended back with Binance history. By default it compares against the biggest run of the last year; on the Winners page you can pick any run or date. It rebuilds the fundamentals on the day before: fees, fee and revenue growth, holder and revenue share, P/F and P/S, supply, inflation, FDV, age and narrative stage. Before CoinGecko's year, market cap and P/F are estimated from today's circulating supply and supply metrics are left out (flagged). Candidates are compared with that setup, not with the winner after its move. "Winner today" is still available.
- **Hindsight kept apart:** the same fundamentals at the run's peak are shown next to "before", labeled as hindsight, so explanations after the fact aren't mistaken for signals.
- **Pairwise match:** fuzzy, fundamentals-only similarity (close values count) across six groups: Usage & growth 30, Value capture 20, Narrative 15, Valuation 15, Tokenomics 10, Size & maturity 10. Each metric says whether the candidate is **stronger or weaker**, with the gap in words ("21× smaller", "+35 pts"), and metrics that couldn't be compared are listed with which side lacks data.
- **Winner pattern:** with 2+ benchmarks, the ranges they shared before their runs become a pattern; each candidate gets a fit score and lists of metrics inside and outside it. Metrics where the winners differ too much (30×+ apart) are marked "too wide to tell" and left out, and the Winners page lists **what they did not share** (mixed fee earners, mixed narrative stages, wide metrics, data only one had).

### Backtest

`src/lib/analysis/strategy-backtest.ts`, run from the Backtest page as a background job with progress:

- **Universe:** the top 300 trading Binance coins by today's volume (adjustable) plus every **delisted** pair (which reduces survivorship bias), daily prices since 2021, with a liquidity filter on each day. Picking by today's volume still favors coins that are doing well now, and only coins Binance listed are included.
- **Point in time:** each day's score uses only data available before that day (fees lag a day). Categories that need data which only exists today (supply, audits, listings, your ratings) are left out and listed on the page.
- **Statistics:** returns after trading costs; one hold at a time per coin for signal stats; a 90% range for the edge from a month-clustered bootstrap; daily rank correlation (information coefficient) per factor; bull vs bear (BTC vs its 200-day average); year by year. Holds are capped at +500%, and histories are cut at redenominations.

**Latest result** (2026-11-23, 60-day holds, 0.5% costs, ~126k coin-days, fundamentals-only stages, evidence-adjusted scores):

| | |
|---|---|
| Fundamental score's rank correlation with forward returns | **0.153**, right on **90%** of days (the earlier score with technical factors: 0.036) |
| Score ≥ 60 vs all coins | +0.9% vs −4.8%: **+5.6% edge**, 90% range −2.6% to +14.5% (includes zero); bear markets +14.5% vs −1.5%, bull markets −7.5% vs −7.3% (no edge) |
| By score | <40: −6.4% · 40–49: −0.9% · 50–59: +1.2% · 60–69: +0.6% · 70+: −5.5%. Most of the edge comes from low scores doing badly: the score is better at ruling coins out than in |
| Narrative stages (fundamentals only) | Accelerating +2.7% (best) · Quiet +1.0% · Fading −1.2% · Maturing −2.7% · Emerging −4.6% |
| Attention (context) | Unnoticed +1.6% · Noticed −2.7% · Crowded −8.1% |
| Strongest factors | Track record 0.132 · share of fees to holders 0.066 · usage vs price 0.064 · fee growth (90d) 0.056 · fee level 0.052 |
| Technical factors (earlier test) | Price vs 50-day average −0.035, 90-day momentum −0.020: they hurt, so the app doesn't use them |

**Robustness checks** (shown on the Backtest page with every run):

| Check | Result |
|---|---|
| By period | Before 2024: correlation 0.128, edge +8.8% · 2024 onward: 0.172, edge +4.0%. It works in both, not just one stretch |
| 50 random weight sets (each 0.5–1.5×) | Correlation 0.143–0.155, edge +4.7% to +7.5%, positive in 100% of runs |
| Stage ordering before vs after tuning on this data | 0.151 vs 0.151: the tuning isn't what drives the result |
| Against simpler rules (same share of coin-days picked) | Score 0.153, edge +5.6% · age only 0.132, edge **−6.7%** (the very oldest coins did badly) · fees yes/no 0.083, edge +3.9% · score without age 0.109, edge +6.6% |
| Score with age held constant | **0.097**, right on 76% of days: the fundamentals add information beyond "older coins do better" |
| Leave one category out | Team & execution matters most (0.109 without it, mostly track record); adoption, value capture and valuation add little on top here, partly because only ~120 of ~440 coins have fee data |

The rules are marked **frozen on 2026-11-23** (moved from 2026-11-22 after the verdict and fee-model changes above). Every backtest reports results on data after that date separately: the only truly out-of-sample test, which fills in as time passes. Stage strengths and the fee-spike taper were adjusted using pre-freeze data, so the earlier numbers are in-sample.

## Data sources

All free. Only CoinGecko needs a (free) key.

| Source | Used for |
|---|---|
| [CoinGecko](https://www.coingecko.com/en/api) (Demo key) | Coin details, supply, categories, descriptions and links, daily charts with market cap, exchange tickers and depth, trending, global stats |
| [Binance](https://developers.binance.com/docs/binance-spot-api-docs) (keyless) | **Live prices** for every pair (one call a minute), multi-year daily history including delisted pairs (backtest and narrative indexes), derivatives funding and open interest |
| [Bybit](https://bybit-exchange.github.io/docs/) (keyless) | Derivatives fallback |
| [DefiLlama](https://defillama.com/docs/api) (keyless) | Fees, revenue and holder revenue (with history), TVL, category ranks, audits, hacks, new protocol launches, stablecoins per chain, project links (GitHub orgs, governance spaces) |
| [GitHub](https://docs.github.com/en/rest) (keyless, optional token) | Commit activity (52 weeks) and contributors |
| [Snapshot](https://docs.snapshot.box/tools/api) (keyless) | Governance proposals and votes |
| [alternative.me](https://alternative.me/crypto/fear-and-greed-index/) | Fear & Greed index |
| [AlphaGrowth](https://alphagrowth.io/api/v1) (keyless) | **Token unlock calendar** (next 90 days, who receives each unlock), **funding rounds and investors**, social **community growth**. Data: AlphaGrowth |
| [CoinPaprika](https://api.coinpaprika.com) (keyless, 20,000 calls/month) | Backup prices: the market list when CoinGecko fails or its budget is 90% used, and journal prices for coins outside the top 250 |
| [Blockscout](https://eth.blockscout.com/api-docs) (keyless) · [Ethplorer](https://github.com/EverexIO/Ethplorer/wiki/Ethplorer-API) (free key) | **Top holders** of Ethereum and Optimism tokens, with exchange, contract and burn labels (Blockscout); Ethplorer as the Ethereum backup |
| RSS: Cointelegraph, CoinDesk, Decrypt, The Block (or [CryptoPanic](https://cryptopanic.com/developers/api/) with a key) | News and narrative headline mentions |

## API budget and caching

The CoinGecko Demo plan allows **100 calls/minute but only 10,000/month**, so the app is built around the monthly budget:

- **Live prices come from Binance** (free), so CoinGecko data can be cached for hours without prices going stale. Today's chart bar is updated or added with the live price.
- **Every CoinGecko response is cached on disk** (SQLite), so restarts don't re-spend calls.
- Cache windows: coin details 12 h · daily charts 24 h · exchange tickers 7 days · sector members 7 days · categories 24 h · search 7 days · market list and global stats 1 h · trending 2 h.
- A new coin costs 3 calls; re-checking it is free for 12 hours, then 2 calls a day. Expected use is roughly 2,000–4,500 calls a month.
- The header meter counts every call (failed ones included) and turns amber at 80% and red at 95%.
- **Past 90% of the month's budget** (or whenever CoinGecko fails), the market list switches to CoinGecko's last saved list with CoinPaprika's current prices, so remaining calls go to coin details. CoinPaprika's ticker download is cached 30 minutes (at most ~1,500 of its 20,000 monthly calls).
- AlphaGrowth's unlock calendar is one download (about 12 pages) every 12 hours for all coins; funding and community are cached a day per coin; holder lists a day per token.

GitHub allows 60 requests/hour without a token (each coin's developer activity costs 2–3 and is cached a day). A free `GITHUB_TOKEN` raises that to 5,000.

## Getting started

**Requirements:** Node.js **22.5+** and a free [CoinGecko Demo key](https://www.coingecko.com/en/api).

```bash
cp .env.example .env.local   # paste your key into COINGECKO_API_KEY
npm install
npm run dev                  # http://localhost:3000
```

The first visit to Narratives or the Backtest downloads years of daily prices from Binance (a minute or two); after that it's cached locally.

### Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `COINGECKO_API_KEY` | Yes | — | CoinGecko Demo (or Pro) key |
| `COINGECKO_API_PLAN` | No | `demo` | `demo` or `pro` |
| `COINGECKO_CALLS_PER_MINUTE` | No | `90` | Per-minute ceiling |
| `COINGECKO_MONTHLY_LIMIT` | No | `10000` | Budget shown in the header meter |
| `GITHUB_TOKEN` | No | — | Raises GitHub's rate limit (any free account, no scopes) |
| `CRYPTOPANIC_API_KEY` | No | — | Coin-tagged news instead of RSS |
| `COINSCOPE_DB` | No | `data/coinscope.db` | Where the local database lives |
| `TURSO_DATABASE_URL` | On Vercel | — | Hosted Turso database (`libsql://…`); used instead of the local file when set |
| `TURSO_AUTH_TOKEN` | With Turso | — | Turso database token |

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run db:migrate-turso` | Copies the local database into Turso (skips caches and tables Turso already has rows in; `-- --with-cache` copies caches too) |
| `npm test` | Unit tests (Vitest, 90 tests) for the scorecard, verdicts, thesis checks, narrative rules, the stage check, comparisons, winner patterns, run detection, the decision journal, unlocks, holder concentration and price matching |

## Project structure

```
crypto-analyzer/
├── src/
│   ├── app/                        Next.js App Router pages and API routes
│   │   ├── page.tsx                Market
│   │   ├── narratives/             Narrative stages, changes feed, builders and capital
│   │   │   └── [id]/               One narrative: ranked coins, stage history, builder sources
│   │   ├── winners/                Winner runs, before vs peak, shared and unshared traits
│   │   ├── similarity/             Coin Check (verdicts and benchmark comparison)
│   │   ├── coin/[id]/              Coin research report
│   │   ├── backtest/               Strategy backtest
│   │   ├── analyze/                Winner breakdown, checklist, checklist backtest
│   │   ├── library/  watchlist/    Saved benchmarks, tracked coins
│   │   ├── journal/                Decision journal: buys and passes vs BTC
│   │   └── api/                    JSON routes (see below)
│   ├── components/                 UI: scorecard and research panel, verdict panel, narrative badges,
│   │                               score panels, charts, coin picker, navigation and API meter
│   └── lib/
│       ├── analysis/               Pure engines
│       │   ├── fundamentals.ts     8-category scorecard
│       │   ├── verdict.ts          Strong candidate / Watchlist / Speculative / Avoid
│       │   ├── narrative-rules.ts  Sector index, market phase, stage, smoothing
│       │   ├── narratives.ts       Narrative tracker (stages, history, changes, builders)
│       │   ├── similarity.ts       Fundamental snapshots, benchmark comparison, winner pattern
│       │   ├── winner-pattern.ts   A winner's fundamentals the day before its run
│       │   ├── thesis.ts           Assumption checks and thesis status
│       │   ├── strategy-backtest.ts  Point-in-time backtest of the scorecard
│       │   ├── scores.ts           Short-term (reference only), fundamentals, long-term, risk
│       │   ├── profile.ts          Builds a full coin profile from all sources
│       │   ├── drivers.ts          Drivers and red flags
│       │   ├── curves.ts           Scoring curves
│       │   └── series.ts, checklist.ts, score.ts, backtest.ts, market.ts, categories.ts
│       ├── providers/              Data sources
│       │   ├── coingecko.ts        Rate limiting, call counting, disk cache
│       │   ├── binance.ts          Live prices, multi-year klines, delisted pairs
│       │   ├── defillama.ts        Fees, revenue, holders revenue, ranks, hacks, launches, stablecoins, links
│       │   ├── alphagrowth.ts      Unlock calendar, funding rounds, community growth
│       │   ├── coinpaprika.ts      Backup prices and ticker matching
│       │   ├── holders.ts          Top holders (Blockscout, Ethplorer backup)
│       │   ├── github.ts  snapshot.ts  derivatives.ts  news.ts  sentiment.ts
│       │   └── crypto.ts, types.ts AssetProvider interface and its crypto implementation
│       ├── server/                 cache.ts (memory + disk), db.ts (SQLite), history.ts (price store), thesis-log.ts (thesis history),
│       │                           jobs.ts (background jobs), http.ts
│       └── types.ts                Shared types
├── data/                           Local SQLite database (git-ignored)
├── scripts/                        migrate-to-turso.mjs (copies local data into Turso)
├── PROGRESS.md                     Running log of decisions and work
└── .env.example                    Environment variable template
```

The data layer sits behind an `AssetProvider` interface (`src/lib/providers/types.ts`), so a stock provider can plug into the same pages later.

## API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/global` | GET | Header stats and CoinGecko usage |
| `/api/market` | GET | Market pulse and coin table |
| `/api/narratives` | GET | Narrative stages, history, changes, builders and capital |
| `/api/narratives/[id]` | GET | One narrative: its coins ranked by quick score, builder sources, headlines, stage track record (404 if no longer tracked) |
| `/api/narratives/stage-check` | GET | Every narrative's stage replayed since 2021: stability and what followed each stage |
| `/api/coin-extras?id=&name=&symbol=&mcap=` | GET | Funding rounds, investors and community growth for the coin page (AlphaGrowth) |
| `/api/journal` | GET · POST · PATCH · DELETE | Decisions with results vs BTC and the summary; POST logs a buy or pass with the app's verdict now; PATCH marks a buy sold or reopens it |
| `/api/profiles?ids=a,b` | GET | Full coin profiles (up to 20) |
| `/api/search?q=` · `/api/resolve?q=` | GET | Coin search; resolve a pasted list of tickers or names |
| `/api/research` | GET · PUT | Your ratings, notes, thesis and evidence per coin; `&events=1` adds the thesis history |
| `/api/winners?id=x` | GET · POST | A winner's runs since 2021 and its fundamentals before the chosen one (`&asOf=` previews a date); POST saves the chosen date |
| `/api/winner-pattern?ids=a,b` | GET | Each benchmark's fundamentals before its chosen run, and at the peak |
| `/api/library` | GET · POST · PATCH · DELETE | Saved benchmark coins |
| `/api/watchlist` · `/api/watchlist/refresh` | GET · POST · DELETE | Watchlist and re-scoring |
| `/api/strategy-backtest` | GET · POST | Start a backtest job, poll it, or get the latest result |
| `/api/backtest` | POST | Checklist backtest (Analyze page) |
| `/api/news` | GET | News for a coin or the market |

## Local data

Everything stays on your machine in `data/coinscope.db`, or in a [Turso](https://turso.tech) database when `TURSO_DATABASE_URL` is set (needed on Vercel, where the disk is read-only). Same tables either way:

| Table | Holds |
|---|---|
| `reference_coins` | Library (benchmark profiles and notes) |
| `watchlist`, `snapshots` | Tracked coins; score and verdict history |
| `research` | Your ratings, notes, thesis and evidence per coin |
| `thesis_events` | Thesis history: your edits and assumption check results |
| `bars_cache` | Multi-year daily prices (Binance) |
| `http_cache` | Cached API responses (CoinGecko, GitHub, Snapshot) |
| `kv` | Latest narratives and backtest result |
| `api_usage` | CoinGecko calls per month |
| `narrative_mentions` | Daily headline mention counts per narrative |
| `benchmark_choice` | The run or date each winner is compared as of |
| `decisions` | Journal entries: buy or pass, prices, what the app said at the time, sale |

## Limitations

- **Paid data, so not included:** active users and addresses, holder distribution on chains other than Ethereum and Optimism (their explorers block automated requests).
- **Unlock coverage:** AlphaGrowth's calendar covers about 100 coins (Ethena and Hyperliquid aren't tracked). "No unlocks listed" means fully unlocked or not tracked, so it isn't scored as good news.
- **Judgment calls** (use case, moat, team, ambition, feasibility, theses) come from your own ratings; the app doesn't research them.
- **Narrative membership** uses today's CoinGecko sector lists, which flatters past stages in the backtest. Broad categories like "Layer 1" are excluded, so big L1s may show "no tracked narrative".
- **GitHub:** a project's listed repo is sometimes a docs or old repo. The app compares it with the org's most active repo, but may still miss the main one.
- **Governance:** spaces are found from DefiLlama links plus name guesses; no proposals in 6 months shows as "unknown".
- **Fees** are matched by ticker in the backtest; a few tickers may map to the wrong protocol.
- **Pre-run snapshots** have no TVL, listings or developer data (no cheap history). Runs older than CoinGecko's one-year window use an estimated market cap (today's circulating supply), and coins not on Binance only have that one year of runs. Narrative stages only go back a year.
- **Builders per narrative** count launches across whole DefiLlama categories its coins belong to, not projects tagged to the narrative itself.
- **Funding and integrations** (early-narrative signals in the original framework) have no free source and aren't included.
- Unit tests cover the pure rules; data providers and pages have no automated tests. Runs locally (not deployed).

## Roadmap

- [ ] Holder concentration for Ethereum tokens (Ethplorer, free)
- [ ] Check the "after the rules were frozen" period once a few months of new data exist (no rule changes before then)
- [ ] At that review: consider age as a filter (rule out young coins) rather than a score component: the score without age picked better (+6.6% vs +5.6%), though it ranked worse
- [ ] Automatic daily watchlist refresh
- [ ] Stock support via a second `AssetProvider`
