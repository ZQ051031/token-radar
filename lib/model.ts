// Token Radar's value model, radar-2: the snapshot prices itself.
//
// A pre-token protocol is worth what the market already pays for a launched one of the same kind.
// The model reads that price out of the snapshot instead of assuming one:
//
//   multiple   the median market-cap / TVL of launched protocols in the same category (three or
//              more of them), else the median across every launched protocol with a market cap.
//              It is clamped to [0.05, 1.50] so one outlier cannot set the board.
//   base       tvl_usd x multiple
//   growth     change_7d clamped to [-50, 100]; a rise adds half its weight, a fall costs almost
//              all of it, because a shrinking protocol loses farmers faster than a growing one
//              gains them. The factor is clamped to [0.55, 1.50].
//   age        0.75 + 0.25 x min(age_days, 730) / 730. A protocol that has run longer with no token
//              has survived more cycles; an unknown listing date takes the pre-token cohort's
//              median age, never a fixed guess.
//   breadth    1 + 0.02 x min(chains - 1, 10). A protocol live on more chains reaches more farmers.
//   implied    max(1, round(base x growth x age x breadth))
//
// Nothing here names a protocol. The same function scores every row, and the dashboard recomputes
// each row from the same figures, so the page and the board can be checked against each other.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_floor: number;
  growth_cap: number;
  growth_up_weight: number;
  growth_down_weight: number;
  growth_factor_min: number;
  growth_factor_max: number;
  age_floor: number;
  age_range: number;
  age_days: number;
  breadth_step: number;
  breadth_max_chains: number;
  multiple_min: number;
  multiple_max: number;
  min_category_samples: number;
}

export const MODEL: ModelConstants = {
  growth_floor: -50,
  growth_cap: 100,
  growth_up_weight: 0.5,
  growth_down_weight: 0.9,
  growth_factor_min: 0.55,
  growth_factor_max: 1.5,
  age_floor: 0.75,
  age_range: 0.25,
  age_days: 730,
  breadth_step: 0.02,
  breadth_max_chains: 10,
  multiple_min: 0.05,
  multiple_max: 1.5,
  min_category_samples: 3,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by implied value. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 20;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    growth_pct: number;
    growth_factor: number;
    age_factor: number;
    breadth_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the farm plan generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  growth_factor: number;
  age_factor: number;
  breadth_factor: number;
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own multiple, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  market_multiple: number | null;
}

/** The comparable multiples the snapshot itself yields, by category and overall. */
export interface Multiples {
  overall: number;
  by_category: Record<string, number>;
}

/** Everything the dashboard needs: the board, the live set, the multiples and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  multiples: Multiples;
  median_age_days: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The middle value of a sorted copy; the mean of the middle two when the count is even. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word that marks a wrapped or staked product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A name that begins with an exchange's name is that exchange's product, not a launch of its own. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** Categories that are a wrapped, staked or bridged product rather than a protocol awaiting a launch. */
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** Whether a protocol is one the board may rank: pre-token and not a product of a token that trades. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/**
 * The comparable multiples, read out of the snapshot: for every category with at least three
 * launched protocols carrying a market cap, the median of their market-cap / TVL; every other
 * category takes the overall median across all such protocols. Each multiple is clamped so one
 * outlier category cannot set the board.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): Multiples {
  const launched = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const clamp = (n: number): number => Math.min(model.multiple_max, Math.max(model.multiple_min, n));
  const overall = clamp(median(launched.map((p) => p.mcap_usd! / p.tvl_usd)));
  const byCategory = new Map<string, number[]>();
  for (const p of launched) {
    const key = p.category ?? 'Other';
    const list = byCategory.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    byCategory.set(key, list);
  }
  const by_category: Record<string, number> = {};
  for (const key of [...byCategory.keys()].sort()) {
    const list = byCategory.get(key)!;
    by_category[key] = list.length >= model.min_category_samples ? clamp(median(list)) : overall;
  }
  return { overall, by_category };
}

/** The multiple one protocol is scored with: its category's, else the overall median. */
export function multipleFor(p: SnapshotProtocol, multiples: Multiples): number {
  return multipleForCategory(p.category, multiples);
}

/** The multiple for a category: its own median, else the overall median. */
export function multipleForCategory(category: string | null, multiples: Multiples): number {
  const key = category ?? 'Other';
  return multiples.by_category[key] ?? multiples.overall;
}

/** The median age of the pre-token cohort, for protocols whose listing date is unknown. */
export function medianPreTokenAge(snapshot: Snapshot): number {
  const ages = snapshot.protocols.filter(isPreToken).map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((a): a is number => a !== null);
  return ages.length > 0 ? median(ages) : 365;
}

