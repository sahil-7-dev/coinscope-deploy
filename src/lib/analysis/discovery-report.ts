// Readable summary of an early-discovery run. The JSON next to it holds every event and run;
// this file only presents it. Pure, so it can be checked on synthetic results.

import { DISCOVERY_RULES as R, type Group, type HitMetrics, type Interval, type RecallMetrics } from "./discovery";
import type { DiscoveryConfig, DiscoveryRun, SerializedTest } from "./discovery-backtest";

const pct = (v: number | null | undefined, digits = 1) => (v == null ? "—" : `${(v * 100).toFixed(digits)}%`);
const pts = (v: number | null | undefined) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)} pts`);
const num = (v: number | null | undefined, digits = 2) => (v == null ? "—" : v.toFixed(digits));
const ci = (i: Interval) => (i.low === null ? "—" : `${pts(i.low)} to ${pts(i.high)}${i.dropped ? ` (${i.dropped} resamples without events)` : ""}`);
const table = (head: string[], rows: (string | number)[][]) =>
  [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const G = ["overall", "bull", "bear"] as const;

function hitTable(t: SerializedTest): string {
  const m = t.metrics;
  const row = (label: string, f: (x: HitMetrics, g: (typeof G)[number]) => string) => [label, ...G.map((g) => f(m[g], g))];
  return table(
    ["", "Overall", "Bull", "Bear"],
    [
      row("Evaluable discovery events", (x) => String(x.events)),
      row("Unique coins", (x) => String(x.uniqueCoins)),
      row("Distinct quarters (quarter-equivalent coverage)", (x) => `${x.quarters} (${x.coverage})`),
      row("Hits / stopped / expired / delisted-no-hit", (x) => `${x.hits} / ${x.stopped} / ${x.expired} / ${x.delistedNoHit}`),
      row("**Hit rate**", (x) => pct(x.hitRate)),
      row("**Base hit rate (date-matched)**", (x) => pct(x.baseRate)),
      row("**Excess hit rate**", (x) => `**${pts(x.excess)}**`),
      row("90% interval: moving two-quarter blocks (decisive)", (_, g) => ci(t.intervals.moving2[g])),
      row("90% interval: independent quarters (check)", (_, g) => ci(t.intervals.single[g])),
      row("90% interval: fixed half-years (check)", (_, g) => ci(t.intervals.halfYear[g])),
      row("Lift", (x) => num(x.lift)),
      row("False-positive rate", (x) => pct(x.falsePositiveRate)),
      row("Fees-tracked baseline: events / rate / excess", (x) => `${x.feesBase.events} / ${pct(x.feesBase.rate)} / ${pts(x.feesBase.excess)}`),
    ],
  );
}

function downsideTable(m: Group<HitMetrics>): string {
  const row = (label: string, f: (x: HitMetrics) => string) => [label, ...G.map((g) => f(m[g]))];
  return table(
    ["", "Overall", "Bull", "Bear"],
    [
      row("Median MAE: flagged / base", (x) => `${pct(x.downside.maeMedian)} / ${pct(x.downside.baseMaeMedian)}`),
      row("10th-percentile MAE: flagged / base", (x) => `${pct(x.downside.maeP10)} / ${pct(x.downside.baseMaeP10)}`),
      row("Stop rate: flagged / base", (x) => `${pct(x.downside.stopRate)} / ${pct(x.downside.baseStopRate)}`),
      row("Max drawdown, median: flagged / base", (x) => `${pct(x.downside.maxDrawdownMedian)} / ${pct(x.downside.baseMaxDrawdownMedian)}`),
      row("Max drawdown, 90th percentile: flagged / base", (x) => `${pct(x.downside.maxDrawdownP90)} / ${pct(x.downside.baseMaxDrawdownP90)}`),
      row(`Events with a drawdown of ${R.severeDrawdown * 100}%+`, (x) => pct(x.downside.severeShare)),
    ],
  );
}

function recallTable(r: Group<RecallMetrics>): string {
  const row = (label: string, f: (x: RecallMetrics) => string) => [label, ...G.map((g) => f(r[g]))];
  return table(
    ["", "Overall", "Bull", "Bear"],
    [
      row("Qualifying runs (coin eligible at the low)", (x) => String(x.qualifying)),
      row("Runs on coins not yet eligible (blind spot)", (x) => String(x.notEligible)),
      row("Recall, early (flag in the 90 days up to the low)", (x) => `${pct(x.earlyRecall)} (${x.earlyCredited})`),
      row("Recall, still young (flag before halfway)", (x) => `${pct(x.youngRecall)} (${x.youngCredited})`),
      row("Pre-low discoveries: share / days before low (median, range)", (x) => `${pct(x.preLow.share)} / ${num(x.preLow.daysMedian, 0)} (${num(x.preLow.daysMin, 0)}–${num(x.preLow.daysMax, 0)})`),
      row("Post-low discoveries: share / move completed (median, range)", (x) => `${pct(x.postLow.share)} / ${pct(x.postLow.movedMedian, 0)} (${pct(x.postLow.movedMin, 0)}–${pct(x.postLow.movedMax, 0)})`),
    ],
  );
}

function testSection(t: SerializedTest): string {
  const e = t.events;
  const ex = (g: (typeof G)[number]) => e[g].exclusions;
  return [
    `### ${t.spec.label}`,
    "",
    `Test days ${t.period.from} → ${t.period.to} (${t.period.testDays} days, ${t.period.quarters} quarters; ${t.period.thinDays} days dropped for fewer than ${R.minEligiblePerDay} eligible coins). Flag days ${t.flagDays} of ${t.eligibleCoinDays} eligible coin-days (${pct(t.flaggedShare, 2)}).`,
    "",
    table(
      ["Discovery events", "Overall", "Bull", "Bear"],
      [
        ["All events (after the cooldown)", ...G.map((g) => String(e[g].total))],
        ["Excluded: no entry", ...G.map((g) => String(ex(g).noEntry))],
        ["Excluded: immature", ...G.map((g) => String(ex(g).immature))],
        ["Excluded: gaps", ...G.map((g) => String(ex(g).gap))],
        ["Excluded: fewer than 20 comparison coins", ...G.map((g) => String(ex(g).thinBaseline))],
      ],
    ),
    "",
    hitTable(t),
    "",
    "**Downside** (MAE: a negative return, so its 10th percentile is the worst tenth; maximum drawdown: a positive loss, so its 90th percentile is the worst tenth)",
    "",
    downsideTable(t.metrics),
    "",
    `Five worst drawdowns: ${t.metrics.overall.downside.worst.map((w) => `${w.symbol} ${w.flagDate} (${pct(w.maxDrawdown, 0)})`).join(", ") || "—"}`,
    "",
    "**Holding-period returns** (information only; after 0.5% costs, single returns capped at +500%)",
    "",
    table(
      ["Days", "Events", "Mean", "Median", "Share positive", "Base mean", "Base median"],
      t.metrics.overall.holding.map((h) => [h.days, h.n, pct(h.mean), pct(h.median), pct(h.positive), pct(h.baseMean), pct(h.baseMedian)]),
    ),
    "",
    "**Recall and timing** (descriptive, not pass criteria)",
    "",
    recallTable(t.recall),
    "",
    `**Major bear episodes:** ${t.episodes.map((ep) => `${ep.quarters[0]} – ${ep.quarters[ep.quarters.length - 1]}: ${ep.events} bear events, excess ${pts(ep.excess)}`).join("; ") || "none in this period"}`,
    "",
    `**Concentration:** without the ${t.concentration.removed.length} coins contributing most (${t.concentration.removed.map((c) => c.symbol).join(", ") || "—"}), ${t.concentration.events} events, excess ${pts(t.concentration.excess)}.`,
    "",
    "**By year** (information only)",
    "",
    table(
      ["Year", "Events", "Hit rate", "Base", "Excess"],
      t.byYear.map((y) => [y.year, y.events, pct(y.hitRate), pct(y.baseRate), pts(y.excess)]),
    ),
  ].join("\n");
}

