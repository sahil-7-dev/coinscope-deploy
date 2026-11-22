# CoinScope: Progress Notes

A running log of what has been built, the decisions behind it, and what's next. Newest entries go at the top of the **Log**.

**Status (2026-11-22):** fundamentals-first research tool. Narratives, Coin Check verdicts, per-coin research reports and a multi-year backtest are built and tested on live data. Runs locally; the database can now be Turso for hosting on Vercel (not deployed yet).

---

## Goal

A **crypto fundamental research and narrative discovery** tool. No technical analysis.

1. **Benchmark:** study coins that already performed well (e.g. ZEC) and what their fundamentals look like.
2. **Narratives:** spot narratives whose fundamentals improve **before** the crowd notices (Stage 1 → 2), and flag crowded ones.
3. **Coin Check:** paste coins → each gets a fundamental scorecard, its narrative stage, a comparison with the benchmarks (stronger / weaker), and a plain verdict: **Strong candidate / Watchlist / Speculative / Avoid**.
4. Mostly **mid-term** holds (1–6 months).

Crypto first, with **stocks** planned later. The data layer is built so a stock source can plug in.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Format | Web dashboard | Interactive charts, tables and inputs |
| Stack | Next.js 16 (App Router) + TypeScript + Tailwind v4 + Recharts | One project: server routes keep the API key secret and cache data |
| Analysis | Rules only, no AI | Free, transparent: every score traces back to a rule |
| No technical analysis | Verdicts and the scorecard use fundamentals only; price is just valuation context and risk | The user's strategy, and the backtest agreed: technical factors hurt (see Test results) |
| Judgment calls | The user rates use case, moat, team, ambition and feasibility and writes bull/base/bear notes; ratings feed the score | Rules can't judge these and the app has no AI |
| Market data | CoinGecko (demo key in `.env.local`) | Prices, supply, categories, exchanges, descriptions |
| Long history | Binance daily klines since 2021, **including delisted pairs**, cached in SQLite | CoinGecko demo only has 365 days; delisted coins reduce survivorship bias |
| Fundamentals | DefiLlama (free): fees, revenue, holders revenue, TVL, category ranks, audits, hacks | Free; covers protocols and chains, including fee-only chains like Zcash |
| Storage | Local SQLite (`data/coinscope.db`, Node's built-in `node:sqlite`) | Library, watchlist, score history, price cache, saved results, your research |
| Look | CoinGecko-style, light by default with a dark toggle | The user asked for CoinGecko as the reference |

## What's built

### Pages
| Page | What it does |
|---|---|
| **Market** `/` | Global stats, market mood, Trending and Top Gainers, coin table with sparklines, ☆ to watch, top categories |
| **Narratives** `/narratives` (`/sectors` redirects) | Fundamentals-only **stage** (Emerging, Accelerating, Quiet, Maturing, Fading: fees vs the market's, builders) and separate **attention** (Unnoticed/Noticed/Crowded from price vs BTC); changes feed, timelines, builders and capital, news mentions |
| **Coin Check** `/similarity` | Paste coins → verdict, fundamental score, evidence confidence, narrative stage, risk, and % match to benchmark coins with "stronger / weaker" lists. One click adds this month's top performers as benchmarks |
| **Coin** `/coin/[id]` | Research report: verdict, what it is (description, links, DefiLlama category, audits, hacks), 8-category scorecard, **Your research** (ratings plus bull/base/bear, catalysts, invalidation), other scores, chart, drivers, red flags, metrics, news |
| **Backtest** `/backtest` | Replays the fundamental score every 3 days since 2021 on ~440 coins (incl. delisted), after costs: score buckets, factor correlations, bull vs bear, year by year, narrative stages |
| **Analyze & Score** `/analyze` | Winners → what drove each run → checklist → checklist backtest → score candidates |
| **Library** `/library` | Saved benchmark coins with full metrics and notes |
| **Watchlist** `/watchlist` | Tracked coins with score history |

### Fundamental scorecard (`analysis/fundamentals.ts`)
| Category | Weight | From |
|---|---|---|
| Use case & problem | 15 | Your rating |
| Narrative strength & timing | 15 | Narrative stage |
| Adoption & growth | 15 | Fee growth 90d/30d, fee level, TVL change |
| Token value capture | 15 | Share of fees to holders, revenue share, holders revenue |
| Tokenomics & supply pressure | 10 | Circulating share, inflation, FDV ÷ market cap |
| Technology & moat | 10 | Share of its DefiLlama category's fees, plus your rating |
| Team, execution & ecosystem | 10 | Commits, age, audits, hacks, tier-1 listings, plus your rating |
| Valuation vs fundamentals | 10 | Usage vs price (90d), P/F, P/S, market cap ÷ TVL |

Coins with no fee data get low fallback scores for adoption, value capture and valuation: they count against the coin but not as evidence. **Evidence confidence** = share of the weight backed by data or your ratings.

### Engines (`src/lib/analysis/`)
- **narrative-rules.ts / narratives.ts:** sector indexes (top 10 coins, equal-weighted, vs BTC), market phase (smoothed over 3 days), and the fundamentals-based stage. A narrative's fees are compared with the market-wide median, so a crash or a bull run doesn't make everything look like it's growing.
- **fundamentals.ts:** the scorecard above (pure, also replayed in the backtest).
- **verdict.ts:** Strong candidate / Watchlist / Speculative / Avoid. Every threshold is in `VERDICT_RULES`.
- **similarity.ts:** fundamentals-only benchmark match (usage, value capture, valuation, tokenomics, narrative, maturity) with stronger/weaker per metric.
- **strategy-backtest.ts:** point-in-time replay of the scorecard (fees lag a day), month-clustered bootstrap for a 90% range, daily rank correlations per factor. Runs as a background job with progress.
- **scores.ts:** short-term (technical, reference only), fundamentals (the scorecard from data), long-term, risk.
- Older: rally detection, drivers and red flags, checklist and its 1-year backtest.

## Test results (live data, 2026-11-22)
**Backtest** (60-day holds, 0.5% costs, top 300 Binance coins + 177 delisted, Jul 2021 – Sep 2026, ~127k coin-days):
- **The fundamental score ranks coins well:** average daily rank correlation **0.148**, right on **90%** of days. The earlier score with technicals: 0.036.
- **By score:** below 40 → −6.0%, 40–49 → +0.5%, 50–59 → +1.8%, 60–69 → +2.2%, **70+ → −4.7%** (often fee spikes at peak activity; verdicts warn about it).
- **Score ≥ 60:** +2.1% vs −4.6% for all coins, a **+6.7% edge** with a 90% range of −1.6% to +15.7%, so not yet distinguishable from luck at the signal level. Beat the baseline in 5 of 6 years; bear markets +14.4% vs −1.3%.
- **Factors that help:** track record (0.124), share of fees to holders (0.065), fee level (0.060), usage vs price (0.044), fee growth 90d (0.040). Technical factors hurt (price vs 50-day average −0.035, 90-day momentum −0.020), so they were removed.
- **Narrative stages:** Emerging +3.8% (best), Early acceleration +0.5%, Quiet −0.9%, Fading −4.7%, Crowded −7.4%, Mainstream −8.9% (worst). Fees tracked −0.8% vs none −5.8%.
- Stage strengths and the fee-spike taper were adjusted once using this data (in-sample), so treat the numbers as optimistic.

**Live scores:** Hyperliquid 77, Aave 71 (Strong candidate), Pendle 69, Zcash 54, Monero 52, Pepe 50 (Avoid: no measurable usage).

Typecheck ✅ Lint ✅ Production build ✅. Screenshots checked: Coin (Aave), Narratives, Backtest.

## Known limits
- **Paid data, so skipped:** active users and addresses. Unlocks, funding and holders now come free from AlphaGrowth and Blockscout/Ethplorer, with gaps: the unlock calendar covers ~100 coins, and holders only Ethereum and Optimism tokens. Treasury data is free but too heavy (17 MB per protocol).
- **Judgment calls** (use case, moat, team, ambition, feasibility, bull/base/bear, catalysts) are your ratings and notes; the app doesn't research them.
- Narrative membership comes from today's CoinGecko lists, which flatters past stages in the backtest. In the backtest, fees are matched by ticker.
- Fee-only chains rank low on "share of category fees" because they're compared with all chains.
- CoinGecko Demo key: 10,000 calls a month. The header meter tracks it (it started counting on 2026-11-22, so calls before that aren't included). A new coin costs 3 calls; re-checking it is free for 12 hours, then 2 calls a day. Expected use: roughly 2,000–4,500 calls a month.
- Not deployed, so it's local only.
- **Narrative stages aren't a validated buy signal:** the stage check found no stage reliably picked the narratives that did better over the next 90 days (2021–2026). They describe fundamentals.

## Next steps (suggested order)
1. [ ] Log every real buy and pass in the Journal; review after ~20 decisions are 30+ days old
1. [ ] Use Coin Check with a real benchmark (e.g. ZEC for privacy) and fill in Your research for a few coins
2. [ ] Out-of-sample check: rerun the backtest in a few months on data the rules weren't tuned on
4. [ ] Commit to git (nothing beyond the starter template is committed)
5. [ ] Holder concentration for Ethereum tokens (Ethplorer, free)
6. [ ] Automatic daily watchlist refresh
7. [ ] Stock support: an `AssetProvider` for a stock API

## How to run
```bash
cd crypto-analyzer
npm run dev        # http://localhost:3000
```
Keys go in `.env.local`: `COINGECKO_API_KEY` (required for speed), and optionally `CRYPTOPANIC_API_KEY`.

---

## Log

### 2026-11-23: Turso support (for hosting on Vercel)
- Vercel's disk is read-only and its `/tmp` is temporary and not shared, so the local SQLite file can't work there. The database layer (`src/lib/server/db.ts`) now uses `@libsql/client`: **Turso** when `TURSO_DATABASE_URL` (+ `TURSO_AUTH_TOKEN`) is set, otherwise the same local file `data/coinscope.db` as before. Same tables and SQL.
- Every database function is now async; ~50 call sites across 20 files await them. `narrativeAt()` takes the narratives data as an argument (loaded once per winner comparison) instead of reading the database inside a loop. The price-history cache read now sits inside the in-flight promise, so concurrent requests still download a coin at most once. API usage counting stays best-effort (a database error never breaks a data call).
- `npm run db:migrate-turso` copies local data into Turso: skips the price/HTTP caches (they refill; `--with-cache` copies them) and any table Turso already has rows in, so re-running is safe.
- Checked: tsc, ESLint, 90 tests, production build, and the built app against a copy of the local database (library, watchlist, research and thesis events, benchmark choices, journal, backtest result, narratives, API meter).

### 2026-11-22: More free data (from the public-apis list)
- Reviewed ~140 crypto/blockchain APIs in public-apis; tested the promising ones live. Added four; skipped the rest (exchanges, paid, chain-specific, or empty data such as AlphaGrowth "users").
- **Token unlocks (AlphaGrowth, keyless):** the 90-day unlock calendar (≈550 unlocks, 12 pages) is downloaded every 12 hours and matched by CoinGecko id. Each coin gets its cliff unlocks as a share of circulating supply (30 and 90 days), the dollar value, the share going to team and investors, and the dates (same-day entries merged). It's a new **tokenomics metric** (weight 30 of the category) and a **"Big unlock coming"** red flag (5%+ in 90 days; high at 10%+ or mostly insiders). Example: Ondo, 35% of circulating on 17 Jan 2027. Coverage: ~100 coins; missing coins are unknown, not scored.
- **Funding and community (AlphaGrowth):** a "Backers and community" panel on the coin page: total raised, rounds, investors, and X/Discord/Telegram/Reddit follower growth. Context only, not scored. Project matching prefers the listing whose slug is the CoinGecko id (AlphaGrowth has near-duplicates), else same ticker and closest market cap within 3×.
- **Holder concentration (Blockscout, Ethplorer backup):** top 10 holders on the token's home chain (Ethereum or Optimism only; other explorers block server requests), labeled wallet / contract / exchange / burn, burned tokens excluded. **"Concentrated holders"** red flag when plain wallets in the top 10 own 40%+ (60%+ high). Bridged copies are skipped (Arbitrum's Ethereum copy showed an OKX wallet holding 32%).
- **CoinPaprika (keyless, 20,000/month):** backup market list (CoinGecko's last saved list + CoinPaprika prices) when CoinGecko fails or the month's budget passes 90%; journal prices for coins outside the top 250. Live check: 199 of 250 coins repriced, within ~0.3% of CoinGecko.
- Fixed while testing: Turbopack's dev cache got corrupted (every page reloaded in a loop); cleared `.next/dev`.
- Tests: 90 (12 new).

### 2026-11-22: Decision journal and narrative stage check
- **Journal** (`/journal`, in the nav; "Log decision" on every coin): log a buy or pass; the app records its verdict, score, confidence, narrative stage and attention, your thesis summary, and the coin's and BTC's prices (live today, or daily closes for past dates). After 30 days each decision is judged against BTC. Summary: your buys, your passes (passes that beat BTC = misses), decisions against the app, results by the app's verdict and by stage at the time (medians). Buys can be marked sold or reopened. Entries logged more than a day late keep their result but are left out of the verdict check, since their verdict is from the logging day. Prices: the cached top-250 list, one batched CoinGecko call for the rest, then Binance live prices.
- **Stage check** (Backtest page, plus a line on Narratives and a track record on each narrative page): replays every narrative's stage daily since 2021 (21 narratives, 124 narrative-years) from data known on each day, using the same rules and smoothing as the live page. It measures how often stages change and reverse, and what followed each stage over 30/90/180 days vs BTC and vs the median narrative over the same days, split before/from 2024, for holds of 1–30 days.
- **Findings:** at the old 5-day hold, a narrative changed stage ~7.4 times a year and 60% of new stages reversed within a month. **Switched to a 20-day hold** (2.7 changes a year, 12% reversed, median stage 66 days; early-stage results no worse in either period). Chosen for stability, which suits 1–6 month holds; the return differences between holds are small enough to be noise. **No stage reliably picked better-performing narratives** (all within about ±1.2% of the typical narrative over 90 days, nothing consistent across periods). The coin-level backtest agrees (narrative stage: "no real effect"). The UI now presents stages as a description of fundamentals, not a buy signal.
- Fixed while building: a narrative's "since" date was capped at the one-year window (Derivatives showed "since Nov 23" for a stage that began in May 2024); tiny negative percentages showed a red arrow on 0.0%.
- Tests: 78 (15 new). Live check: logged a buy and a backdated pass, sold, reopened, invalid dates/actions/sells rejected; test entries deleted afterwards.

### 2026-11-22: Narrative detail page (step 4 of the V2 plan)
- **`/narratives/[id]`**, linked from every narrative name on the Narratives page.
- **Its coins ranked by fundamentals:** a quick score from the scorecard's narrative, adoption, value capture and valuation categories, filled from DefiLlama fee, revenue and holder-revenue series (30 minutes cache, no CoinGecko calls). Coins without fee data are listed last and say so. 30-day price change is shown as context only. "Check the top 10 in Coin Check" link.
- **Stage history:** the full year as a daily strip plus a list of every confirmed stage change; fee growth tiles for 30 and 90 days each next to the market median, since a stage can move on 30-day growth while 90-day growth still trails the market.
- **Builder sources:** which DefiLlama categories and chains the builder count comes from, last 90 days vs the 90 before. Plus matching headlines.
- The index-vs-BTC chart moved to a shared component (`components/NarrativeCharts.tsx`) used by both pages.
- Live check: Derivatives ranks LIT, HYPE, AVNT, GMX first (fees growing, 60–76% to holders, P/F 1.4–12×); an unknown id returns 404; about 12 s for a first load, cached after.

### 2026-11-22: Winner upgrades and the Winners page (step 3 of the V2 plan)
- **Every run since 2021:** `findRuns` finds each separate run of +50% or more (ended by a 30% fall from its peak) on CoinGecko's year of prices extended back with Binance history (when the ticker's price matches). Zcash: 19 runs, including Aug–Nov 2025 (+1,762%).
- **Choose the comparison point:** any run or any date per winner, saved in `benchmark_choice` and used by Coin Check (default: the biggest run of the last year).
- **Before vs at peak:** fundamentals the day before the run (known at the time) next to the peak (hindsight, greyed and labeled).
- **Older runs are flagged:** before CoinGecko's year, market cap and P/F are estimated from today's circulating supply and supply metrics are left out.
- **What winners did not share:** mixed fee earners, mixed narrative stages, metrics too far apart, data only one had.
- **Winners page** (`/winners`, in the nav): shares the benchmark selection with Coin Check; side-by-side table with shared ranges; "Find coins matching this pattern" link.
- Fixed while building: a crash from a qualifying peak straight below the run's low wasn't recorded as a run (end-of-run check now comes first).
- Tests: 63 (6 new). Live check: choosing Zcash's 2025 run switched Coin Check to it (with the estimate flagged); a malformed date was rejected; the choice was reset afterwards.

### 2026-11-22: Thesis tracking and evidence tags (step 2 of the V2 plan; rules-only)
- **Thesis per coin:** stance, one-line thesis, review date, and key assumptions; each assumption can have a data check (fundamental score, fee growth 30/90d, holders' share, P/F, inflation, GitHub commits, risk, narrative stage). One-click starter assumptions.
- **Checks re-run on every analysis** (`trackThesis` in the profile builder). Only changes of result are logged. Broken assumptions show on the coin page (alert banner), in verdicts (a reason, and no Strong verdict), and on the Watchlist (new Thesis column, which works before a refresh from the last logged result). Review dates that arrive are flagged.
- **History** (`thesis_events` table): your edits (stance, thesis, assumptions added/removed, review date, notes) plus "assumption broke / holds" entries.
- **Evidence tags** on every research answer: Verified / Inferred / Unknown plus source links (http/https only; the API drops anything else).
- Research saved before this keeps working (missing thesis/evidence get defaults).
- Tests: 57 (10 new for thesis checks and their effect on verdicts). End-to-end check via the API: saving logged every edit, analysis logged 2 holds + 1 broken, re-analysis logged nothing new; the test data was then deleted.

### 2026-11-22: Validation (step 1 of the V2 plan; staying rules-only)
- **Robustness checks in every backtest:** results by period (before 2024 / 2024 onward / after the rules were frozen on 2026-11-22), each replayable category left out, 50 random weight sets (0.5–1.5×), and the narrative stage ordering before vs after tuning.
- Results: correlation 0.128 before 2024 and 0.172 from 2024 (edge positive in both); random weights 0.143–0.155, edge positive in 50/50 runs; original vs tuned stage order 0.151 vs 0.151. Biggest single contributor is team & execution (mostly track record); fee-based categories add little on top in this test (only ~120 of ~440 coins have fee data).
- `combineCategories` split out of the scorecard so the app and the sensitivity runs share one formula.
- **Unit tests** (Vitest, `npm test`): 47 tests across the scorecard, evidence adjustment, verdict rules, narrative stage/attention, helpers, comparisons, winner pattern and run detection. A deliberate break of the "gaps can't raise a score" rule made its test fail, so the suite catches regressions.

### 2026-11-22: Winner patterns, fundamentals-only stages, evidence-adjusted scores, competitors (from a ChatGPT review)
- **Pre-run winner snapshots:** each benchmark's biggest run of the last year is found, and its fundamentals are rebuilt on the day before the breakout (DefiLlama fee/revenue/holder history, market cap and supply from its chart, narrative stage). Coin Check compares candidates with that setup by default ("Winner today" still available).
- **Winner pattern:** with 2+ benchmarks, the ranges they shared before their runs; a Pattern column and inside/outside lists per coin. Ranges where winners differ 30×+ are marked "too wide to tell" and left out. Finding: the four winners checked (ZEC, HYPE, AAVE, PENDLE) all had *falling* fees just before their runs.
- **Comparisons** list missing metrics and give each gap a size ("21× smaller", "+35 pts").
- **Stages are fundamentals only:** fee growth vs the market's plus builders (launches in its coins' categories/chains vs DefiLlama's overall pace). New stages: Emerging, Accelerating, Quiet, Maturing, Fading. **Attention** (Unnoticed/Noticed/Crowded, from price vs BTC) is shown separately, never scored; Crowded only blocks a Strong verdict as a labeled market-context reason. A year of stage history is rebuilt.
- **Evidence-adjusted score:** good scores are pulled toward 45 by missing evidence; gaps can't raise a score. (A first version that also lifted weak scores dropped the backtest correlation to 0.084, so it was made one-way.)
- **Competitors table** on coin pages (top fee earners in its DefiLlama category with growth, share, market cap, P/F) and **structured research questions** (why it exists, why it's hard to copy, why the token captures value, vs competitors); old "speciality" notes carry over.
- Headline mentions are saved daily for a 7-day trend. Coin Check accepts `?coins=…&benchmarks=…`.
- Backtest: score correlation **0.150** (89% of days); Accelerating best stage, Emerging worst among tracked; Crowded attention −7.8%. Stage strengths reordered (Accelerating above Emerging) using this data (in-sample).

### 2026-11-22: Narrative history, builders, GitHub, governance, README
- **Narrative history and alerts:** each narrative's stage is rebuilt for the last 90 days (point in time), with "since" dates, a 90-day timeline, and a recent-changes feed. Stages no longer use trending (it has no history; still shown as a badge) and need 5 days to change.
- **Watchlist:** score snapshots store the (data-only) verdict; the Watchlist shows the verdict and its latest change.
- **Builders and capital:** new protocols per DefiLlama category and per chain (90d vs prior 90d), and stablecoins per chain (30d change). Chains get both in their adoption score.
- **GitHub:** 12-week commits, trend vs the prior 12 weeks, contributors, from the busier of the listed repo and the org's most active repo. Optional `GITHUB_TOKEN`.
- **Governance (Snapshot):** proposals and votes over 90 days, from DefiLlama governance links plus name guesses (e.g. `aavedao.eth`). No proposals in 6 months = unknown.
- Fixed: Ethereum matched DefiLlama's "Ethereum Foundation" (a treasury) instead of the Ethereum chain; foundation/treasury/labs entries are now excluded.
- **README** rewritten GitHub-style: workflow, features, scoring, verdicts, stages, backtest, data sources, budget, setup, structure, routes, limits.
- Holder concentration (Ethplorer) is free but not built yet.

### 2026-11-22: CoinGecko call budget (Demo plan: 100/min, 10,000/month)
- **Usage meter** in the header: CoinGecko calls this month (counted locally in SQLite, failed calls included), amber at 80%, red at 95%.
- **Disk cache** for every CoinGecko response, so restarts don't re-spend calls. Long cache times: coin details 12 h, daily charts 24 h, exchange tickers 7 days, sector member lists 7 days, category list 24 h, search 7 days, top-250 market list and global stats 1 h, trending 2 h.
- **Live prices from Binance** (free, one call for every pair, refreshed each minute): price, 24h change, market cap and FDV are scaled to the live price, and today's chart bar is updated or added, so long CoinGecko caches don't mean stale prices. Coins not on Binance show "up to 12h old".
- **Narratives** rebuilt at most every 6 hours and restored from disk after a restart.
- **Search** starts at 3 letters, 400 ms after typing stops. Rate limit raised from 28 to 90 calls/min.
- Measured: 3 new coins = 9 calls; the same coins again (even after a restart) = 0; Narratives and the Market page after a restart = 0.
- Considered Binance price history in place of CoinGecko charts, but kept CoinGecko charts (now cached): Binance-only volume would understate liquidity and it has no market-cap history, which the supply-inflation measure needs.

### 2026-11-22: Fundamentals-first redesign, narratives, Coin Check, backtest
- **No technical analysis** in scores or verdicts. New 8-category **fundamental scorecard** with evidence confidence, and a **Your research** panel (ratings plus bull/base/bear, catalysts, invalidation) stored in SQLite and fed into the score.
- **Verdicts:** Strong candidate / Watchlist / Speculative / Avoid, with reasons and "would become a strong candidate if".
- **Narratives page** replaces Sectors: sector indexes from Binance history, stages from fee growth vs the market, news mentions.
- **Coin Check** (was Similarity Lab): fundamental benchmark comparison with stronger/weaker lists; one click adds top performers as benchmarks.
- **Backtest page:** point-in-time replay since 2021 on ~440 coins including delisted ones, with costs, a bootstrap range, factor correlations, bull/bear, yearly and stage breakdowns. Guards against redenominations and freak pumps.
- **Data:** Binance multi-year klines (SQLite cache); DefiLlama holders revenue, category ranks, audits, hacks and fee-only chains (Zcash, Monero); CoinGecko descriptions and links.
- Fixed: hydration warning from the ColorZilla browser extension (`suppressHydrationWarning` on `<body>`); the SQLite schema now re-applies after hot reloads.

### 2026-11-22: UI readability
- One type scale for the whole app (13 / 15 / 16 / 19px), darker grey text, paragraphs no smaller than 15px.
- Same style on every page for titles, intros, section titles, sub-headings and table headers.

### 2026-11-22: Wider layout
- Page width raised from 1280px to 1680px, with more side padding on large screens.

### 2026-11-22: CoinGecko-style redesign
- Light theme by default plus a dark toggle (`?theme=dark` also works), green brand color, ▲/▼ percentages.
- Header with global stats strip, coin search (`/` shortcut), and navigation with a green underline.
- Market page rebuilt: highlight cards, coin table with sparklines and ☆ watch, Gainers/Losers tabs.
- Coin page: large price summary and stats grid. Charts follow the theme.
- Fixed: rotation map dots not showing, overlapping chart labels, wrapping table headers.

### 2026-11-22: Advanced analysis (Phase 2)
- Reference Library and Similarity Lab (paste a list, % per factor group), fundamentals-first similarity.
- Short / mid / long-term and risk scores.
- Data upgrades: DefiLlama revenue, price-to-fees and growth; RSI, MACD and 200-day average with 1 year of history; tier-1 listings and depth; funding and open interest; supply inflation.
- Tools: checklist backtest, watchlist with score history (SQLite), sector rotation, news feed.
- Fixed: Aave TVL under-counted (versions now summed per parent protocol), fake-volume exchanges skewing liquidity, junk micro-coins inflating sector returns, memes scoring "Strong" long-term, memes looking similar to DeFi coins.

### 2026-11-22: First version (Phase 1)
- Next.js app with Market Pulse, winner breakdown (rally detection and driver rules), auto checklist, candidate scoring.
- CoinGecko, DefiLlama and Fear & Greed data, with caching and rate limiting.
- CoinGecko API key set up. The first key value was rejected ("API Key Missing"); fixed once the correct `CG-…` key was added.