/** The four factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: Multiples,
  cohortAge: number,
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; growthPct: number; growthFactor: number; ageFactor: number; breadthFactor: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const multiple = multipleFor(protocol, multiples);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const weight = growthPct >= 0 ? model.growth_up_weight : model.growth_down_weight;
  const growthFactor = Math.min(model.growth_factor_max, Math.max(model.growth_factor_min, 1 + (growthPct / 100) * weight));
  const ageForModel = age ?? cohortAge;
  const ageFactor = model.age_floor + (Math.min(Math.max(ageForModel, 0), model.age_days) / model.age_days) * model.age_range;
  const breadthFactor = 1 + Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains) * model.breadth_step;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthFactor * ageFactor * breadthFactor));
  return { implied, multiple, growthPct, growthFactor, ageFactor, breadthFactor, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = categoryMultiples(snapshot, model);
  const cohortAge = medianPreTokenAge(snapshot);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the watchlist floor, by implied value —
  // the radar exists to find them early, so it ranks them by value, not by size. When the floor
  // leaves fewer than EARLY_ROWS, the rest come from rankable protocols above it, same order.
  const rankable = snapshot.protocols.filter((p) => !chosen.has(p.slug) && isRankable(p));
  const below = rankable.filter((p) => p.tvl_usd < snapshot.floor_usd);
  const above = rankable.filter((p) => p.tvl_usd >= snapshot.floor_usd);
  const scored = (list: SnapshotProtocol[]): { p: SnapshotProtocol; implied: number }[] =>
    list.map((p) => ({ p, implied: impliedValue(p, snapshot.as_of, multiples, cohortAge, model).implied }));
  const early = [...scored(below), ...scored(above)]
    .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const e of early) chosen.set(e.p.slug, e.p);

  const scoredChosen = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiples, cohortAge, model);
    return { p, ...v };
  });
  scoredChosen.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scoredChosen.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      multiple: round4(s.multiple),
      growth_pct: round4(s.growthPct),
      growth_factor: round4(s.growthFactor),
      age_factor: round4(s.ageFactor),
      breadth_factor: round4(s.breadthFactor),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page once a week.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 10_000_000_000) return 300;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 100;
  if (p.tvl_usd >= 10_000_000) return 50;
  return 25;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 90) return 90;
  if (age < 365) return 60;
  return 30;
}

/** The category's core action, in the words a farmer can follow. */
function coreActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC on ${name} (${chain}) and leave the supply earning.`;
  if (c.includes('dex') || c.includes('amm') || c.includes('liquidity')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and hold the LP tokens.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('aggregator')) return `Deposit $${capital} into ${name}'s highest-yield vault on ${chain} and keep the receipt tokens.`;
  if (c.includes('bridge')) return `Move $${capital} of USDC to ${chain} through ${name}, then put the bridged funds to work in one app there.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} through ${name} on ${chain} and keep the staking receipt in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Post $${capital} of USDC as margin on ${name} and open a single small hedged trade.`;
  if (c.includes('prediction')) return `Back one outcome with $${capital} on ${name} and let the position settle.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the farming wallet.`;
  if (c.includes('stable') || c.includes('issuer')) return `Mint or hold $${capital} of the stable asset ${name} issues on ${chain}.`;
  if (c.includes('launchpad')) return `Stake $${capital} to join ${name}'s next sale on ${chain} and take part in one allocation.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('curator') || c.includes('allocator')) return `Allocate $${capital} to a ${name} vault on ${chain} and hold the vault shares.`;
  return `Put $${capital} to work in ${name} on ${chain} and leave the position open.`;
}

/** A second, different interaction with the same protocol, so the wallet shows more than one action. */
function secondActionFor(p: SnapshotProtocol, capital: number): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow a small amount against the supply once, then repay it within the same week.`;
  if (c.includes('dex') || c.includes('amm') || c.includes('liquidity')) return `Swap a small amount through the pool once a week so the wallet shows trading activity.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('aggregator')) return `Claim or compound the vault's yield once, so the wallet records a harvest.`;
  if (c.includes('bridge')) return `Bridge a second, smaller amount a week later to show repeat use.`;
  if (c.includes('staking') || c.includes('restak')) return `Top up the stake once during the hold, in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Close the hedge after two weeks and open a fresh one with the same margin.`;
  if (c.includes('prediction')) return `Settle one market and open another with a small stake.`;
  return `Use one more feature of ${name} during the first month: a swap, a vote, or a second deposit.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Open a fresh wallet used only for this farm, fund it with $${capital + 10}, and keep its seed phrase offline.`,
      cost: 'under $3 of gas to fund it',
      time: '5 minutes',
    },
    {
      text: coreActionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 200 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, capital),
      cost: 'about $2 of gas',
      time: '10 minutes',
    },
    {
      text: `Do one qualifying action each week — a deposit, a borrow, a swap or a vote — so the wallet stays active.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Once a month, open the protocol's own points or rewards page from inside its app and check what the wallet earned. Claim only through the link the app itself publishes, and never pay to claim.`,
      cost: 'free to check',
      time: '10 minutes a month',
    },
    {
      text: `Keep a farm log with the wallet address, the dates, the amounts and every transaction hash, and decide the exit before any token exists.`,
      cost: 'nothing but the log',
      time: '5 minutes a week',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && (p.category === null || !EXCLUDED_CATEGORIES.has(p.category)))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      market_multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page.
 * The multiple is kept at full precision here, so the page recomputes the exact
 * implied value the board carries; the rounded figure lives in board.json's model. */
export function radarRow(row: BoardRow, watchlist: boolean, multiples: Multiples): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    multiple: multipleForCategory(row.category, multiples),
    growth_factor: row.model.growth_factor,
    age_factor: row.model.age_factor,
    breadth_factor: row.model.breadth_factor,
    watchlist,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const multiples = categoryMultiples(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    multiples,
    median_age_days: medianPreTokenAge(snapshot),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, snapshot.watchlist.includes(r.slug), multiples)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function checkBoard(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const trimmed = s.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${r.slug} has a farm step of ${trimmed.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
