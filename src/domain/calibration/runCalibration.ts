/**
 * 8.1 보정 목표 몬테카를로. scripts/sim-batch.ts(Node)와 웹 워커가 공유한다. 소유: A.
 * 합성 팀은 squad/generator 로 만든다 (엔진은 생성기를 모름 → domain 에 위치).
 */
import type {
  CalibrationOptions,
  CalibrationProgress,
  CalibrationReport,
  CalibrationTarget,
  Club,
  EngineConfig,
  EngineTeamInput,
  FormationId,
  MatchPlan,
  MatchResult,
  OpenPlayChance,
  Player,
  RoleId,
  RuleId,
  ScenarioId,
  TacticCap,
  TacticSlot,
  TeamInstructions,
  ValueTable,
} from '../../types';
import {
  ENGINE_VERSION,
  PRESETS,
  RULE_IDS,
  VALUE_TABLE,
  defaultRoles,
  explainMatch,
  hashString,
  mulberry32,
  simulateMatch,
} from '../../engine';
import { pickLineup, styleTactics } from '../ai/managerAi';
import { toEngineTeamInput } from '../plan/engineInput';
import { generateSquad } from '../squad/generator';

// ───────────────────────────────────────────── 전술 패키지 (포메이션 + 역할 + 지시)

export type PackageId = 'BALANCED' | 'POSSESSION' | 'COUNTER' | 'HIGH_PRESS' | 'LOW_BLOCK' | 'WIDE' | 'DIAMOND';

export interface TacticPackage {
  id: PackageId;
  label: string;
  formation: FormationId;
  roles: RoleId[];
  instructions: TeamInstructions;
}

function fromSlot(id: PackageId, label: string, s: TacticSlot): TacticPackage {
  return { id, label, formation: s.formation, roles: [...s.roles], instructions: { ...s.instructions } };
}

export const PACKAGES: Record<PackageId, TacticPackage> = {
  BALANCED: { id: 'BALANCED', label: '균형 4-4-2', formation: '4-4-2', roles: defaultRoles('4-4-2'), instructions: { ...PRESETS.BALANCED.instructions } },
  POSSESSION: fromSlot('POSSESSION', '점유 4-3-3', styleTactics('POSSESSION').A),
  COUNTER: fromSlot('COUNTER', '역습 4-4-2', styleTactics('COUNTER').A),
  HIGH_PRESS: fromSlot('HIGH_PRESS', '전방압박 4-3-3', styleTactics('HIGH_PRESS').A),
  LOW_BLOCK: fromSlot('LOW_BLOCK', '잠그기 5-3-2', styleTactics('LOW_BLOCK').A),
  WIDE: fromSlot('WIDE', '측면 4-4-2', styleTactics('WIDE').A),
  DIAMOND: { id: 'DIAMOND', label: '다이아몬드 4-4-2D', formation: '4-4-2D', roles: defaultRoles('4-4-2D'), instructions: { ...PRESETS.BALANCED.instructions } },
};

/** COUNTER_SPREAD 에 쓰는 5 프리셋 (기획서 8.1: 프리셋 S 5종) */
export const SPREAD_PACKAGES: PackageId[] = ['BALANCED', 'POSSESSION', 'COUNTER', 'HIGH_PRESS', 'LOW_BLOCK'];

export const BASE_OVR = 60;

/**
 * 보정 목표 (엔진 0.3.0, 2026-09-27 사용자 결정: 동일 전력 전술 영향 15~30%p).
 * 근거는 docs/시뮬레이션_검증.md 1장. 기획서 8.1 표와 같은 값이어야 한다.
 */
export const TARGETS = {
  counterSpread: [15, 30],
  /** 무승부 ≈ 24%, 최선−최악 15~30%p 이면 유리 측 무승부 제외 승률 ≈ 60~70% */
  favNonDraw: [60, 70],
  ovr10: [60, 68],
  /** 전력 10점 차(≈ +27%p) 에서 최선 카운터(≈ −10%p)를 빼면 50~60% */
  ovr10Counter: [50, 60],
  ruleP95: 0.5,
  allRulesP95: 0.8,
} as const;