function configSection(c: DiscoveryConfig): string {
  const parts = [`## ${c.label}`, "", `Rule: ${c.rule}. Universe: ${c.universe}.`, ""];
  if (c.verdict) {
    parts.push(
      `### Verdict: **${c.verdict.verdict}**`,
      "",
      table(
        ["#", "Criterion", "Result", "Detail"],
        c.verdict.criteria.map((k) => [k.id, k.label, k.passed ? "✓ met" : "✗ not met", k.detail]),
      ),
      "",
    );
    if (c.verdict.fragile.length) parts.push("**Fragility:**", "", ...c.verdict.fragile.map((f) => `- ${f}`), "");
    parts.push(
      "> **Reading a bear-market result:** a passing bear result shows the rule held up consistently across the bear periods in this history. It does not show that it generalizes across many independent bear cycles: the sample has only two major bear episodes, and many events in each respond to the same market conditions.",
      "",
      "> **A pass is not yet an investment edge.** It must also reproduce from the frozen commit, not be carried by a few coins (see the concentration check) or one episode (fragility), and genuinely flag coins early (recall and timing).",
      "",
    );
  } else {
    parts.push("_Information only: no verdict (methodology §3, §5)._", "");
  }
  parts.push(testSection(c.primary), "", testSection(c.secondary), "");
  return parts.join("\n");
}

export function renderDiscoveryMarkdown(run: DiscoveryRun): string {
  const d = run.data;
  return [
    "# Early-discovery test: H0 results",
    "",
    `Methodology: \`${run.methodology.file}\` v${run.methodology.version}, frozen at \`${run.methodology.frozenAt}\`.`,
    `Harness commit: \`${run.harness.commit ?? "unknown"}\`${run.harness.dirty ? " (**uncommitted changes: not a valid H0 run**)" : ""}. Scoring rules frozen ${run.harness.rulesFrozenAt}.`,
    `Ran ${run.ranAt} in ${Math.round(run.durationMs / 1000)} s.${run.rerunReason ? ` **Rerun**, reason: ${run.rerunReason}` : ""}`,
    "",
    "Results describe the **Binance-listed universe**, not the whole crypto market (methodology §3, §10). The first run is in-sample for the score (§5).",
    "",
    "## Data",
    "",
    table(
      ["", "Count"],
      [
        ["Data through", d.lastDate],
        ["Test days (every 3 days)", d.testDays],
        ["Coins loaded (all pairs with 102+ bars)", d.coins],
        ["…of which delisted", d.delistedCoins],
        ["Coins in the top-300 information universe", d.top300Coins],
        ["Coins with DefiLlama fees whose fee series failed to load (scored as no fees)", `${d.feeSeriesMissing.length}${d.feeSeriesMissing.length ? `: ${d.feeSeriesMissing.join(", ")}` : ""}`],
        ["Coin-days with a price bar on a test day", d.coinDays.withBar],
        ["…too young (under 100 bars)", d.coinDays.tooYoung],
        ["…illiquid (30-day volume under $1M)", d.coinDays.illiquid],
        ["…unscorable", d.coinDays.unscorable],
        ["…eligible", d.coinDays.eligible],
      ],
    ),
    "",
    ...run.configs.map(configSection),
  ].join("\n");
}
