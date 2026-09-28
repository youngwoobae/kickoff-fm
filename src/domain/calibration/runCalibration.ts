/**
 * 8.1 보정 목표 몬테카를로 (엔진 0.4.0, 실축구_전술설계 5장). scripts/sim-batch.ts(Node)와 웹 워커가 공유한다. 소유: A.
 * 합성 팀은 squad/generator 로 만든다 (엔진은 생성기를 모름 → domain 에 위치).
 */
import type {
  AttrKey,
  CalibrationOptions,
  CalibrationProgress,
  CalibrationReport,
  CalibrationTarget,
  Club,
  ConditionalOrder,
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
  StyleId,
  TacticCap,
  TacticSlot,
  TeamInstructions,
  ValueTable,
} from '../../types';
import {
  ENGINE_VERSION,
  FORMATION_IDS,
  NEUTRAL_INSTRUCTIONS,
  ROLE_SHAPE,
  RULE_IDS,
  STYLES,
  STYLE_IDS,
  STYLE_MATRIX_EXPECTED,
  VALUE_TABLE,
  defaultRoles,
  explainMatch,
  hashString,
  mulberry32,
  simulateMatch,
} from '../../engine';
import { botConditionals, pickLineup, styleTactics } from '../ai/managerAi';
import { toEngineTeamInput } from '../plan/engineInput';
import { generateSquad } from '../squad/generator';

// ───────────────────────────────────────────── 전술 패키지 (포메이션 + 역할 + 지시)

/** 스타일 9종 + 중립 4-4-2 (R11 규칙 대진용) */
export type PackageId = StyleId | 'BAL442';

export interface TacticPackage {
  id: string;
  label: string;
  formation: FormationId;
  roles: RoleId[];
  instructions: TeamInstructions;
}

function stylePkg(id: StyleId): TacticPackage {
  const s = STYLES[id];
  return { id, label: `${s.label} ${s.formation}`, formation: s.formation, roles: [...s.roles], instructions: { ...s.instructions } };
}

function formationPkg(f: FormationId): TacticPackage {
  return { id: `F-${f}`, label: f, formation: f, roles: defaultRoles(f), instructions: { ...NEUTRAL_INSTRUCTIONS } };
}

export const PACKAGES = {
  ...(Object.fromEntries(STYLE_IDS.map((id) => [id, stylePkg(id)])) as Record<StyleId, TacticPackage>),
  BAL442: { ...formationPkg('4-4-2'), id: 'BAL442', label: '중립 4-4-2' },
} as Record<PackageId, TacticPackage>;

/** 상성 행렬·최선 카운터에 쓰는 스타일 9종 */
export const SPREAD_PACKAGES: StyleId[] = [...STYLE_IDS];

const SHORT: Record<StyleId, string> = {
  BALANCED: 'BAL',
  HIGH_PRESS: 'GP',
  POSSESSION: 'POS',
  LOW_BLOCK: 'LB',
  COUNTER: 'MBC',
  DIRECT: 'DIR',
  WING_PLAY: 'WNG',
  HIGH_LINE: 'HL',
  WINGBACK_3: 'WB3',
};
export const styleShort = (id: StyleId) => SHORT[id];

export const BASE_OVR = 60;

/**
 * 스타일 적합 스쿼드 (설계 2.5 "적합도 100%" 가정): 요구 특성 능력치 +2, 덜 쓰는 능력치 −2 (합 보존, GK 제외).
 * STYLE_MATRIX·COUNTER_SPREAD 와 STYLE_FIT(적합 쪽)에 쓴다. LEAGUE_REALISM·OVR 시나리오는 일반 스쿼드.
 */
export const STYLE_FIT_MODS: Partial<Record<StyleId, AttrMod>> = {
  HIGH_PRESS: { key: 'fit-GP', up: ['workRate', 'pace', 'tackling'], down: ['vision', 'crossing', 'composure'], delta: 2 },
  POSSESSION: { key: 'fit-POS', up: ['passing', 'vision', 'composure'], down: ['physical', 'tackling', 'crossing'], delta: 2 },
  LOW_BLOCK: { key: 'fit-LB', up: ['tackling', 'positioning', 'physical'], down: ['dribbling', 'vision', 'crossing'], delta: 2 },
  COUNTER: { key: 'fit-MBC', up: ['pace', 'workRate'], down: ['crossing', 'stamina'], delta: 1 },
  DIRECT: { key: 'fit-DIR', up: ['physical', 'crossing', 'workRate'], down: ['stamina', 'vision', 'dribbling'], delta: 2 },
  WING_PLAY: { key: 'fit-WNG', up: ['crossing', 'pace', 'dribbling'], down: ['vision', 'tackling', 'composure'], delta: 2 },
  HIGH_LINE: { key: 'fit-HL', up: ['pace'], down: ['crossing'], delta: 2 },
  WINGBACK_3: { key: 'fit-WB3', up: ['pace', 'crossing', 'tackling'], down: ['vision', 'stamina', 'finishing'], delta: 2 },
};

/**
 * 보정 목표 (엔진 0.5.0). 근거는 docs/시뮬레이션_검증.md 1장, 실축구_전술설계 4·5장. 기획서 8.1 표와 같은 값이어야 한다.
 */
export const TARGETS = {
  goals: [2.6, 3.0],
  /** 균형 미러(BASELINE) 득점: 리그 현실성(2.6~3.0)과 동시 충족 불가 → 2.4~2.8 (시뮬레이션_검증.md 1장, 2026-09-28 조정) */
  baselineGoals: [2.4, 2.8],
  draws: [22, 28],
  shots: [11.5, 14],
  winLoss: [34, 40],
  counterSpread: [15, 30],
  favNonDraw: [60, 70],
  ovr10: [60, 68],
  ovr10Counter: [50, 60],
  ruleP95: 0.5,
  r7P95: 0.4,
  allRulesP95: 0.8,
  home: { win: [42, 47], draw: [22, 28], away: [27, 33], goalDiff: [0.2, 0.4] },
  /** 0.5.0: 설계 9×9 기대 부호는 가설이고 표본·시드에 따라 64~81% 로 흔들려 75 → 65 (시뮬레이션_검증.md 1장) */
  matrixSign: 65,
  styleDominance: 8,
  /** 0.5.0: 모든 스타일이 (승 − 패) ≥ +6%p 인 상대 ≥ 1 (우위 상대가 있음), ≤ −6%p 인 상대 ≥ 1 (약점이 있음). 이전 2 */
  stylePlusMinus: 1,
  formationPpg: [1.25, 1.5],
  f442v433: 9,
  styleFitGain: [5, 12],
  roleSignatureDirection: 80,
  r2PaceRatio: 2.5,
  staminaShare: [3, 8],
  staminaCond: [6, 10],
} as const;

// ───────────────────────────────────────────── 합성 팀

interface SquadEntry {
  club: Club;
  players: Record<string, Player>;
}

/** 스쿼드 능력치 수정 (STYLE_FIT): 대상 능력치 delta, 보정 능력치 −delta (합 보존) */
export interface AttrMod {
  key: string;
  down: AttrKey[];
  up: AttrKey[];
  delta: number;
}

class TeamFactory {
  private squads = new Map<string, SquadEntry>();
  private inputs = new Map<string, EngineTeamInput>();
  constructor(private readonly seed: number) {}