// ───────────────────────────────────────────── 합성 팀

interface SquadEntry {
  club: Club;
  players: Record<string, Player>;
}

class TeamFactory {
  private squads = new Map<string, SquadEntry>();
  private inputs = new Map<string, EngineTeamInput>();
  constructor(private readonly seed: number) {}

  squad(ovr: number, idx: number, clubId: string): SquadEntry {
    const key = `${ovr}|${idx}|${clubId}`;
    let s = this.squads.get(key);
    if (!s) {
      const rng = mulberry32(hashString(`${this.seed}|squad|${ovr}|${idx}|${clubId}`));
      const ps = generateSquad(rng, { clubId, targetOvr: ovr, size: 22, tier: 'T3' });
      const players = Object.fromEntries(ps.map((p) => [p.id, p]));
      const club: Club = {
        id: clubId,
        name: clubId,
        shortName: clubId,
        isHuman: false,
        playerIds: ps.map((p) => p.id),
        tactics: { A: this.slot('A', PACKAGES.BALANCED), B: this.slot('B', PACKAGES.BALANCED) },
      };
      s = { club, players };
      this.squads.set(key, s);
    }
    return s;
  }

  private slot(key: 'A' | 'B', pkg: TacticPackage, instr?: TeamInstructions): TacticSlot {
    return { key, formation: pkg.formation, roles: [...pkg.roles], instructions: { ...(instr ?? pkg.instructions) }, familiarity: 100 };
  }

  input(ovr: number, idx: number, clubId: string, pkg: TacticPackage, isHome: boolean, instr?: TeamInstructions): EngineTeamInput {
    const key = `${ovr}|${idx}|${clubId}|${pkg.id}|${JSON.stringify(instr ?? null)}`;
    let base = this.inputs.get(key);
    if (!base) {
      const sq = this.squad(ovr, idx, clubId);
      const club: Club = { ...sq.club, tactics: { A: this.slot('A', pkg, instr), B: this.slot('B', pkg, instr) } };
      const lineup = pickLineup({ club, players: sq.players, opponentId: null, mode: 'SYSTEM_DEFAULT', rng: mulberry32(1) }, club.tactics.A);
      const plan: MatchPlan = { clubId, matchId: null, lineup, startSlot: 'A', conditionals: [], autoSubThreshold: 55, autoRotation: true };
      base = toEngineTeamInput(club, { plan, source: 'SYSTEM', adjustments: [] }, sq.players, true);
      this.inputs.set(key, base);
    }
    return { ...base, isHome };
  }
}

const SQUAD_POOL = 30;
const MATCHES_PER_SQUAD = 20;

function config(cap: TacticCap, extra: Partial<EngineConfig> = {}): EngineConfig {
  return { engineVersion: ENGINE_VERSION, tacCap: cap, tacticsEnabled: true, disabledRules: [], ...extra };
}

interface Tally {
  n: number;
  w: number;
  d: number;
  l: number;
  goals: number;
  shots: number;
}

function tally(): Tally {
  return { n: 0, w: 0, d: 0, l: 0, goals: 0, shots: 0 };
}

/** 팀 X 관점 결과 누적 */
function addResult(t: Tally, r: MatchResult, xIsHome: boolean): void {
  const gf = xIsHome ? r.home.goals : r.away.goals;
  const ga = xIsHome ? r.away.goals : r.home.goals;
  t.n += 1;
  if (gf > ga) t.w += 1;
  else if (gf === ga) t.d += 1;
  else t.l += 1;
  t.goals += r.home.goals + r.away.goals;
  t.shots += r.home.shots + r.away.shots;
}

const pct = (x: number, n: number) => (n > 0 ? (100 * x) / n : 0);

