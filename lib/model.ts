// Token launch radar: one sealed DefiLlama snapshot in, one ranked board out.
//
// The board ranks every protocol the snapshot records with no token that the
// house's own exclusion rule keeps: no wrapped, staked or bridged product, no
// exchange, no versioned pool. The watchlist is the floor, never the ceiling:
// all 40 of its slugs are covered, and every other qualifying pre-token
// protocol below the floor is ranked with them.
//
// Implied value is derived from the snapshot's own figures, never from a
// hand-written list of names:
//
//   base     = median(mcap_usd / tvl_usd) over the live-token protocols
//              whose market cap the snapshot records, outside the excluded
//              categories. The market's own pricing of a dollar of TVL,
//              recomputed from the snapshot on every run.
//   growth   = 1 + clamp(change_7d, -60, +120) / 100 * 0.5
//   maturity = 0.6 + min(age_days, 1095) / 1095 * 0.4
//   chains   = 1 + 0.02 * min(chains - 1, 5)
//   implied  = max(1, round(tvl_usd * base * growth * maturity * chains))
//
// Age is the days since DefiLlama began tracking the protocol; a protocol
// with no listing date takes the median age of the dated qualifying
// protocols. A seven-day change the snapshot does not report counts as 0.
//
// Two refinements were measured on this snapshot and rejected, and the
// dashboard says so: per-category base multiples (only five categories hold
// five or more live-token protocols, so most rows would fall back to the
// overall median anyway) and a steeper growth weight (the snapshot's largest
// weekly move is over +4,400%, a spike no launch multiple should chase).

/** One protocol entry: exactly the ten fields the sealed input carries. */
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

/** The numbers the model derives from the snapshot before it scores a row. */
export interface Calibration {
  /** Median mcap/TVL of the live-token protocols the snapshot prices. */
  base_multiple: number;
  /** How many live-token protocols the median stands on. */
  live_priced: number;
  /** Median age in days of the dated qualifying pre-token protocols. */
  median_age_days: number;
  /** How many qualifying protocols carry a listing date. */
  dated_rows: number;
}

/** The model's fixed shape: clamps and weights, stated in the dashboard. */
export interface ModelShape {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  chain_step: number;
  chain_cap: number;
}

export const SHAPE: ModelShape = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  chain_step: 0.02,
  chain_cap: 5,
};

/** The model's version label, shown in the dashboard's header. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's Live tab carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One row as the dashboard reads it: the board's row plus its farm plan. */
export interface RadarRow extends BoardRow {}

/** A live-token protocol: it already trades, so the market's own value is shown. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  mcap_per_tvl: number;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  shape: ModelShape;
  calibration: Calibration;
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

/** Categories the house's watchlist rule excludes: wrapped, staked, bridged, exchange products. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names: a protocol beginning with one is the exchange's own product. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** The house's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking in the name: a product of a token that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers; 0 when the list is empty. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether the snapshot records no token for the protocol: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether the board may rank the protocol: pre-token, and kept by the house's
 * exclusion rule on the fields the snapshot carries (category and name). The
 * house's parent-protocol field is not in the snapshot, so a protocol the
 * watchlist leaves out for that reason alone still reads as rankable here;
 * the watchlist itself is always covered in full either way.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/**
 * The calibration: the base multiple is the median market-cap-per-TVL of the
 * live-token protocols the snapshot prices, outside the excluded categories
 * (an exchange token or a bridge token is not priced on its TVL). The median
 * age is the median listing age of the dated qualifying protocols.
 */
export function calibrate(snapshot: Snapshot): Calibration {
  const ratios: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    if (p.gecko_id === null) continue;
    if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) continue;
    ratios.push(p.mcap_usd / p.tvl_usd);
  }
  const ages: number[] = [];
  for (const p of snapshot.protocols) {
    if (!isRankable(p)) continue;
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (age !== null) ages.push(age);
  }
  return {
    base_multiple: median(ratios),
    live_priced: ratios.length,
    median_age_days: ages.length > 0 ? Math.round(median(ages)) : 365,
    dated_rows: ages.length,
  };
}

/** The multipliers and the implied value one protocol gets. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  cal: Calibration,
  shape: ModelShape = SHAPE,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(shape.growth_cap, Math.max(shape.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * shape.growth_weight;
  const ageForModel = age ?? cal.median_age_days;
  const maturityMult =
    shape.maturity_floor + (Math.min(Math.max(ageForModel, 0), shape.maturity_days) / shape.maturity_days) * shape.maturity_range;
  const chainMult = 1 + shape.chain_step * Math.min(Math.max(p.chains.length - 1, 0), shape.chain_cap);
  const implied = Math.max(1, Math.round(p.tvl_usd * cal.base_multiple * growthMult * maturityMult * chainMult));
  return { implied, growthPct, growthMult, maturityMult, chainMult, age };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// ---------------------------------------------------------------- farm plans

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * Rough gas for one simple transaction on a chain, in dollars. Fees move with
 * congestion, so every plan says "about" and tells the reader to check the
 * fee before sending; the table only keeps the cost estimates honest between
 * a $6 chain and a $0.05 one.
 */