  squad(ovr: number, idx: number, clubId: string, mod?: AttrMod): SquadEntry {
    const key = `${ovr}|${idx}|${clubId}|${mod?.key ?? ''}`;
    let s = this.squads.get(key);
    if (!s) {
      const rng = mulberry32(hashString(`${this.seed}|squad|${ovr}|${idx}|${clubId}`));
      let ps = generateSquad(rng, { clubId, targetOvr: ovr, size: 22, tier: 'T3' });
      if (mod) {
        const cl = (v: number) => Math.max(1, Math.min(20, v));
        ps = ps.map((p) => {
          if (p.primary === 'GK') return p;
          const attrs = { ...p.attrs };
          for (const k of mod.down) attrs[k] = cl(attrs[k] - mod.delta);
          const per = (mod.delta * mod.down.length) / Math.max(1, mod.up.length);
          for (const k of mod.up) attrs[k] = cl(Math.round(attrs[k] + per));
          return { ...p, attrs };
        });
      }
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

  input(ovr: number, idx: number, clubId: string, pkg: TacticPackage, isHome: boolean, instr?: TeamInstructions, mod?: AttrMod): EngineTeamInput {
    const key = `${ovr}|${idx}|${clubId}|${pkg.id}|${pkg.roles.join(',')}|${JSON.stringify(instr ?? null)}|${mod?.key ?? ''}`;
    let base = this.inputs.get(key);
    if (!base) {
      const sq = this.squad(ovr, idx, clubId, mod);
      const club: Club = { ...sq.club, tactics: { A: this.slot('A', pkg, instr), B: this.slot('B', pkg, instr) } };
      const lineup = pickLineup({ club, players: sq.players, opponentId: null, mode: 'SYSTEM_DEFAULT', rng: mulberry32(1) }, club.tactics.A);
      const plan: MatchPlan = { clubId, matchId: null, lineup, startSlot: 'A', conditionals: [], autoSubThreshold: 55, autoRotation: true };
      base = toEngineTeamInput(club, { plan, source: 'SYSTEM', adjustments: [] }, sq.players, true);
      this.inputs.set(key, base);
    }
    return { ...base, isHome };
  }

  /** 리그 현실성용 봇: 스타일 슬롯 A/B + 지키기·추격 조건부 지시 (실제 봇 운영과 같은 구성) */
  botInput(ovr: number, idx: number, clubId: string, style: StyleId, isHome: boolean): EngineTeamInput {
    const key = `bot|${ovr}|${idx}|${clubId}|${style}`;
    let base = this.inputs.get(key);
    if (!base) {
      const sq = this.squad(ovr, idx, clubId);
      const club: Club = { ...sq.club, tactics: styleTactics(style) };
      const lineup = pickLineup({ club, players: sq.players, opponentId: null, mode: 'SYSTEM_DEFAULT', rng: mulberry32(1) }, club.tactics.A);
      const conditionals: ConditionalOrder[] = botConditionals(club, 'A');
      const plan: MatchPlan = { clubId, matchId: null, lineup, startSlot: 'A', conditionals, autoSubThreshold: 55, autoRotation: true };
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
const wl = (t: Tally) => pct(t.w, t.n) - pct(t.l, t.n);

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

interface Side {
  ovr: number;
  pkg: TacticPackage;
  instr?: TeamInstructions;
  orders?: EngineTeamInput['opponentOrders'];
  mod?: AttrMod;
  /** 입력 직접 변형 (선수 능력치 고정 등) */
  tweak?: (t: EngineTeamInput) => EngineTeamInput;
}

/** X vs Y 를 i 번째로 실행. 짝수 i 는 X 홈, 홀수는 Y 홈 */
function play(R: Runner, tag: string, i: number, x: Side, y: Side, extra: Partial<EngineConfig> = {}): { r: MatchResult; xIsHome: boolean; X: EngineTeamInput; Y: EngineTeamInput } {
  const idx = Math.floor(i / MATCHES_PER_SQUAD) % SQUAD_POOL;
  const xIsHome = i % 2 === 0;
  const xi = R.factory.input(x.ovr, idx, 'X', x.pkg, xIsHome, x.instr, x.mod);
  const yi = R.factory.input(y.ovr, idx, 'Y', y.pkg, !xIsHome, y.instr, y.mod);
  const withOrders = (t: EngineTeamInput, s: Side, opp: EngineTeamInput): EngineTeamInput => {
    let out = s.tweak ? s.tweak(t) : t;
    if (s.orders) {
      const oo = { ...s.orders };
      if (oo.markTarget === '*') oo.markTarget = bestAttacker(opp);
      out = { ...out, opponentOrders: oo };
    }
    return out;
  };
  const X = withOrders(xi, x, yi);
  const Y = withOrders(yi, y, xi);
  const seed = hashString(`${R.seed}|${tag}|${i}`);
  const r = simulateMatch({ matchId: `${tag}-${i}`, seed, home: xIsHome ? X : Y, away: xIsHome ? Y : X, config: config(R.cap, extra) });
  return { r, xIsHome, X, Y };
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

/** 상성 행렬 한 경기 (스타일 적합 스쿼드, 중립) — sim-out 튜닝 스크립트와 같은 경로 */
function matrixPlay(R: Runner, p: StyleId, s: StyleId, i: number) {
  const fx = STYLE_FIT_MODS[p];
  const fy = STYLE_FIT_MODS[s];
  return play(R, `CS-${p}-${s}`, i, { ovr: BASE_OVR, pkg: PACKAGES[p], ...(fx ? { mod: fx } : {}) }, { ovr: BASE_OVR, pkg: PACKAGES[s], ...(fy ? { mod: fy } : {}) }, { neutralVenue: true });
}

const matrixRunners = new Map<string, Runner>();
/** 튜닝·검증용: STYLE_MATRIX 와 같은 시드·스쿼드로 (p vs s) i 번째 경기 */
export function styleMatrixMatch(seed: number, cap: TacticCap, p: StyleId, s: StyleId, i: number): { r: MatchResult; xIsHome: boolean } {
  const k = `${seed}|${cap}`;
  let R = matrixRunners.get(k);
  if (!R) {
    R = { factory: new TeamFactory(seed), cap, seed };
    matrixRunners.set(k, R);
  }
  const { r, xIsHome } = matrixPlay(R, p, s, i);
  return { r, xIsHome };
}

/** 튜닝·검증용: FORMATION_PARITY 와 같은 시드·스쿼드로 (fa vs fb) i 번째 경기 */
export function formationParityMatch(seed: number, cap: TacticCap, fa: FormationId, fb: FormationId, i: number, extra: Partial<EngineConfig> = {}): { r: MatchResult; xIsHome: boolean } {
  const k = `${seed}|${cap}`;
  let R = matrixRunners.get(k);
  if (!R) {
    R = { factory: new TeamFactory(seed), cap, seed };
    matrixRunners.set(k, R);
  }
  const { r, xIsHome } = play(R, `FP-${fa}-${fb}`, i, { ovr: BASE_OVR, pkg: formationPkg(fa) }, { ovr: BASE_OVR, pkg: formationPkg(fb) }, { neutralVenue: true, ...extra });
  return { r, xIsHome };
}

// ───────────────────────────────────────────── 경기 통계 도우미

const isGoalEvt = (e: MatchResult['events'][number]): e is Extract<MatchResult['events'][number], { type: 'GOAL' }> => e.type === 'GOAL';

/** 팀 X 관점 한 경기 지표 */
function teamMetrics(r: MatchResult, xIsHome: boolean, xInput: EngineTeamInput) {
  const me = xIsHome ? r.home : r.away;
  const op = xIsHome ? r.away : r.home;
  const choices = { CROSS: 0, THROUGH: 0, CUTBACK: 0, LONG: 0, SOLO: 0, total: 0 };
  let dp1 = 0;
  let dp1s = 0;
  let oppDp1 = 0;
  let oppDp1s = 0;
  let oppDp2 = 0;
  let oppDp2s = 0;
  let oppThrough = 0;
  let oppThroughS = 0;
  let dp6s = 0;
  let oppR2 = 0;
  let trapOffsides = 0;
  for (const L of r.log) {
    if (L.kind === 'CHOICE') {
      if (L.actor === me.clubId) {
        choices[L.chosen] += 1;
        choices.total += 1;
      } else oppR2 += Math.max(0, L.rawByType.THROUGH.R2 ?? 0);
      continue;
    }
    if (L.actor === me.clubId) {
      if (L.dp === 'DP1') {
        dp1 += 1;
        if (L.success) dp1s += 1;
      }
      if (L.dp === 'DP6' && L.success) dp6s += 1;
      if (L.dp === 'DP4' && !L.success && L.raw.R6 !== undefined) trapOffsides += 1;
    } else {
      if (L.dp === 'DP1') {
        oppDp1 += 1;
        if (L.success) oppDp1s += 1;
      }
      if (L.dp === 'DP2') {
        oppDp2 += 1;
        if (L.success) oppDp2s += 1;
      }
      if (L.dp === 'DP4' && L.chance === 'THROUGH') {
        oppThrough += 1;
        if (L.success) oppThroughS += 1;
      }
      if (L.dp === 'DP1') oppR2 += Math.max(0, L.raw.R2 ?? 0);
    }
  }
  let shots = 0;
  let headerShots = 0;
  let oppCounterXg = 0;
  let oppCornerGoals = 0;
  let slot8Shots = 0;
  const slot8 = xInput.starters[8]?.id;
  for (const e of r.events) {
    if (e.type === 'SHOT') {
      if (e.clubId === me.clubId) {
        shots += 1;
        if (e.chance === 'CROSS' || e.chance === 'CORNER') headerShots += 1;
        if (e.playerId === slot8) slot8Shots += 1;
      } else if (e.chance === 'COUNTER') oppCounterXg += e.xg;
    }
    if (e.type === 'GOAL' && e.clubId === op.clubId && e.chance === 'CORNER') oppCornerGoals += 1;
  }
  return {
    choices,
    dp1,
    dp1s,
    oppDp1,
    oppDp1s,
    oppDp2,
    oppDp2s,
    oppThrough,
    oppThroughS,
    dp6s,
    oppR2,
    trapOffsides,
    shots,
    headerShots,
    oppCounterXg,
    oppCornerGoals,
    slot8Shots,
    possession: me.possessionTime ?? me.possession,
    yellows: me.yellowCards ?? 0,
    r11: me.ruleFires.R11 ?? 0,
    oppR4: op.ruleFires.R4 ?? 0,
  };
}
type TeamMetrics = ReturnType<typeof teamMetrics>;

/** 리그 현실성 누적 (모든 경기, 홈/원정 기준) */
class RealismAcc {
  n = 0;
  goals = 0;
  homeW = 0;
  draw = 0;
  awayW = 0;
  homeGoals = 0;
  awayGoals = 0;
  shots = 0;
  sot = 0;
  xg = 0;
  poss: number[] = [];
  goalEvents = 0;
  firstHalf = 0;
  early = 0;
  late = 0;
  setPiece = 0;
  pkGoals = 0;
  pkShots = 0;
  corners = 0;
  offsides = 0;
  yellows = 0;
  reds = 0;
  score = new Map<string, number>();
  firstGoal = { w: 0, d: 0, l: 0 };
  htLead = { w: 0, d: 0, l: 0 };

  add(r: MatchResult): void {
    const h = r.home;
    const a = r.away;
    this.n += 1;
    this.goals += h.goals + a.goals;
    if (h.goals > a.goals) this.homeW += 1;
    else if (h.goals === a.goals) this.draw += 1;
    else this.awayW += 1;
    this.homeGoals += h.goals;
    this.awayGoals += a.goals;
    this.shots += h.shots + a.shots;
    this.sot += (h.shotsOnTarget ?? 0) + (a.shotsOnTarget ?? 0);
    this.xg += h.xg + a.xg;
    this.poss.push(h.possessionTime ?? h.possession);
    this.corners += (h.corners ?? 0) + (a.corners ?? 0);
    this.offsides += h.offsides + a.offsides;
    this.yellows += (h.yellowCards ?? 0) + (a.yellowCards ?? 0);
    const key = [h.goals, a.goals].sort((x, y) => y - x).join('-');
    this.score.set(key, (this.score.get(key) ?? 0) + 1);
    let first: string | null = null;
    let ht: [number, number] = [0, 0];
    const sc: [number, number] = [0, 0];
    for (const e of r.events) {
      if (e.type === 'HALF_TIME') ht = [sc[0], sc[1]];
      if (e.type === 'RED_CARD') this.reds += 1;
      if (e.type === 'SHOT' && e.chance === 'PK') this.pkShots += 1;
      if (!isGoalEvt(e)) continue;
      if (e.clubId === h.clubId) sc[0] += 1;
      else sc[1] += 1;
      first ??= e.clubId;
      this.goalEvents += 1;
      if (e.minute <= 45) this.firstHalf += 1;
      if (e.minute <= 15) this.early += 1;
      if (e.minute >= 76) this.late += 1;
      if (e.chance === 'CORNER' || e.chance === 'FK' || e.chance === 'PK') this.setPiece += 1;
      if (e.chance === 'PK') this.pkGoals += 1;
    }
    const res = (me: string, bucket: { w: number; d: number; l: number }) => {
      const gf = me === h.clubId ? h.goals : a.goals;
      const ga = me === h.clubId ? a.goals : h.goals;
      if (gf > ga) bucket.w += 1;
      else if (gf === ga) bucket.d += 1;
      else bucket.l += 1;
    };
    if (first) res(first, this.firstGoal);
    if (ht[0] !== ht[1]) res(ht[0] > ht[1] ? h.clubId : a.clubId, this.htLead);
  }

  summary() {
    const n = Math.max(1, this.n);
    const g = Math.max(1, this.goalEvents);
    const mean = this.poss.reduce((s, x) => s + x, 0) / Math.max(1, this.poss.length);
    const sd = Math.sqrt(this.poss.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, this.poss.length));
    const fg = this.firstGoal.w + this.firstGoal.d + this.firstGoal.l;
    const hl = this.htLead.w + this.htLead.d + this.htLead.l;
    const sl = (k: string) => pct(this.score.get(k) ?? 0, n);
    return {
      n: this.n,
      goals: this.goals / n,
      homeWin: pct(this.homeW, n),
      draw: pct(this.draw, n),
      awayWin: pct(this.awayW, n),
      homeMinusAway: (this.homeGoals - this.awayGoals) / n,
      shotsPerTeam: this.shots / n / 2,
      sotPerTeam: this.sot / n / 2,
      sotRatio: pct(this.sot, this.shots),
      goalsPerShot: pct(this.goals, this.shots),
      xgPerTeam: this.xg / n / 2,
      possSd: 100 * sd,
      poss65: pct(this.poss.filter((p) => p >= 0.65 || p <= 0.35).length, n),
      firstHalf: pct(this.firstHalf, g),
      early: pct(this.early, g),
      late: pct(this.late, g),
      setPiece: pct(this.setPiece, g),
      pkShare: pct(this.pkGoals, g),
      pkPerMatch: this.pkShots / n,
      pkConv: pct(this.pkGoals, this.pkShots),
      cornersPerTeam: this.corners / n / 2,
      offsidesPerTeam: this.offsides / n / 2,
      yellows: this.yellows / n,
      reds: this.reds / n,
      s11: sl('1-1'),
      s10: sl('1-0'),
      s21: sl('2-1'),
      s00: sl('0-0'),
      s22: sl('2-2'),
      firstGoalWin: pct(this.firstGoal.w, fg),
      firstGoalLoss: pct(this.firstGoal.l, fg),
      htLeadWin: pct(this.htLead.w, hl),
      htLeadLoss: pct(this.htLead.l, hl),
    };
  }
}
export type RealismSummary = ReturnType<RealismAcc['summary']>;

// ───────────────────────────────────────────── 시나리오

export interface CounterCell {
  us: StyleId;
  them: StyleId;
  n: number;
  winPct: number;
  drawPct: number;
  lossPct: number;
  /** 행 팀 시간 가중 점유율 % */
  possession: number;
}

export interface RoleSignatureRow {
  swap: string;
  metric: string;
  base: number;
  value: number;
  /** 변화량 (relative 면 %, 아니면 %p) */
  change: number;
  min: number;
  dirOk: boolean;
  sizeOk: boolean;
}

export interface CalibrationDetails {
  baseline?: { n: number; goals: number; draws: number; shotsPerTeam: number; w: number; d: number; l: number };
  realHome?: { n: number; homeWin: number; draw: number; awayWin: number; goalDiff: number };
  realism?: RealismSummary;
  stylePossession?: Partial<Record<StyleId, number>>;
  counterMatrix?: CounterCell[];
  counterBest?: Record<string, { best: StyleId; worst: StyleId; spread: number; favNonDraw: number }>;
  matrixSign?: { matched: number; total: number; rate: number; styleAvg: Record<string, number>; plus: Record<string, number>; minus: Record<string, number> };
  formationParity?: { ppg: Record<string, number>; f442v433: number; n: number };
  styleFit?: { gainFit: number; gainUnfit: number; diff: number; r2Fast: number; r2Slow: number; ratio: number };
  roleSignature?: RoleSignatureRow[];
  stamina?: { gpShare2: number; balShare2: number; diff: number; gpCond: number; balCond: number; condDiff: number };
  ovr10?: { strongWin: number; draw: number; weakWin: number; n: number };
  ovr10Counter?: { strongWin: number; draw: number; weakWin: number; n: number; weakPackage: StyleId };
  ovr25?: { strongWin: number; draw: number; weakWin: number; n: number };
  tempo?: { weakWinFast: number; weakWinSlow: number; diff: number; n: number };
  ruleIsolation?: { rule: RuleId; p95: number; mean: number; n: number }[];
  ruleTotalP95?: number;
  noTactics?: { strongWin: number; weakWin: number; n: number };
  counterRawSpread?: number;
  counterCvSpread?: number;
}

const ALL: ScenarioId[] = [
  'BASELINE',
  'REAL_HOME',
  'LEAGUE_REALISM',
  'COUNTER_SPREAD',
  'STYLE_MATRIX',
  'FORMATION_PARITY',
  'STYLE_FIT',
  'ROLE_SIGNATURE',
  'STAMINA_CURVE',
  'OVR_DIFF_10',
  'OVR_DIFF_10_COUNTER',
  'OVR_DIFF_25',
  'TEMPO_VARIANCE',
  'RULE_ISOLATION',
];

function target(
  scenario: ScenarioId,
  id: string,
  label: string,
  actual: number,
  unit: CalibrationTarget['unit'],
  min?: number,
  max?: number,
): CalibrationTarget {
  // 부동소수 허용오차 (경계값 12.000000000000007 같은 실패 방지)
  const eps = 1e-9;
  const pass = (min === undefined || actual >= min - eps) && (max === undefined || actual <= max + eps);
  return { id, scenario, label, actual, unit, pass, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
}

interface RulePair {
  x: PackageId;
  y: PackageId;
  xInstr?: Partial<TeamInstructions>;
  xOrders?: EngineTeamInput['opponentOrders'];
}

/** 규칙 단독 기여 측정 대진 (실축구_전술설계 5장 RULE_ISOLATION) */
const RULE_PAIRS: Record<RuleId, RulePair> = {
  R1: { x: 'HIGH_PRESS', y: 'BALANCED' },
  R2: { x: 'COUNTER', y: 'HIGH_LINE' },
  R3: { x: 'LOW_BLOCK', y: 'POSSESSION' },
  R4: { x: 'WING_PLAY', y: 'LOW_BLOCK' },
  R5: { x: 'COUNTER', y: 'POSSESSION' },
  R6: { x: 'HIGH_LINE', y: 'COUNTER' },
  R7: { x: 'POSSESSION', y: 'WING_PLAY' },
  R9: { x: 'BALANCED', y: 'BALANCED', xOrders: { markTarget: '*' } },
  R10: { x: 'BALANCED', y: 'BALANCED', xOrders: { attackSide: 'L' } },
  R11: { x: 'POSSESSION', y: 'BAL442' },
  R12: { x: 'WING_PLAY', y: 'WINGBACK_3' },
  R13: { x: 'DIRECT', y: 'HIGH_PRESS' },
  TEMPO: { x: 'BALANCED', y: 'BALANCED', xInstr: { tempo: 2 } },
  LINE_FIT: { x: 'COUNTER', y: 'HIGH_LINE' },
};

/** 20팀 리그의 스타일 분포 (봇 분포 8종 + 균형) */
const LEAGUE_STYLES: StyleId[] = [
  'BALANCED',
  'BALANCED',
  'BALANCED',
  'POSSESSION',
  'POSSESSION',
  'COUNTER',
  'COUNTER',
  'COUNTER',
  'HIGH_PRESS',
  'HIGH_PRESS',
  'LOW_BLOCK',
  'LOW_BLOCK',
  'DIRECT',
  'DIRECT',
  'WING_PLAY',
  'WING_PLAY',
  'HIGH_LINE',
  'WINGBACK_3',
  'WINGBACK_3',
  'HIGH_LINE',
];

function normal(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

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
  const has = (s: ScenarioId) => scenarios.includes(s);

  if (has('BASELINE')) {
    const t = tally();
    for (let i = 0; i < n; i++) {
      const { r, xIsHome } = play(R, 'BASELINE', i, { ovr: BASE_OVR, pkg: B }, { ovr: BASE_OVR, pkg: B }, { neutralVenue: true });
      addResult(t, r, xIsHome);
      progress('BASELINE', i + 1, n);
    }
    const goals = t.goals / t.n;
    const shots = t.shots / t.n / 2;
    details.baseline = { n: t.n, goals, draws: pct(t.d, t.n), shotsPerTeam: shots, w: pct(t.w, t.n), d: pct(t.d, t.n), l: pct(t.l, t.n) };
    targets.push(target('BASELINE', 'goals', '평균 총 득점 (균형 미러)', goals, 'goals', TARGETS.baselineGoals[0], TARGETS.baselineGoals[1]));
    targets.push(target('BASELINE', 'draws', '무승부 비율', pct(t.d, t.n), '%', TARGETS.draws[0], TARGETS.draws[1]));
    targets.push(target('BASELINE', 'shots', '팀당 슈팅', shots, 'shots', TARGETS.shots[0], TARGETS.shots[1]));
    targets.push(target('BASELINE', 'win', '동일 전력 승률 (37±3)', pct(t.w, t.n), '%', TARGETS.winLoss[0], TARGETS.winLoss[1]));
    targets.push(target('BASELINE', 'loss', '동일 전력 패배율 (37±3)', pct(t.l, t.n), '%', TARGETS.winLoss[0], TARGETS.winLoss[1]));
  }

  if (has('REAL_HOME')) {
    let hw = 0;
    let dr = 0;
    let aw = 0;
    let gd = 0;
    for (let i = 0; i < n; i++) {
      const { r } = play(R, 'REAL_HOME', i, { ovr: BASE_OVR, pkg: B }, { ovr: BASE_OVR, pkg: B });
      if (r.home.goals > r.away.goals) hw += 1;
      else if (r.home.goals === r.away.goals) dr += 1;
      else aw += 1;
      gd += r.home.goals - r.away.goals;
      progress('REAL_HOME', i + 1, n);
    }
    details.realHome = { n, homeWin: pct(hw, n), draw: pct(dr, n), awayWin: pct(aw, n), goalDiff: gd / n };
    const H = TARGETS.home;
    targets.push(target('REAL_HOME', 'homeWin', '홈 승률', pct(hw, n), '%', H.win[0], H.win[1]));
    targets.push(target('REAL_HOME', 'draw', '무승부', pct(dr, n), '%', H.draw[0], H.draw[1]));
    targets.push(target('REAL_HOME', 'awayWin', '원정 승률', pct(aw, n), '%', H.away[0], H.away[1]));
    targets.push(target('REAL_HOME', 'goalDiff', '홈 − 원정 득점', gd / n, 'goals', H.goalDiff[0], H.goalDiff[1]));
  }

  if (has('LEAGUE_REALISM')) {
    const seasons = Math.max(2, Math.round((n * 30) / 2000));
    const acc = new RealismAcc();
    const total = seasons * 380;
    let done = 0;
    for (let season = 0; season < seasons; season++) {
      const rng = mulberry32(hashString(`${opts.seed}|league|${season}`));
      const teams = LEAGUE_STYLES.map((style, k) => ({
        id: `L${k}`,
        style,
        ovr: Math.round(Math.max(40, Math.min(80, BASE_OVR + 6 * normal(rng)))),
        idx: season * 20 + k,
      }));
      for (let hI = 0; hI < 20; hI++) {
        for (let aI = 0; aI < 20; aI++) {
          if (hI === aI) continue;
          const h = teams[hI]!;
          const a = teams[aI]!;
          const home = R.factory.botInput(h.ovr, h.idx, h.id, h.style, true);
          const away = R.factory.botInput(a.ovr, a.idx, a.id, a.style, false);
          const r = simulateMatch({ matchId: `LR-${season}-${hI}-${aI}`, seed: hashString(`${opts.seed}|LR|${season}|${hI}|${aI}`), home, away, config: config(R.cap) });
          acc.add(r);
          done += 1;
          progress('LEAGUE_REALISM', done, total);
        }
      }
    }
    const s = acc.summary();
    details.realism = s;
    const T = (id: string, label: string, v: number, unit: CalibrationTarget['unit'], lo?: number, hi?: number) => targets.push(target('LEAGUE_REALISM', id, label, v, unit, lo, hi));
    T('goals', '경기당 총 득점', s.goals, 'goals', 2.6, 3.0);
    T('homeWin', '홈 승', s.homeWin, '%', 42, 47);
    T('draw', '무승부', s.draw, '%', 22, 28);
    T('awayWin', '원정 승', s.awayWin, '%', 27, 33);
    T('homeMinusAway', '홈 − 원정 득점', s.homeMinusAway, 'goals', 0.2, 0.4);
    T('shots', '팀당 슈팅', s.shotsPerTeam, 'shots', 11.5, 14);
    T('sot', '팀당 유효슈팅', s.sotPerTeam, 'shots', 3.8, 4.8);
    T('sotRatio', '유효슈팅 비율', s.sotRatio, '%', 31, 37);
    T('goalsPerShot', '슈팅당 득점', s.goalsPerShot, '%', 9.5, 12);
    T('xg', '팀당 xG', s.xgPerTeam, 'xG', 1.25, 1.55);
    T('possSd', '경기별 점유율 표준편차', s.possSd, '%p', 8, 13);
    T('poss65', '한쪽 점유 ≥ 65% 경기', s.poss65, '%', 10, 25);
    T('firstHalf', '전반 득점 비중', s.firstHalf, '%', 42, 47);
    T('late', '76-90+ 득점 비중', s.late, '%', 19, 25);
    T('early', '0-15 득점 비중', s.early, '%', 10, 15);
    T('setPiece', '세트피스 득점 비중 (PK 포함)', s.setPiece, '%', 24, 34);
    T('pkShare', 'PK 득점 비중', s.pkShare, '%', 7, 12);
    T('pkPerMatch', '경기당 PK', s.pkPerMatch, 'count', 0.22, 0.34);
    T('pkConv', 'PK 성공률', s.pkConv, '%', 73, 80);
    T('corners', '팀당 코너', s.cornersPerTeam, 'count', 4.3, 5.8);
    T('offsides', '팀당 오프사이드', s.offsidesPerTeam, 'count', 1.2, 2.4);
    T('yellows', '경기당 경고', s.yellows, 'count', 3.5, 5.0);
    T('reds', '경기당 퇴장', s.reds, 'count', 0.08, 0.18);
    T('s11', '스코어 1-1', s.s11, '%', 9, 13);
    T('s10', '스코어 1-0', s.s10, '%', 13, 19);
    T('s21', '스코어 2-1', s.s21, '%', 12, 17);
    T('s00', '스코어 0-0', s.s00, '%', 5, 9);
    T('s22', '스코어 2-2', s.s22, '%', 3, 7);
    T('firstGoalWin', '선제골 팀 승', s.firstGoalWin, '%', 62, 72);
    T('firstGoalLoss', '선제골 팀 역전패', s.firstGoalLoss, '%', 8, 15);
    T('htLeadWin', '전반 리드 팀 승', s.htLeadWin, '%', 68, 80);
    T('htLeadLoss', '전반 리드 팀 역전패', s.htLeadLoss, '%', 5, 11);
    // 스타일별 점유 (vs 균형, 중립)
    const sp: Partial<Record<StyleId, number>> = {};
    const m = Math.max(40, Math.round(n / 4));
    for (const st of ['POSSESSION', 'DIRECT', 'LOW_BLOCK'] as StyleId[]) {
      let sum = 0;
      for (let i = 0; i < m; i++) {
        const { r, xIsHome } = play(R, `SP-${st}`, i, { ovr: BASE_OVR, pkg: PACKAGES[st] }, { ovr: BASE_OVR, pkg: B }, { neutralVenue: true });
        const me = xIsHome ? r.home : r.away;
        sum += me.possessionTime ?? me.possession;
      }
      sp[st] = (100 * sum) / m;
    }
    details.stylePossession = sp;
    T('possPOS', '포지셔널 vs 균형 점유율', sp.POSSESSION!, '%', 58, 68);
    T('possDIR', '다이렉트 vs 균형 점유율', sp.DIRECT!, '%', 34, 44);
    T('possLB', '로우 블록 vs 균형 점유율', sp.LOW_BLOCK!, '%', 34, 44);
  }

  // ── 9×9 스타일 행렬 (COUNTER_SPREAD·STYLE_MATRIX·OVR_DIFF_10_COUNTER 공용) ──
  let bestVsBalanced: StyleId | null = null;
  if (has('COUNTER_SPREAD') || has('STYLE_MATRIX') || has('OVR_DIFF_10_COUNTER')) {
    const full = has('COUNTER_SPREAD') || has('STYLE_MATRIX');
    const perCell = full ? Math.max(40, Math.round(n / 2)) : Math.max(40, Math.round(n / 5));
    const S = SPREAD_PACKAGES;
    const opponents: StyleId[] = full ? S : ['BALANCED'];
    // 셀 (us, them): 교차검증 절반 A/B + 전체. 쌍마다 한 번 시뮬레이션해 양쪽 관점을 모두 채운다
    const cellA = new Map<string, Tally>();
    const cellB = new Map<string, Tally>();
    const cellAll = new Map<string, Tally>();
    const cellPoss = new Map<string, number>();
    const get = (m: Map<string, Tally>, k: string) => {
      let t = m.get(k);
      if (!t) {
        t = tally();
        m.set(k, t);
      }
      return t;
    };
    const pairs: [StyleId, StyleId][] = [];
    for (const s of opponents) for (const p of S) if (!pairs.some(([a, b]) => (a === p && b === s) || (a === s && b === p))) pairs.push([p, s]);
    const total = pairs.length * perCell;
    let done = 0;
    for (const [p, s] of pairs) {
      for (let i = 0; i < perCell; i++) {
        const { r, xIsHome } = matrixPlay(R, p, s, i);
        const half = Math.floor(i / 2) % 2 === 0 ? cellA : cellB;
        const me = xIsHome ? r.home : r.away;
        const kp = `${p}|${s}`;
        const ks = `${s}|${p}`;
        addResult(get(half, kp), r, xIsHome);
        addResult(get(cellAll, kp), r, xIsHome);
        cellPoss.set(kp, (cellPoss.get(kp) ?? 0) + (me.possessionTime ?? me.possession));
        if (p !== s) {
          addResult(get(half, ks), r, !xIsHome);
          addResult(get(cellAll, ks), r, !xIsHome);
          cellPoss.set(ks, (cellPoss.get(ks) ?? 0) + (1 - (me.possessionTime ?? me.possession)));
        }
        done += 1;
        progress('STYLE_MATRIX', done, total);
      }
    }
    const cells: CounterCell[] = [];
    for (const [k, t] of cellAll) {
      const [us, them] = k.split('|') as [StyleId, StyleId];
      cells.push({ us, them, n: t.n, winPct: pct(t.w, t.n), drawPct: pct(t.d, t.n), lossPct: pct(t.l, t.n), possession: (100 * (cellPoss.get(k) ?? 0)) / Math.max(1, t.n) });
    }
    details.counterMatrix = cells;
    const best: NonNullable<CalibrationDetails['counterBest']> = {};
    let spreadSum = 0;
    let favSum = 0;
    for (const s of opponents) {
      const ranked = [...S].sort((p, q) => wl(get(cellA, `${q}|${s}`)) - wl(get(cellA, `${p}|${s}`)));
      const bp = ranked[0]!;
      const wp = ranked[ranked.length - 1]!;
      const bt = get(cellB, `${bp}|${s}`);
      const wt = get(cellB, `${wp}|${s}`);
      const spread = pct(bt.w, bt.n) - pct(wt.w, wt.n);
      const fav = bt.w + bt.l > 0 ? (100 * bt.w) / (bt.w + bt.l) : 50;
      best[s] = { best: bp, worst: wp, spread, favNonDraw: fav };
      spreadSum += spread;
      favSum += fav;
      if (s === 'BALANCED') bestVsBalanced = bp;
    }
    details.counterBest = best;
    const raw = opponents.map((s) => {
      const col = cells.filter((c) => c.them === s).map((c) => c.winPct);
      return Math.max(...col) - Math.min(...col);
    });
    details.counterRawSpread = raw.reduce((a, b) => a + b, 0) / raw.length;
    details.counterCvSpread = spreadSum / opponents.length;
    if (has('COUNTER_SPREAD') || has('STYLE_MATRIX')) {
      targets.push(target('STYLE_MATRIX', 'spread', '① 최선 카운터 − 최악 매치업 승률 차 (교차검증, 9 스타일)', spreadSum / opponents.length, '%p', TARGETS.counterSpread[0], TARGETS.counterSpread[1]));
      targets.push(target('STYLE_MATRIX', 'favNonDraw', '② 유리 상성 측 무승부 제외 승률', favSum / opponents.length, '%', TARGETS.favNonDraw[0], TARGETS.favNonDraw[1]));
    }
    if (full) {
      // ③④⑤
      let matched = 0;
      let totalCells = 0;
      const styleAvg: Record<string, number> = {};
      const plus: Record<string, number> = {};
      const minus: Record<string, number> = {};
      for (const a of S) {
        let sum = 0;
        plus[a] = 0;
        minus[a] = 0;
        for (const b of S) {
          if (a === b) continue;
          const v = wl(get(cellAll, `${a}|${b}`));
          sum += v;
          if (v >= 6) plus[a]! += 1;
          if (v <= -6) minus[a]! += 1;
          const e = STYLE_MATRIX_EXPECTED[a][b];
          totalCells += 1;
          if ((e === 0 && Math.abs(v) <= 5) || (e > 0 && v > 0) || (e < 0 && v < 0)) matched += 1;
        }
        styleAvg[a] = sum / (S.length - 1);
      }
      const rate = pct(matched, totalCells);
      details.matrixSign = { matched, total: totalCells, rate, styleAvg, plus, minus };
      const maxAvg = Math.max(...Object.values(styleAvg));
      const minPlus = Math.min(...Object.values(plus));
      const minMinus = Math.min(...Object.values(minus));
      targets.push(target('STYLE_MATRIX', 'dominance', '③ 스타일별 전체 상대 평균 (승 − 패) 최댓값', maxAvg, '%p', undefined, TARGETS.styleDominance));
      targets.push(target('STYLE_MATRIX', 'plus2', '④ 모든 스타일이 (승 − 패) ≥ +6%p 인 상대 수 (최소)', minPlus, 'count', TARGETS.stylePlusMinus));
      targets.push(target('STYLE_MATRIX', 'minus2', '④ 모든 스타일이 (승 − 패) ≤ −6%p 인 상대 수 (최소)', minMinus, 'count', TARGETS.stylePlusMinus));
      targets.push(target('STYLE_MATRIX', 'signRate', '⑤ 설계 2.5 행렬 부호 일치율', rate, '%', TARGETS.matrixSign));
    }
  }

  if (has('FORMATION_PARITY')) {
    const perCell = Math.max(40, Math.round(n / 2));
    const F = FORMATION_IDS;
    const pts: Record<string, { p: number; n: number }> = {};
    for (const f of F) pts[f] = { p: 0, n: 0 };
    let f442v433 = 0;
    const total = ((F.length * (F.length - 1)) / 2) * perCell;
    let done = 0;
    for (let a = 0; a < F.length; a++) {
      for (let b = a + 1; b < F.length; b++) {
        const fa = F[a]!;
        const fb = F[b]!;
        const t = tally();
        for (let i = 0; i < perCell; i++) {
          const { r, xIsHome } = play(R, `FP-${fa}-${fb}`, i, { ovr: BASE_OVR, pkg: formationPkg(fa) }, { ovr: BASE_OVR, pkg: formationPkg(fb) }, { neutralVenue: true });
          addResult(t, r, xIsHome);
          done += 1;
          progress('FORMATION_PARITY', done, total);
        }
        pts[fa]!.p += 3 * t.w + t.d;
        pts[fa]!.n += t.n;
        pts[fb]!.p += 3 * t.l + t.d;
        pts[fb]!.n += t.n;
        if ((fa === '4-4-2' && fb === '4-3-3') || (fa === '4-3-3' && fb === '4-4-2')) f442v433 = Math.abs(wl(t));
      }
    }
    const ppg = Object.fromEntries(F.map((f) => [f, pts[f]!.p / Math.max(1, pts[f]!.n)]));
    details.formationParity = { ppg, f442v433, n: perCell };
    targets.push(target('FORMATION_PARITY', 'ppgMin', '포메이션 경기당 승점 최저', Math.min(...Object.values(ppg)), 'ppg', TARGETS.formationPpg[0]));
    targets.push(target('FORMATION_PARITY', 'ppgMax', '포메이션 경기당 승점 최고', Math.max(...Object.values(ppg)), 'ppg', undefined, TARGETS.formationPpg[1]));
    targets.push(target('FORMATION_PARITY', 'f442v433', '4-4-2 vs 4-3-3 |승 − 패|', f442v433, '%p', undefined, TARGETS.f442v433));
  }

  if (has('STYLE_FIT')) {
    // 게겐프레싱(요구: PRS 65) vs 균형: 적합 스쿼드와 부적합 스쿼드(압박 능력 −3, 나머지 +로 합 보존)의 상성 이득 차
    const m = Math.max(40, Math.round(n / 2));
    const fitMod = STYLE_FIT_MODS.HIGH_PRESS!;
    const unfit: AttrMod = { key: 'unfit-GP', up: fitMod.down, down: fitMod.up, delta: fitMod.delta };
    const gain = (mod?: AttrMod) => {
      const s = tally();
      const b = tally();
      for (let i = 0; i < m; i++) {
        addResult(s, play(R, 'SF-S', i, { ovr: BASE_OVR, pkg: PACKAGES.HIGH_PRESS, ...(mod ? { mod } : {}) }, { ovr: BASE_OVR, pkg: B }, { neutralVenue: true }).r, i % 2 === 0);
        addResult(b, play(R, 'SF-B', i, { ovr: BASE_OVR, pkg: B, ...(mod ? { mod } : {}) }, { ovr: BASE_OVR, pkg: B }, { neutralVenue: true }).r, i % 2 === 0);
        progress('STYLE_FIT', i + 1, m);
      }
      return wl(s) - wl(b);
    };
    const gainFit = gain(fitMod);
    const gainUnfit = gain(unfit);
    // R2 매치업: 러너 속도 17 vs CB 11 과 러너 12 vs CB 14
    const setPace = (runnerPace: number | null, cbPace: number | null) => (t: EngineTeamInput): EngineTeamInput => ({
      ...t,
      starters: t.starters.map((p, i) => {
        const role = t.slots[t.startSlot].roles[i]!;
        const f = runnerPace !== null && ROLE_SHAPE[role].run === 1 ? runnerPace : cbPace !== null && role.startsWith('CB_') ? cbPace : null;
        return f === null ? p : { ...p, attrs: { ...p.attrs, pace: f } };
      }),
    });
    const r2 = (rp: number, cp: number) => {
      let s = 0;
      for (let i = 0; i < m; i++) {
        const { r, xIsHome } = play(
          R,
          `SF-R2-${rp}-${cp}`,
          i,
          { ovr: BASE_OVR, pkg: PACKAGES.COUNTER, tweak: setPace(rp, null) },
          { ovr: BASE_OVR, pkg: PACKAGES.HIGH_LINE, tweak: setPace(null, cp) },
          { onlyRules: ['R2'], neutralVenue: true },
        );
        const ex = explainMatch(r, VALUE_TABLE);
        s += (xIsHome ? ex.home : ex.away).rules.find((c) => c.ruleId === 'R2')?.xg ?? 0;
      }
      return s / m;
    };
    const r2Fast = r2(17, 11);
    const r2Slow = r2(12, 14);
    const ratio = r2Fast / Math.max(1e-6, Math.abs(r2Slow));
    details.styleFit = { gainFit, gainUnfit, diff: gainFit - gainUnfit, r2Fast, r2Slow, ratio };
    targets.push(target('STYLE_FIT', 'gainDiff', '게겐프레싱 적합 − 부적합 스쿼드 상성 이득 (승 − 패)', gainFit - gainUnfit, '%p', TARGETS.styleFitGain[0], TARGETS.styleFitGain[1]));
    targets.push(target('STYLE_FIT', 'r2Ratio', 'R2 기여: 러너 17 vs CB 11 ÷ 러너 12 vs CB 14', ratio, 'x', TARGETS.r2PaceRatio));
  }

  if (has('ROLE_SIGNATURE')) {
    const m = Math.max(40, n);
    const base433 = formationPkg('4-3-3');
    const swapPkg = (slot: number, role: RoleId): TacticPackage => ({ ...base433, id: `SIG-${slot}-${role}`, roles: base433.roles.map((r, i) => (i === slot ? role : r)) });
    type Agg = { sum: TeamMetrics; n: number };
    const zero = (): TeamMetrics => ({
      choices: { CROSS: 0, THROUGH: 0, CUTBACK: 0, LONG: 0, SOLO: 0, total: 0 },
      dp1: 0,
      dp1s: 0,
      oppDp1: 0,
      oppDp1s: 0,
      oppDp2: 0,
      oppDp2s: 0,
      oppThrough: 0,
      oppThroughS: 0,
      dp6s: 0,
      oppR2: 0,
      trapOffsides: 0,
      shots: 0,
      headerShots: 0,
      oppCounterXg: 0,
      oppCornerGoals: 0,
      slot8Shots: 0,
      possession: 0,
      yellows: 0,
      r11: 0,
      oppR4: 0,
    });
    const cache = new Map<string, Agg>();
    const runSig = (pkg: TacticPackage, opp: StyleId, instr: Partial<TeamInstructions> | undefined, tag: string): Agg => {
      const key = `${pkg.id}|${opp}|${JSON.stringify(instr ?? {})}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const agg: Agg = { sum: zero(), n: 0 };
      for (let i = 0; i < m; i++) {
        const x: Side = { ovr: BASE_OVR, pkg, ...(instr ? { instr: { ...pkg.instructions, ...instr } } : {}) };
        const { r, xIsHome, X } = play(R, `RS-${tag}`, i, x, { ovr: BASE_OVR, pkg: PACKAGES[opp] }, { neutralVenue: true });
        const tm = teamMetrics(r, xIsHome, X);
        const s = agg.sum;
        for (const k of Object.keys(tm) as (keyof TeamMetrics)[]) {
          if (k === 'choices') {
            for (const c of Object.keys(tm.choices) as (keyof TeamMetrics['choices'])[]) s.choices[c] += tm.choices[c];
          } else (s[k] as number) += tm[k] as number;
        }
        agg.n += 1;
      }
      cache.set(key, agg);
      return agg;
    };
    const rows: RoleSignatureRow[] = [];
    type Metric = { name: string; f: (a: Agg) => number; min: number; rel: boolean; maxAbs?: boolean };
    const rate = (num: (s: TeamMetrics) => number, den: (s: TeamMetrics) => number) => (a: Agg) => (100 * num(a.sum)) / Math.max(1, den(a.sum));
    const per = (f: (s: TeamMetrics) => number) => (a: Agg) => f(a.sum) / Math.max(1, a.n);
    const sigs: { swap: string; slot: number; role: RoleId; opp: StyleId; instr?: Partial<TeamInstructions>; metrics: Metric[] }[] = [
      {
        swap: 'ST 포처 → 타깃맨',
        slot: 9,
        role: 'ST_TARGET',
        opp: 'BALANCED',
        metrics: [
          { name: '헤더 슈팅 비중 %p', f: rate((s) => s.headerShots, (s) => s.shots), min: 5, rel: false },
          { name: '스루 찬스 비중 %p', f: rate((s) => s.choices.THROUGH, (s) => s.choices.total), min: -3, rel: false },
        ],
      },
      {
        swap: 'ST 포처 → 폴스9',
        slot: 9,
        role: 'ST_FALSE_NINE',
        opp: 'HIGH_LINE',
        metrics: [
          { name: '점유율 %p', f: per((s) => 100 * s.possession), min: 1.5, rel: false },
          { name: '트랩 오프사이드 %', f: per((s) => s.trapOffsides), min: -25, rel: true },
        ],
      },
      {
        swap: 'ST 포처 → 프레싱 포워드 (압박 +1)',
        slot: 9,
        role: 'ST_PRESSING_FORWARD',
        opp: 'BALANCED',
        instr: { press: 1 },
        metrics: [
          { name: '상대 빌드업(DP1) 성공률 %p', f: rate((s) => s.oppDp1s, (s) => s.oppDp1), min: -1.5, rel: false },
          { name: '우리 역습(DP6 성공) %', f: per((s) => s.dp6s), min: 5, rel: true },
        ],
      },
      {
        swap: 'FB 수비형 → 공격형',
        slot: 1,
        role: 'FB_OVERLAPPING',
        opp: 'COUNTER',
        metrics: [
          { name: '크로스 찬스 %', f: per((s) => s.choices.CROSS), min: 8, rel: true },
          { name: '상대 역습 xG %', f: per((s) => s.oppCounterXg), min: 5, rel: true },
        ],
      },
      {
        swap: 'FB 수비형 → 인버티드',
        slot: 1,
        role: 'FB_INVERTED',
        opp: 'COUNTER',
        metrics: [
          { name: '점유율 %p', f: per((s) => 100 * s.possession), min: 1.5, rel: false },
          { name: '크로스 찬스 %', f: per((s) => s.choices.CROSS), min: -8, rel: true },
          { name: '상대 역습 xG % (≤ +2)', f: per((s) => s.oppCounterXg), min: 2, rel: true, maxAbs: true },
        ],
      },
      {
        swap: 'DM 앵커 → 레지스타 (상대 게겐프레싱)',
        slot: 5,
        role: 'DM_REGISTA',
        opp: 'HIGH_PRESS',
        metrics: [
          { name: 'DP1 성공률 %p', f: rate((s) => s.dp1s, (s) => s.dp1), min: 1, rel: false },
          { name: '상대 DP2 성공률 %p', f: rate((s) => s.oppDp2s, (s) => s.oppDp2), min: 1, rel: false },
        ],
      },
      {
        swap: 'DM 앵커 → 볼 위닝',
        slot: 5,
        role: 'DM_BALL_WINNER',
        opp: 'BALANCED',
        metrics: [
          { name: '경고 %', f: per((s) => s.yellows), min: 25, rel: true },
          { name: '상대 DP2 성공률 %p', f: rate((s) => s.oppDp2s, (s) => s.oppDp2), min: -0.5, rel: false },
        ],
      },
      {
        swap: 'CM 박스투박스 → 메짤라',
        slot: 6,
        role: 'CM_MEZZALA',
        opp: 'BALANCED',
        metrics: [
          { name: '컷백+스루 찬스 %', f: per((s) => s.choices.CUTBACK + s.choices.THROUGH), min: 5, rel: true },
          { name: 'R11 발동 (경기당)', f: per((s) => s.r11), min: 0.001, rel: false },
        ],
      },
      {
        swap: 'W 윙어 → 인사이드 포워드',
        slot: 8,
        role: 'W_INSIDE_FORWARD',
        opp: 'BALANCED',
        metrics: [
          { name: '컷백 찬스 %', f: per((s) => s.choices.CUTBACK), min: 8, rel: true },
          { name: '크로스 찬스 %', f: per((s) => s.choices.CROSS), min: -8, rel: true },
          { name: '해당 윙 슈팅 %', f: per((s) => s.slot8Shots), min: 20, rel: true },
        ],
      },
      {
        swap: 'W 윙어 → 와이드 MF (상대 윙 플레이)',
        slot: 8,
        role: 'W_WIDE_MIDFIELDER',
        opp: 'WING_PLAY',
        metrics: [
          { name: '상대 R4 발동 %', f: per((s) => s.oppR4), min: -30, rel: true },
          { name: '크로스 찬스 %', f: per((s) => s.choices.CROSS), min: -5, rel: true },
        ],
      },
      {
        swap: 'CB 스토퍼 → 커버 (라인 +1, 상대 역습)',
        slot: 2,
        role: 'CB_COVER',
        opp: 'COUNTER',
        instr: { line: 1 },
        metrics: [
          { name: '상대 스루 성공률 %p', f: rate((s) => s.oppThroughS, (s) => s.oppThrough), min: -1, rel: false },
          { name: '상대 코너 득점 %', f: per((s) => s.oppCornerGoals), min: 5, rel: true },
        ],
      },
      {
        swap: 'GK 전통 → 스위퍼 (라인 +1, 상대 역습)',
        slot: 0,
        role: 'GK_SWEEPER',
        opp: 'COUNTER',
        instr: { line: 1 },
        metrics: [
          { name: '상대 R2 원기여 %', f: per((s) => s.oppR2), min: -40, rel: true },
          { name: '상대 코너 득점 %', f: per((s) => s.oppCornerGoals), min: 3, rel: true },
        ],
      },
    ];
    let done = 0;
    const total = sigs.length * 2;
    for (const sg of sigs) {
      const b = runSig(base433, sg.opp, sg.instr, `base-${sg.opp}-${JSON.stringify(sg.instr ?? {})}`);
      const v = runSig(swapPkg(sg.slot, sg.role), sg.opp, sg.instr, `${sg.slot}-${sg.role}`);
      for (const mt of sg.metrics) {
        const bv = mt.f(b);
        const vv = mt.f(v);
        const change = mt.rel ? (100 * (vv - bv)) / Math.max(1e-9, Math.abs(bv)) : vv - bv;
        let dirOk: boolean;
        let sizeOk: boolean;
        if (mt.maxAbs) {
          dirOk = change <= mt.min;
          sizeOk = dirOk;
        } else if (mt.min >= 0) {
          dirOk = change > 0;
          sizeOk = change >= mt.min;
        } else {
          dirOk = change < 0;
          sizeOk = change <= mt.min;
        }
        rows.push({ swap: sg.swap, metric: mt.name, base: bv, value: vv, change, min: mt.min, dirOk, sizeOk });
      }
      done += 2;
      progress('ROLE_SIGNATURE', done, total);
    }
    details.roleSignature = rows;
    targets.push(target('ROLE_SIGNATURE', 'direction', '역할 서명 지표 방향 일치율', pct(rows.filter((r) => r.dirOk).length, rows.length), '%', TARGETS.roleSignatureDirection));
    targets.push(target('ROLE_SIGNATURE', 'size', '역할 서명 지표 크기 기준 충족률 (참고, 판정 없음)', pct(rows.filter((r) => r.sizeOk).length, rows.length), '%'));
  }

  if (has('STAMINA_CURVE')) {
    let gp1 = 0;
    let gp2 = 0;
    let b1 = 0;
    let b2 = 0;
    let gpCond = 0;
    let gpN = 0;
    let bCond = 0;
    let bN = 0;
    for (let i = 0; i < n; i++) {
      const { r, xIsHome } = play(R, 'STAMINA', i, { ovr: BASE_OVR, pkg: PACKAGES.HIGH_PRESS }, { ovr: BASE_OVR, pkg: B }, { neutralVenue: true });
      const gpId = xIsHome ? r.home.clubId : r.away.clubId;
      for (const e of r.events) {
        if (e.type !== 'SHOT') continue;
        const second = e.minute > 45;
        if (e.clubId === gpId) second ? (gp2 += e.xg) : (gp1 += e.xg);
        else second ? (b2 += e.xg) : (b1 += e.xg);
      }
      for (const l of r.players) {
        if (!l.started) continue;
        if (l.clubId === gpId) {
          gpCond += l.conditionAfter;
          gpN += 1;
        } else {
          bCond += l.conditionAfter;
          bN += 1;
        }
      }
      progress('STAMINA_CURVE', i + 1, n);
    }
    const gpShare2 = pct(gp2, gp1 + gp2);
    const balShare2 = pct(b2, b1 + b2);
    const gc = gpCond / Math.max(1, gpN);
    const bc = bCond / Math.max(1, bN);
    details.stamina = { gpShare2, balShare2, diff: balShare2 - gpShare2, gpCond: gc, balCond: bc, condDiff: bc - gc };
    targets.push(target('STAMINA_CURVE', 'share', '균형 − 게겐프레싱 후반 xG 비중', balShare2 - gpShare2, '%p', TARGETS.staminaShare[0], TARGETS.staminaShare[1]));
    targets.push(target('STAMINA_CURVE', 'cond', '균형 − 게겐프레싱 경기 후 컨디션 (선발)', bc - gc, 'count', TARGETS.staminaCond[0], TARGETS.staminaCond[1]));
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

  if (has('OVR_DIFF_10')) {
    details.ovr10 = strongVsWeak('OVR_DIFF_10', 65, 55, B);
    targets.push(target('OVR_DIFF_10', 'strongWin', '전력 10점 차 강팀 승률', details.ovr10.strongWin, '%', TARGETS.ovr10[0], TARGETS.ovr10[1]));
  }
  if (has('OVR_DIFF_10_COUNTER')) {
    const pkg = bestVsBalanced ?? 'COUNTER';
    const res = strongVsWeak('OVR_DIFF_10_COUNTER', 65, 55, PACKAGES[pkg]);
    details.ovr10Counter = { ...res, weakPackage: pkg };
    targets.push(target('OVR_DIFF_10_COUNTER', 'strongWin', `전력 10점 차 + 약팀 최선 카운터(${PACKAGES[pkg].label}) 강팀 승률`, res.strongWin, '%', TARGETS.ovr10Counter[0], TARGETS.ovr10Counter[1]));
    targets.push(target('OVR_DIFF_10_COUNTER', 'strongStillAhead', '약팀 최선 카운터에도 강팀 승 − 약팀 승', res.strongWin - res.weakWin, '%p', 0));
    const nt = strongVsWeak('OVR_DIFF_10_COUNTER', 65, 55, PACKAGES[pkg], { tacticsEnabled: false });
    details.noTactics = { strongWin: nt.strongWin, weakWin: nt.weakWin, n };
    if (details.counterCvSpread !== undefined) {
      const power = nt.strongWin - nt.weakWin;
      targets.push(target('OVR_DIFF_10_COUNTER', 'powerOverTactics', '전력 10점 차 우위 ÷ 전술 최선−최악 승률 차 (×100)', (100 * power) / Math.max(1e-9, details.counterCvSpread), '%', 100));
    }
  }
  if (has('OVR_DIFF_25')) {
    details.ovr25 = strongVsWeak('OVR_DIFF_25', 72.5, 47.5, B);
    targets.push(target('OVR_DIFF_25', 'strongWin', '전력 25점 차 강팀 승률', details.ovr25.strongWin, '%', 85));
  }
  if (has('TEMPO_VARIANCE')) {
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
  if (has('RULE_ISOLATION')) {
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
      targets.push(target('RULE_ISOLATION', `p95-${rule}`, `${rule} 단독 기여 P95`, p95(xs), 'xG', undefined, rule === 'R7' ? TARGETS.r7P95 : TARGETS.ruleP95));
    }
    const all: number[] = [];
    const combos: [StyleId, StyleId][] = [];
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
    // 1.3.0: 개발자 패널 9×9 행렬 (STYLE_MATRIX 실행 시)
    ...(has('STYLE_MATRIX') && details.counterMatrix
      ? { details: { counterMatrix: details.counterMatrix.map((c) => ({ us: c.us, them: c.them, winPct: Math.round(c.winPct * 100) / 100, lossPct: Math.round(c.lossPct * 100) / 100 })) } }
      : {}),
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
  const combos: [StyleId, StyleId][] = [];
  for (const a of SPREAD_PACKAGES) for (const b of SPREAD_PACKAGES) combos.push([a, b]);
  for (let i = 0; i < matches; i++) {
    const [a, b] = combos[i % combos.length]!;
    const { r } = play(R, 'VALUES', i, { ovr: BASE_OVR, pkg: PACKAGES[a] }, { ovr: BASE_OVR, pkg: PACKAGES[b] });
    const log = r.log;
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