function p95(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(0.95 * (s.length - 1)))]!;
}

// ───────────────────────────────────────────── 매치 러너

interface Runner {
  factory: TeamFactory;
  cap: TacticCap;
  seed: number;
}

/** X(ovrX, pkgX) vs Y(ovrY, pkgY) 를 i 번째로 실행. 짝수 i 는 X 홈, 홀수는 Y 홈 */
function play(
  R: Runner,
  tag: string,
  i: number,
  x: { ovr: number; pkg: TacticPackage; instr?: TeamInstructions; orders?: EngineTeamInput['opponentOrders'] },
  y: { ovr: number; pkg: TacticPackage; instr?: TeamInstructions; orders?: EngineTeamInput['opponentOrders'] },
  extra: Partial<EngineConfig> = {},
): { r: MatchResult; xIsHome: boolean } {
  const idx = Math.floor(i / MATCHES_PER_SQUAD) % SQUAD_POOL;
  const xIsHome = i % 2 === 0;
  const xi = R.factory.input(x.ovr, idx, 'X', x.pkg, xIsHome, x.instr);
  const yi = R.factory.input(y.ovr, idx, 'Y', y.pkg, !xIsHome, y.instr);
  const withOrders = (t: EngineTeamInput, o: EngineTeamInput['opponentOrders'], opp: EngineTeamInput): EngineTeamInput => {
    if (!o) return t;
    const oo = { ...o };
    if (oo.markTarget === '*') oo.markTarget = bestAttacker(opp);
    return { ...t, opponentOrders: oo };
  };
  const X = withOrders(xi, x.orders, yi);
  const Y = withOrders(yi, y.orders, xi);
  const seed = hashString(`${R.seed}|${tag}|${i}`);
  const r = simulateMatch({
    matchId: `${tag}-${i}`,
    seed,
    home: xIsHome ? X : Y,
    away: xIsHome ? Y : X,
    config: config(R.cap, extra),
  });
  return { r, xIsHome };
}

/** 마크 대상 자동 지정: 상대 선발 중 결정력+드리블+시야 최고 */
function bestAttacker(t: EngineTeamInput): string {
  let best = t.starters[0]!.id;
  let bv = -1;
  for (const p of t.starters) {
    const v = p.attrs.finishing + p.attrs.dribbling + p.attrs.vision;
    if (v > bv) {
      bv = v;
      best = p.id;
    }
  }
  return best;
}

// ───────────────────────────────────────────── 시나리오

export interface CounterCell {
  us: PackageId;
  them: PackageId;
  n: number;
  winPct: number;
  drawPct: number;
  lossPct: number;
}

export interface CalibrationDetails {
  baseline?: { n: number; goals: number; draws: number; shotsPerTeam: number; w: number; d: number; l: number };
  counterMatrix?: CounterCell[];
  counterBest?: Record<string, { best: PackageId; worst: PackageId; spread: number; favNonDraw: number }>;
  ovr10?: { strongWin: number; draw: number; weakWin: number; n: number };
  ovr10Counter?: { strongWin: number; draw: number; weakWin: number; n: number; weakPackage: PackageId };
  ovr25?: { strongWin: number; draw: number; weakWin: number; n: number };
  tempo?: { weakWinFast: number; weakWinSlow: number; diff: number; n: number };
  ruleIsolation?: { rule: RuleId; p95: number; mean: number; n: number }[];
  ruleTotalP95?: number;
  noTactics?: { strongWin: number; weakWin: number; n: number };
  counterRawSpread?: number;
  counterCvSpread?: number;
}

const ALL: ScenarioId[] = ['BASELINE', 'COUNTER_SPREAD', 'OVR_DIFF_10', 'OVR_DIFF_10_COUNTER', 'OVR_DIFF_25', 'TEMPO_VARIANCE', 'RULE_ISOLATION'];