const GAS_USD: Record<string, number> = {
  Ethereum: 6,
  Bitcoin: 3,
  Tron: 1,
  Arbitrum: 0.4,
  Optimism: 0.4,
  BSC: 0.3,
  Binance: 0.3,
  Avalanche: 0.3,
  'zkSync Era': 0.3,
  Linea: 0.2,
  Scroll: 0.2,
  Cardano: 0.2,
  Base: 0.15,
  Polygon: 0.1,
  Ink: 0.1,
  Bittensor: 0.1,
  Berachain: 0.1,
  Unichain: 0.1,
  Mode: 0.1,
  Blast: 0.1,
  Fantom: 0.1,
  Gnosis: 0.1,
  Cronos: 0.1,
  Solana: 0.05,
  Sui: 0.05,
  Aptos: 0.05,
  'Hyperliquid L1': 0.05,
  Sei: 0.05,
  Near: 0.05,
  Cosmos: 0.05,
  Stellar: 0.01,
};

function gasFor(chain: string): number {
  return GAS_USD[chain] ?? 1;
}

function fmtGas(n: number): string {
  return n >= 1 ? `$${n}` : `$${n.toFixed(2)}`;
}

/** The category's core farming action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open, borrowing under half the supply so a price move cannot liquidate it.`;
  if (c.includes('dex') || c.includes('leveraged farm'))
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield aggregator') || c.includes('yield'))
    return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the shares.`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis') || c.includes('options'))
    return `Deposit $${capital} of USDC as margin on ${name}, open one small hedge, and keep leverage under 2x so a liquidation cannot take the wallet.`;
  if (c.includes('prediction'))
    return `Fund $${capital} on ${name} and place one position in a market that settles within the month.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares for the full hold.`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('rwa'))
    return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it through one distribution cycle.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy for the full hold.`;
  if (c.includes('index'))
    return `Buy $${capital} of the ${name} index token on ${chain} and hold it.`;
  if (c.includes('payment'))
    return `Move $${capital} through ${name} on ${chain} and keep the receipt of the transfer.`;
  if (c.includes('locker'))
    return `Lock $${capital} of tokens through ${name} on ${chain} for the shortest lock it offers.`;
  if (c.includes('launchpad'))
    return `Stake $${capital} through ${name} on ${chain} to qualify for its next launch allocation.`;
  if (c.includes('privacy'))
    return `Deposit $${capital} through ${name}'s shielded pool on ${chain} and withdraw it to a fresh address after the hold.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second qualifying action: a different feature, a different day. */
function secondActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Borrow $25 against the supply and repay it within the week, so both sides of the position are on record.`;
  if (c.includes('dex') || c.includes('leveraged farm'))
    return `Swap $25 through the pool and add a second, smaller position in another pair on ${chain}.`;
  if (c.includes('yield'))
    return `Deposit $25 into a second ${name} vault, on a different chain when one is listed.`;
  if (c.includes('bridge'))
    return `Send a second, smaller transfer on a different day and use the funds in the destination app.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake or delegate a second small amount through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis') || c.includes('options'))
    return `Open one more small hedge and close it within the week, keeping leverage under 2x throughout.`;
  if (c.includes('prediction'))
    return `Take a second position in a different market and hold it to settlement.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Deposit $25 into a second vault ${name} runs, on a different chain when one is listed.`;
  if (c.includes('rwa'))
    return `Hold the receipt token for one full distribution cycle and claim the yield it pays.`;
  return `Use a second feature of the app — a swap, a deposit or a vote — so the wallet's activity is not a single transaction.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = fmtGas(gasFor(chain));
  const setupGas = gasFor(chain) >= 1 ? gas : fmtGas(Math.max(gasFor(chain) * 2, 0.1));
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, keep its seed phrase offline, and fund it with $${capital} plus about ${setupGas} for gas on ${chain}.`,
      cost: `about ${setupGas} of gas for the first transaction; fees move, check before you send`,
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about ${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, chain),
      cost: 'about $25 of capital and one transaction of gas',
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week — a deposit, a borrow, a swap or a vote — so the wallet stays active across snapshots.`,
      cost: `about ${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page from the link it publishes, claim only there, and write the wallet, the dates and every transaction in a farm log.`,
      cost: 'no fee to check, and never pay to claim',
      time: '15 minutes',
    },
  ];
}

// ---------------------------------------------------------------- the board

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The ranked board: every qualifying pre-token protocol, strongest implied value first. */
export function buildBoard(snapshot: Snapshot, cal: Calibration, shape: ModelShape = SHAPE): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, covered in full.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other protocol the exclusion rule keeps, at any
  // size. A chosen protocol stays chosen; nothing below the floor is cut.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, cal, shape);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    token_status: 'pre-token' as const,
    on_watchlist: snapshot.watchlist.includes(s.p.slug),
    implied_value_usd: s.implied,
    model: {
      base_multiple: cal.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live tab. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      mcap_per_tvl: round4(p.mcap_usd! / p.tvl_usd),
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, shape: ModelShape = SHAPE): { board: BoardRow[]; radar: RadarData } {
  const cal = calibrate(snapshot);
  const board = buildBoard(snapshot, cal, shape);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.on_watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    shape,
    calibration: cal,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}

// ---------------------------------------------------------------- parsing

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
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
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

// ---------------------------------------------------------------- the gate, locally

/** Why a board is not one the gate will take, or null. Mirrors the scorer's seven rows. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const slugs = new Set<string>();
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (slugs.has(r.slug)) return `${r.slug} appears twice`;
    slugs.add(r.slug);
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
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
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** The dashboard's whole dataset as one script: window.RADAR, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