function target(
  scenario: ScenarioId,
  id: string,
  label: string,
  actual: number,
  unit: CalibrationTarget['unit'],
  min?: number,
  max?: number,
): CalibrationTarget {
  const pass = (min === undefined || actual >= min) && (max === undefined || actual <= max);
  return { id, scenario, label, actual, unit, pass, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
}

interface RulePair {
  x: PackageId;
  y: PackageId;
  xInstr?: Partial<TeamInstructions>;
  xOrders?: EngineTeamInput['opponentOrders'];
}

const RULE_PAIRS: Record<RuleId, RulePair> = {
  R1: { x: 'HIGH_PRESS', y: 'BALANCED' },
  R2: { x: 'COUNTER', y: 'HIGH_PRESS' },
  R3: { x: 'LOW_BLOCK', y: 'POSSESSION' },
  R4: { x: 'WIDE', y: 'LOW_BLOCK' },
  R5: { x: 'COUNTER', y: 'POSSESSION' },
  R6: { x: 'HIGH_PRESS', y: 'COUNTER' },
  R7: { x: 'DIAMOND', y: 'BALANCED' },
  R9: { x: 'BALANCED', y: 'BALANCED', xOrders: { markTarget: '*' } },
  R10: { x: 'BALANCED', y: 'BALANCED', xOrders: { attackSide: 'L' } },
  TEMPO: { x: 'BALANCED', y: 'BALANCED', xInstr: { tempo: 2 } },
  LINE_FIT: { x: 'COUNTER', y: 'HIGH_PRESS' },
};

export function runCalibrationDetailed(
  opts: CalibrationOptions,
  onProgress?: (p: CalibrationProgress) => void,
  clock: () => number = () => 0,
): { report: CalibrationReport; details: CalibrationDetails } {
  const t0 = clock();
  const n = Math.max(20, Math.floor(opts.matchesPerScenario));
  const scenarios = opts.scenarios && opts.scenarios.length > 0 ? opts.scenarios : ALL;
  const R: Runner = { factory: new TeamFactory(opts.seed), cap: opts.tacCap, seed: opts.seed };
  const targets: CalibrationTarget[] = [];
  const details: CalibrationDetails = {};
  const progress = (scenario: ScenarioId, done: number, total: number) => {
    if (onProgress && (done % 100 === 0 || done === total)) onProgress({ scenario, done, total });
  };
  const B = PACKAGES.BALANCED;

  if (scenarios.includes('BASELINE')) {
    const t = tally();
    for (let i = 0; i < n; i++) {
      const { r, xIsHome } = play(R, 'BASELINE', i, { ovr: BASE_OVR, pkg: B }, { ovr: BASE_OVR, pkg: B }, { neutralVenue: true });
      addResult(t, r, xIsHome);
      progress('BASELINE', i + 1, n);
    }
    const goals = t.goals / t.n;
    const shots = t.shots / t.n / 2;
    details.baseline = { n: t.n, goals, draws: pct(t.d, t.n), shotsPerTeam: shots, w: pct(t.w, t.n), d: pct(t.d, t.n), l: pct(t.l, t.n) };
    targets.push(target('BASELINE', 'goals', '평균 총 득점', goals, 'goals', 2.5, 2.9));
    targets.push(target('BASELINE', 'draws', '무승부 비율', pct(t.d, t.n), '%', 22, 28));
    targets.push(target('BASELINE', 'shots', '팀당 슈팅', shots, 'shots', 9, 15));
    targets.push(target('BASELINE', 'win', '동일 전력 승률 (37±3)', pct(t.w, t.n), '%', 34, 40));
    targets.push(target('BASELINE', 'loss', '동일 전력 패배율 (37±3)', pct(t.l, t.n), '%', 34, 40));
  }

  // COUNTER_SPREAD 는 OVR_DIFF_10_COUNTER 의 최선 카운터 선택에도 쓰인다
  let bestVsBalanced: PackageId | null = null;
  if (scenarios.includes('COUNTER_SPREAD') || scenarios.includes('OVR_DIFF_10_COUNTER')) {
    const full = scenarios.includes('COUNTER_SPREAD');
    const perCell = full ? Math.max(40, Math.round(n / 2)) : Math.max(40, Math.round(n / 5));
    const opponents: PackageId[] = full ? SPREAD_PACKAGES : ['BALANCED'];
    const cells: CounterCell[] = [];
    const best: NonNullable<CalibrationDetails['counterBest']> = {};
    const total = opponents.length * SPREAD_PACKAGES.length * perCell;
    let done = 0;
    let spreadSum = 0;
    let favSum = 0;
    for (const s of opponents) {
      // 교차 검증: 짝수 경기로 최선/최악을 고르고 홀수 경기로 측정 (최댓값 선택 편향 제거)
      const halfA = new Map<PackageId, Tally>();
      const halfB = new Map<PackageId, Tally>();
      for (const p of SPREAD_PACKAGES) {
        const a = tally();
        const b = tally();
        const all = tally();
        for (let i = 0; i < perCell; i++) {
          const { r, xIsHome } = play(R, `CS-${p}-${s}`, i, { ovr: BASE_OVR, pkg: PACKAGES[p] }, { ovr: BASE_OVR, pkg: PACKAGES[s] }, { neutralVenue: true });
          addResult(Math.floor(i / 2) % 2 === 0 ? a : b, r, xIsHome);
          addResult(all, r, xIsHome);
          done += 1;
          progress('COUNTER_SPREAD', done, total);
        }
        halfA.set(p, a);
        halfB.set(p, b);
        cells.push({ us: p, them: s, n: all.n, winPct: pct(all.w, all.n), drawPct: pct(all.d, all.n), lossPct: pct(all.l, all.n) });
      }
      const score = (t: Tally) => pct(t.w, t.n) - pct(t.l, t.n);
      const ranked = [...SPREAD_PACKAGES].sort((p, q) => score(halfA.get(q)!) - score(halfA.get(p)!));
      const bp = ranked[0]!;
      const wp = ranked[ranked.length - 1]!;
      const bt = halfB.get(bp)!;
      const wt = halfB.get(wp)!;
      const spread = pct(bt.w, bt.n) - pct(wt.w, wt.n);
      const fav = bt.w + bt.l > 0 ? (100 * bt.w) / (bt.w + bt.l) : 50;
      best[s] = { best: bp, worst: wp, spread, favNonDraw: fav };
      spreadSum += spread;
      favSum += fav;
      if (s === 'BALANCED') bestVsBalanced = bp;
    }
    details.counterMatrix = cells;
    details.counterBest = best;
    // 참고: 교차검증 없는 단순 최대 − 최소 (잡음으로 위쪽 편향)
    const raw = opponents.map((s) => {
      const col = cells.filter((c) => c.them === s).map((c) => c.winPct);
      return Math.max(...col) - Math.min(...col);
    });
    details.counterRawSpread = raw.reduce((a, b) => a + b, 0) / raw.length;
    details.counterCvSpread = spreadSum / opponents.length;
    if (full) {
      targets.push(target('COUNTER_SPREAD', 'spread', '최선 카운터 − 최악 매치업 승률 차 (교차검증)', spreadSum / opponents.length, '%p', TARGETS.counterSpread[0], TARGETS.counterSpread[1]));
      targets.push(target('COUNTER_SPREAD', 'favNonDraw', '유리 상성 측 무승부 제외 승률', favSum / opponents.length, '%', TARGETS.favNonDraw[0], TARGETS.favNonDraw[1]));
    }
  }

  const strongVsWeak = (tag: ScenarioId, so: number, wo: number, weakPkg: TacticPackage, extra: Partial<EngineConfig> = {}) => {
    const t = tally();
    for (let i = 0; i < n; i++) {
      const { r, xIsHome } = play(R, tag, i, { ovr: so, pkg: B }, { ovr: wo, pkg: weakPkg }, extra);
      addResult(t, r, xIsHome);
      progress(tag, i + 1, n);
    }
    return { strongWin: pct(t.w, t.n), draw: pct(t.d, t.n), weakWin: pct(t.l, t.n), n: t.n };
  };

  if (scenarios.includes('OVR_DIFF_10')) {
    details.ovr10 = strongVsWeak('OVR_DIFF_10', 65, 55, B);
    targets.push(target('OVR_DIFF_10', 'strongWin', '전력 10점 차 강팀 승률', details.ovr10.strongWin, '%', TARGETS.ovr10[0], TARGETS.ovr10[1]));
  }
  if (scenarios.includes('OVR_DIFF_10_COUNTER')) {
    const pkg = bestVsBalanced ?? 'COUNTER';
    const res = strongVsWeak('OVR_DIFF_10_COUNTER', 65, 55, PACKAGES[pkg]);
    details.ovr10Counter = { ...res, weakPackage: pkg };
    targets.push(target('OVR_DIFF_10_COUNTER', 'strongWin', `전력 10점 차 + 약팀 최선 카운터(${PACKAGES[pkg].label}) 강팀 승률`, res.strongWin, '%', TARGETS.ovr10Counter[0], TARGETS.ovr10Counter[1]));
    targets.push(target('OVR_DIFF_10_COUNTER', 'strongStillAhead', '약팀 최선 카운터에도 강팀 승 − 약팀 승', res.strongWin - res.weakWin, '%p', 0));
    // 전술 효과를 끈 같은 대진 (전력만)
    const nt = strongVsWeak('OVR_DIFF_10_COUNTER', 65, 55, PACKAGES[pkg], { tacticsEnabled: false });
    details.noTactics = { strongWin: nt.strongWin, weakWin: nt.weakWin, n };
    if (details.counterCvSpread !== undefined) {
      // "전술만으로 결과가 결정되지 않는다": 전력 10점 차 우위(강팀 승 − 약팀 승, 전술 끔) ≥ 전술 최대 효과(교차검증 승률 차)
      const power = nt.strongWin - nt.weakWin;
      targets.push(target('OVR_DIFF_10_COUNTER', 'powerOverTactics', '전력 10점 차 우위 ÷ 전술 최선−최악 승률 차 (×100)', (100 * power) / Math.max(1e-9, details.counterCvSpread), '%', 100));
    }
  }
  if (scenarios.includes('OVR_DIFF_25')) {
    details.ovr25 = strongVsWeak('OVR_DIFF_25', 72.5, 47.5, B);
    targets.push(target('OVR_DIFF_25', 'strongWin', '전력 25점 차 강팀 승률', details.ovr25.strongWin, '%', 85));
  }
  if (scenarios.includes('TEMPO_VARIANCE')) {
    const run = (tempo: -2 | 2) => {
      const t = tally();
      const instr = { ...B.instructions, tempo };
      for (let i = 0; i < n; i++) {
        const { r, xIsHome } = play(R, 'TEMPO_VARIANCE', i, { ovr: 65, pkg: B, instr }, { ovr: 55, pkg: B, instr });
        addResult(t, r, xIsHome);
        progress('TEMPO_VARIANCE', i + 1 + (tempo === 2 ? 0 : n), 2 * n);
      }
      return pct(t.l, t.n);
    };
    const fast = run(2);
    const slow = run(-2);
    details.tempo = { weakWinFast: fast, weakWinSlow: slow, diff: fast - slow, n };
    targets.push(target('TEMPO_VARIANCE', 'weakWinDiff', '템포 +2 vs −2 약팀 승률 차 |Δ|', Math.abs(fast - slow), '%p', undefined, 2));
  }
  if (scenarios.includes('RULE_ISOLATION')) {
    const rules = opts.rules && opts.rules.length > 0 ? opts.rules : RULE_IDS;
    const iso: NonNullable<CalibrationDetails['ruleIsolation']> = [];
    const perRule = Math.max(20, Math.round(n / 2));
    const total = rules.length * perRule + n;
    let done = 0;
    for (const rule of rules) {
      const pair = RULE_PAIRS[rule];
      const xs: number[] = [];
      for (let i = 0; i < perRule; i++) {
        const { r, xIsHome } = play(
          R,
          `RI-${rule}`,
          i,
          { ovr: BASE_OVR, pkg: PACKAGES[pair.x], ...(pair.xInstr ? { instr: { ...PACKAGES[pair.x].instructions, ...pair.xInstr } } : {}), ...(pair.xOrders ? { orders: pair.xOrders } : {}) },
          { ovr: BASE_OVR, pkg: PACKAGES[pair.y] },
          { onlyRules: [rule] },
        );
        const ex = explainMatch(r, VALUE_TABLE);
        const mine = (xIsHome ? ex.home : ex.away).rules.find((c) => c.ruleId === rule)?.xg ?? 0;
        xs.push(Math.abs(mine));
        done += 1;
        progress('RULE_ISOLATION', done, total);
      }
      iso.push({ rule, p95: p95(xs), mean: xs.reduce((a, b) => a + b, 0) / xs.length, n: xs.length });
      targets.push(target('RULE_ISOLATION', `p95-${rule}`, `${rule} 단독 기여 P95`, p95(xs), 'xG', undefined, TARGETS.ruleP95));
    }
    // 모든 규칙 켠 상태에서 경기별 전술 순 xG 합 |Σ| 의 P95 (다양한 프리셋 조합)
    const all: number[] = [];
    const combos: [PackageId, PackageId][] = [];
    for (const a of SPREAD_PACKAGES) for (const b of SPREAD_PACKAGES) combos.push([a, b]);
    for (let i = 0; i < n; i++) {
      const [a, b] = combos[i % combos.length]!;
      const { r } = play(R, 'RI-ALL', i, { ovr: BASE_OVR, pkg: PACKAGES[a] }, { ovr: BASE_OVR, pkg: PACKAGES[b] });
      const ex = explainMatch(r, VALUE_TABLE);
      all.push(Math.abs(ex.home.rules.reduce((s, c) => s + c.xg, 0)));
      done += 1;
      progress('RULE_ISOLATION', done, total);
    }
    details.ruleIsolation = iso;
    details.ruleTotalP95 = p95(all);
    targets.push(target('RULE_ISOLATION', 'p95-all', '모든 규칙 합 P95', p95(all), 'xG', undefined, TARGETS.allRulesP95));
  }

  const report: CalibrationReport = {
    engineVersion: ENGINE_VERSION,
    tacCap: opts.tacCap,
    matchesPerScenario: n,
    seed: opts.seed,
    targets,
    allPass: targets.every((t) => t.pass),
    durationMs: Math.max(0, Math.round(clock() - t0)),
  };
  return { report, details };
}

export function runCalibration(opts: CalibrationOptions, onProgress?: (p: CalibrationProgress) => void): CalibrationReport {
  return runCalibrationDetailed(opts, onProgress).report;
}

// ───────────────────────────────────────────── VALUE 테이블 생성 (--build-values)

/**
 * 8.8-2: 결정 성공/실패 뒤 "이번 시퀀스 나머지 + 다음 시퀀스" 의 순 xG(행동 팀 관점) 평균 차.
 * 다음 시퀀스를 포함하는 이유: Z0 턴오버는 상대가 Z2 에서 시작하게 만든다(미러링, 8.4).
 */
export function buildValueTable(matches: number, seed: number, cap: TacticCap = 0.5): ValueTable {
  const R: Runner = { factory: new TeamFactory(seed), cap, seed };
  type Acc = { s: number; sn: number; f: number; fn: number };
  const acc = new Map<string, Acc>();
  const ev = new Map<OpenPlayChance, { s: number; n: number }>();
  const add = (k: string, success: boolean, v: number) => {
    let a = acc.get(k);
    if (!a) {
      a = { s: 0, sn: 0, f: 0, fn: 0 };
      acc.set(k, a);
    }
    if (success) {
      a.s += v;
      a.sn += 1;
    } else {
      a.f += v;
      a.fn += 1;
    }
  };
  const combos: [PackageId, PackageId][] = [];
  for (const a of SPREAD_PACKAGES) for (const b of SPREAD_PACKAGES) combos.push([a, b]);
  for (let i = 0; i < matches; i++) {
    const [a, b] = combos[i % combos.length]!;
    const { r } = play(R, 'VALUES', i, { ovr: BASE_OVR, pkg: PACKAGES[a] }, { ovr: BASE_OVR, pkg: PACKAGES[b] });
    const log = r.log;
    // 시퀀스별 슈팅 xG (행동 팀 기준 부호는 아래에서)
    const shotsBySeq = new Map<number, { actor: string; xg: number; idx: number }[]>();
    log.forEach((L, idx) => {
      if (L.kind === 'BINARY' && L.dp === 'DP5') {
        const arr = shotsBySeq.get(L.seq) ?? [];
        arr.push({ actor: L.actor, xg: L.p, idx });
        shotsBySeq.set(L.seq, arr);
      }
    });
    const future = (idx: number, seq: number, actor: string) => {
      let v = 0;
      for (const s of [seq, seq + 1]) {
        for (const sh of shotsBySeq.get(s) ?? []) {
          if (s === seq && sh.idx <= idx) continue;
          v += sh.actor === actor ? sh.xg : -sh.xg;
        }
      }
      return v;
    };
    log.forEach((L, idx) => {
      if (L.kind === 'CHOICE') {
        const e = ev.get(L.chosen) ?? { s: 0, n: 0 };
        e.s += future(idx, L.seq, L.actor);
        e.n += 1;
        ev.set(L.chosen, e);
        return;
      }
      if (L.dp === 'DP5') return;
      const key = L.dp === 'DP4' ? `DP4-${L.chance}` : L.dp === 'DP8' ? `DP8-${L.zone}` : L.dp;
      add(key, L.success, future(idx, L.seq, L.actor));
    });
  }
  const val = (k: string, fallback: number) => {
    const a = acc.get(k);
    if (!a || a.sn === 0 || a.fn === 0) return fallback;
    return round4(a.s / a.sn - a.f / a.fn);
  };
  const cev = (t: OpenPlayChance) => {
    const e = ev.get(t);
    return e && e.n > 0 ? round4(e.s / e.n) : VALUE_TABLE.chanceEv[t];
  };
  const d = VALUE_TABLE;
  return {
    engineVersion: ENGINE_VERSION,
    DP1: val('DP1', d.DP1),
    DP2: val('DP2', d.DP2),
    DP4: {
      CROSS: val('DP4-CROSS', d.DP4.CROSS),
      THROUGH: val('DP4-THROUGH', d.DP4.THROUGH),
      CUTBACK: val('DP4-CUTBACK', d.DP4.CUTBACK),
      LONG: val('DP4-LONG', d.DP4.LONG),
      SOLO: val('DP4-SOLO', d.DP4.SOLO),
      COUNTER: val('DP7', d.DP4.COUNTER),
    },
    DP6: val('DP6', d.DP6),
    DP7: val('DP7', d.DP7),
    DP8: { z0: val('DP8-0', d.DP8.z0), z1: val('DP8-1', d.DP8.z1) },
    chanceEv: { CROSS: cev('CROSS'), THROUGH: cev('THROUGH'), CUTBACK: cev('CUTBACK'), LONG: cev('LONG'), SOLO: cev('SOLO') },
  };
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

