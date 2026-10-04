/**
 * 선수 수명주기 순수 함수 (M3.4, 설계서 docs/설계/선수_수명주기.md 15장).
 * 성장·노화·은퇴·FA 정리·유스·AI 선수단 관리. 게임 상태 연결은 day/advanceDay.ts(주간·Day 20)와 career/seasonTransition.ts(시즌 경계, M3.3).
 * 모든 함수는 입력을 바꾸지 않고 새 객체를 돌려준다. 무작위는 주입된 Rng 만.
 */
import type { AttrKey, ClubId, LifecycleEvent, Player, PlayerDev, PlayerId, PlayerMatchLine, Position, ScoutGrade, SeasonNo, Tier, TrainingFocus, YouthCandidate } from '../../types';
import { clamp, hashString, mulberry32, type Rng } from '../../engine';
import { OVR_WEIGHTS, TIER_REFERENCE_OVR, generatePlayer, scoutGrade } from './generator';

export type { PlayerDev } from '../../types';
/** 수명주기 필드(dev·retiring·faSince·academyClubId)는 2.1.1 에서 Player 에 들어갔다 */
export type LifePlayer = Player;

// ── 상수 [PH] (17장) ──

const ATTACK_KEYS = ['passing', 'dribbling', 'finishing', 'crossing', 'vision', 'kicking'] as const;
const DEFENSE_KEYS = ['tackling', 'positioning', 'workRate', 'reflexes', 'aerialCommand'] as const;
const PHYSICAL_KEYS = ['pace', 'stamina', 'physical'] as const;

export const LIFECYCLE = {
  growthK: { 16: 5, 17: 5, 18: 5, 19: 4.5, 20: 4, 21: 3.5, 22: 3, 23: 2.5, 24: 1.5, 25: 0.5, 26: 0.5, 27: 0.5 } as Record<number, number>,
  growthNoiseSd: 0.4,
  minuteMult: { floor: 0.6, ceil: 1.2, fullShare: 0.6 },
  weekMatches: [7, 7, 7, 5],
  decline: { 30: 1, 31: 1.5, 32: 2, 33: 2.5, 34: 3, 35: 3.5 } as Record<number, number>,
  declineMax: 4,
  declineNoiseSd: 0.7,
  declineAttrMult: { pace: 2, stamina: 2, physical: 2, vision: 0.5, positioning: 0.5, composure: 0.5 } as Partial<Record<AttrKey, number>>,
  retireHazard: { 33: 0.35, 34: 0.5, 35: 0.65, 36: 0.8, 37: 0.9 } as Record<number, number>,
  retireForceAge: 38,
  retireStarterMult: 0.5,
  retireAnnounceDay: 20,
  faRetireAge: 30,
  faMaxUnsignedSeasons: 2,
  youth: {
    minCands: 3, maxCands: 5, potOffset: -10, potSd: 8, gemP: 0.05, gemAdd: 18, potMin: 30, potMax: 92,
    gap16: [14, 24], gap17: [12, 22], ovrMin: 15, ovrMax: 90, maxPromote: 2, prospectOver: 4, protectAge: 20,
    contractSeasons: 3, deadlineDay: 7,
  },
  /** [나이 상한, 반폭]: 19세 이하 ±8, 20~23세 ±6, 24세 이상 ±4 */
  scoutHalfWidth: [[19, 8], [23, 6], [Infinity, 4]] as const,
  focus: {
    BALANCED: { growth: 1.0, group: [] },
    ATTACK: { growth: 1.0, group: ATTACK_KEYS },
    DEFENSE: { growth: 1.0, group: DEFENSE_KEYS },
    PHYSICAL: { growth: 1.0, group: PHYSICAL_KEYS },
    TACTICAL: { growth: 0.8, group: [], familiarityDaily: 3 },
    RECOVERY: { growth: 0.7, group: [], recoveryBonus: 4 },
  } as Record<TrainingFocus, { growth: number; group: readonly AttrKey[]; familiarityDaily?: number; recoveryBonus?: number }>,
  focusGroupMult: 3,
  yellowLimit: 5,
  /** 기준 스쿼드 22명 포지션 수 (11.4 우선순위 = 이 순서) */
  squadTemplate: { GK: 2, CB: 4, FB: 4, DM: 2, CM: 3, AM: 2, W: 2, ST: 3 } as Record<Position, number>,
  ai: {
    minSquad: 22, maxSquad: 25, minGk: 2, weakBelow: 14, weakMinAge: 21, bandHi: 1, sellOver: 4, sellMaxAge: 30,
    sellMaxPerSeason: 2, relegatedSellExtra: 2, bandLo: 2, bandLoPoolMax: 6, poolMaxAge: 31, poolBand: 6, poolFillHi: 2, regenOffset: -3, regenSd: 4,
    regenAge: [21, 29], regenClamp: [-10, 4], regenPotAge: 24, regenPotAdd: 4, contractSeasons: [1, 3], agedPenalty: 2,
  },
} as const;

// ── RNG ──

/** 대상 단위 시드 (2.1). tag: 'grow-w1'..'grow-w4' | 'age' | 'retire' | 'youth' | 'ai-squad' */
export function lifeRng(gameSeed: number, season: SeasonNo, tag: string, id: string): Rng {
  return mulberry32(hashString(`${gameSeed >>> 0}|life|${season}|${tag}|${id}`));
}

function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function randInt(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function weightedPick<T>(rng: Rng, xs: readonly T[], w: (x: T) => number): T {
  const ws = xs.map(w);
  let r = rng() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < xs.length; i++) {
    r -= ws[i]!;
    if (r < 0) return xs[i]!;
  }
  return xs[xs.length - 1]!;
}

// ── 계산 도우미 ──

export function growthK(age: number): number {
  return LIFECYCLE.growthK[age] ?? 0;
}

/** 새 나이 기준 시즌 하락량 (≤29 = 0, 36+ = 4) */
export function declineOf(age: number): number {
  return age < 30 ? 0 : (LIFECYCLE.decline[age] ?? LIFECYCLE.declineMax);
}

export function retireHazard(age: number, ovr: number, tierRef: number): number {
  if (age >= LIFECYCLE.retireForceAge) return 1;
  const h = LIFECYCLE.retireHazard[age] ?? 0;
  return ovr >= tierRef ? h * LIFECYCLE.retireStarterMult : h;
}

/** 출전 비중 → 성장 배수 0.6 ~ 1.2 (60% 이상 포화) */
export function minuteMult(share: number): number {
  const m = LIFECYCLE.minuteMult;
  return m.floor + (m.ceil - m.floor) * Math.min(1, Math.max(0, share) / m.fullShare);
}

/** 반올림 전 OVR (ovrAt 과 같은 가중합 × 5) */
export function rawOvr(p: Pick<Player, 'attrs' | 'primary'>): number {
  const w = OVR_WEIGHTS[p.primary];
  let s = 0;
  for (const k of Object.keys(w) as AttrKey[]) s += (w[k] ?? 0) * p.attrs[k];
  return s * 5;
}

export function scoutRangeOf(p: Pick<Player, 'potential' | 'age'>): [ScoutGrade, ScoutGrade] {
  const h = LIFECYCLE.scoutHalfWidth.find(([maxAge]) => p.age <= maxAge)![1];
  return [scoutGrade(p.potential - h), scoutGrade(p.potential + h)];
}

/** U3: 티어 기준 상대 등급. 절대 척도(T3 기준 60)를 티어 기준 OVR 만큼 옮긴다 — 그 티어 주전급 ≈ C, 유망주(ref+4) ≈ C~B */
export function tierScoutRange(p: Pick<Player, 'potential' | 'age'>, tier: Tier): [ScoutGrade, ScoutGrade] {
  return scoutRangeOf({ age: p.age, potential: p.potential + TIER_REFERENCE_OVR.T3 - TIER_REFERENCE_OVR[tier] });
}

function devOf(p: LifePlayer): PlayerDev {
  return p.dev ?? { bank: 0, minutesMark: p.season.minutes };
}

function attrDiff(a: Player['attrs'], b: Player['attrs']): Partial<Record<AttrKey, number>> {
  const d: Partial<Record<AttrKey, number>> = {};
  for (const k of Object.keys(a) as AttrKey[]) if (a[k] !== b[k]) d[k] = b[k] - a[k];
  return d;
}

/**
 * 저금통을 능력치 1단위씩 바꿔 쓴다 (3.4). 주 포지션 핵심 능력치만 바뀐다.
 * 양수: 성장(잠재력 상한, 모자라면 이월). 음수: 노화(넘친 양수 이월). ovr·scoutRange 재계산.
 */
export function spendBank(p: LifePlayer, rng: Rng, attrMult: Partial<Record<AttrKey, number>>): LifePlayer {
  const W = OVR_WEIGHTS[p.primary];
  const keys = Object.keys(W) as AttrKey[];
  const attrs = { ...p.attrs };
  let bank = devOf(p).bank;
  for (let guard = 0; guard < 60; guard++) {
    if (bank > 0) {
      const cand = keys.filter((k) => attrs[k] < 20);
      if (cand.length === 0) { bank = 0; break; }
      const k = weightedPick(rng, cand, (x) => W[x]! * (attrMult[x] ?? 1));
      const c = 5 * W[k]!;
      if (bank < c) break;
      // 반올림 뒤 ovr ≤ potential 보장 (raw < potential + 0.5)
      if (rawOvr({ attrs, primary: p.primary }) + c >= p.potential + 0.5 - 1e-9) { bank = 0; break; }
      attrs[k] += 1;
      bank -= c;
    } else if (bank < 0) {
      const cand = keys.filter((k) => attrs[k] > 1);
      if (cand.length === 0) { bank = 0; break; }
      const k = weightedPick(rng, cand, (x) => W[x]! * (LIFECYCLE.declineAttrMult[x] ?? 1));
      attrs[k] -= 1;
      bank += 5 * W[k]!;
    } else break;
  }
  const next = { ...p, attrs, dev: { ...devOf(p), bank } };
  const ovr = clamp(Math.round(rawOvr(next)), 1, 100);
  return { ...next, ovr, scoutRange: scoutRangeOf(next) };
}

/** 구단 훈련 포커스 (없으면 BALANCED) */
export function trainingFocusOf(club: { training?: { focus: TrainingFocus } }): TrainingFocus {
  return club.training?.focus ?? 'BALANCED';
}

// ── 시점별 진입점 ──

/**
 * 주간 성장 틱 (Day 8·15·22·28, 3.2). 이번 주 출전 = season.minutes − dev.minutesMark.
 * FA(clubId null)는 M = 0.6, F = 1. noiseSd 는 테스트용(잡음 0 주입).
 * share: 출전 비중을 직접 준다(경량 시뮬 리그는 출전 시간이 쌓이지 않아 스쿼드 순위로 대신한다, 13.2 모델).
 */
export function weeklyGrowth(
  p: LifePlayer,
  rng: Rng,
  ctx: { clubMatches: number; focus?: TrainingFocus; noiseSd?: number; share?: number },
): { player: LifePlayer; event?: LifecycleEvent } {
  if (p.isTemporary) return { player: p };
  const dev = devOf(p);
  const marked: LifePlayer = { ...p, dev: { ...dev, minutesMark: p.season.minutes } };
  const k = growthK(p.age);
  // 28세 이상은 저금통을 건드리지 않는다(노화 이월분 보존, G3)
  if (k === 0) return { player: marked };
  if (p.ovr >= p.potential) return { player: { ...marked, dev: { bank: 0, minutesMark: p.season.minutes } } };
  const isFa = p.clubId === null;
  const focus = isFa ? 'BALANCED' : (ctx.focus ?? 'BALANCED');
  const share = isFa ? 0 : (ctx.share ?? (ctx.clubMatches <= 0 ? 0 : (p.season.minutes - dev.minutesMark) / (90 * ctx.clubMatches)));
  const F = LIFECYCLE.focus[focus];
  const delta = Math.max(0, (k / 4) * minuteMult(share) * F.growth + gauss(rng) * (ctx.noiseSd ?? LIFECYCLE.growthNoiseSd));
  const mult: Partial<Record<AttrKey, number>> = {};
  for (const key of F.group) mult[key] = LIFECYCLE.focusGroupMult;
  const player = spendBank({ ...marked, dev: { bank: dev.bank + delta, minutesMark: p.season.minutes } }, rng, mult);
  const d = attrDiff(p.attrs, player.attrs);
  return Object.keys(d).length ? { player, event: { kind: 'GREW', playerId: p.id, attrs: d } } : { player };
}

/** 시즌 경계 ②: 나이 +1, 노화, minutesMark = 0, scoutRange 재계산 (4.1). 29세 이하는 능력치 불변 */
export function ageOneSeason(p: LifePlayer, rng: Rng, noiseSd: number = LIFECYCLE.declineNoiseSd): { player: LifePlayer; event?: LifecycleEvent } {
  if (p.isTemporary) return { player: p };
  const age = p.age + 1;
  const d = declineOf(age);
  let bank = devOf(p).bank;
  if (d > 0) bank -= Math.max(0, d + gauss(rng) * noiseSd);
  let player: LifePlayer = { ...p, age, dev: { bank, minutesMark: 0 } };
  player = bank < 0 ? spendBank(player, rng, {}) : { ...player, scoutRange: scoutRangeOf(player) };
  const diff = attrDiff(p.attrs, player.attrs);
  return Object.keys(diff).length ? { player, event: { kind: 'DECLINED', playerId: p.id, attrs: diff } } : { player };
}

/** Day 20 은퇴 판정 (6.1). true 면 호출자가 retiring = true 로 표시. 소속 선수만 */
export function rollRetirement(p: LifePlayer, rng: Rng, tierRef: number): boolean {
  if (p.isTemporary || p.clubId === null) return false;
  const h = retireHazard(p.age, p.ovr, tierRef);
  return h > 0 && rng() < h;
}

/**
 * 시즌 경계 ③ FA 풀 정리 (6.3). 나이 +1 뒤에 호출. faSince 없는 선수는 이번 시즌에 풀린 것으로 보고 채운다.
 */
export function cleanFreeAgents(pool: readonly LifePlayer[], endingSeason: SeasonNo): { keep: LifePlayer[]; events: Extract<LifecycleEvent, { kind: 'FA_RETIRED' }>[] } {
  const keep: LifePlayer[] = [];
  const events: Extract<LifecycleEvent, { kind: 'FA_RETIRED' }>[] = [];
  for (const p of pool) {
    const since = p.faSince ?? endingSeason;
    const out =
      (p.age >= LIFECYCLE.faRetireAge && since < endingSeason) || endingSeason - since >= LIFECYCLE.faMaxUnsignedSeasons;
    if (out) events.push({ kind: 'FA_RETIRED', playerId: p.id });
    else keep.push(p.faSince === undefined ? { ...p, faSince: since } : p);
  }
  return { keep, events };
}

const POSITIONS = Object.keys(LIFECYCLE.squadTemplate) as Position[];

/** 유스 후보 3~5명 (7.2). clubId 는 null(아직 미승격), academyClubId 로 출신 표시. ID y{season}-{clubId}-{n} */
export function generateYouthCandidates(rng: Rng, clubId: ClubId, tier: Tier, season: SeasonNo): YouthCandidate[] {
  const Y = LIFECYCLE.youth;
  const ref = TIER_REFERENCE_OVR[tier];
  const n = Y.minCands + Math.floor(rng() * (Y.maxCands - Y.minCands + 1));
  return Array.from({ length: n }, (_, i) => {
    const age = 16 + Math.floor(rng() * 2);
    let pot = ref + Y.potOffset + gauss(rng) * Y.potSd;
    if (rng() < Y.gemP) pot += Y.gemAdd;
    pot = clamp(pot, Y.potMin, Y.potMax);
    const [glo, ghi] = age === 16 ? Y.gap16 : Y.gap17;
    const ovr0 = clamp(pot - (glo + rng() * (ghi - glo)), Y.ovrMin, Y.ovrMax);
    const pos = weightedPick(rng, POSITIONS, (x) => LIFECYCLE.squadTemplate[x]);
    const base = generatePlayer(rng, pos, Math.round(ovr0), age);
    const potential = Math.max(Math.round(pot), base.ovr);
    return {
      ...base,
      id: `y${season}-${clubId}-${i + 1}`,
      clubId: null,
      potential,
      scoutRange: scoutRangeOf({ potential, age }),
      contract: { ...base.contract, seasonsLeft: Y.contractSeasons },
      dev: { bank: 0, minutesMark: 0 },
      academyClubId: clubId,
      tierRange: tierScoutRange({ potential, age }, tier),
    };
  });
}

/**
 * 유스 승격 대상 (7.4). fillToMin = true: AI 구단(22명 미만이면 채움). false: 사람 미결정 자동 처리(유망주 1명까지).
 */
export function pickYouthAi(cands: readonly Player[], squadSize: number, tierRef: number, fillToMin: boolean): PlayerId[] {
  const Y = LIFECYCLE.youth;
  const sorted = [...cands].sort((a, b) => b.potential - a.potential || (a.id < b.id ? -1 : 1));
  const out: PlayerId[] = [];
  let size = squadSize;
  for (const c of sorted) {
    if (out.length >= Y.maxPromote || size >= LIFECYCLE.ai.maxSquad) break;
    if ((fillToMin && size < LIFECYCLE.ai.minSquad) || (out.length === 0 && c.potential >= tierRef + Y.prospectOver)) {
      out.push(c.id);
      size++;
    }
  }
  return out;
}

/** 주전 전력: 임시 제외 OVR 상위 11명 평균 (2.3) */
export function squadStrength(players: readonly Player[]): number {
  const top = players.filter((p) => !p.isTemporary).map((p) => p.ovr).sort((a, b) => b - a).slice(0, 11);
  return top.length ? top.reduce((a, b) => a + b, 0) / top.length : 0;
}

export interface AiSquadInput {
  /** AI 구단만. tier 는 승강이 반영된 다음 시즌 티어 */
  clubs: { id: ClubId; tier: Tier; players: LifePlayer[]; /** 이번 경계에 강등 (M4.8: 대역 상한 판매 한도 + relegatedSellExtra) */ relegated?: boolean }[];
  pool: LifePlayer[];
  /** 다음(새) 시즌 번호. 방출 선수의 faSince = season − 1 (끝난 시즌) */
  season: SeasonNo;
  gameSeed: number;
}

export interface AiSquadResult {
  clubs: { id: ClubId; players: LifePlayer[] }[];
  pool: LifePlayer[];
  /** 세계에서 사라진 선수 (T1 해외 이적) */
  removed: PlayerId[];
  events: LifecycleEvent[];
}

const byOvrDesc = (a: Player, b: Player) => b.ovr - a.ovr || (a.id < b.id ? -1 : 1);

/**
 * 시즌 경계 ④ AI 구단 선수단 관리 (11장). 임시 계약 선수는 건드리지도 세지도 않는다.
 * 1차 순회(구단 ID 순): 약체 방출 → 대역 상한. 2차 순회(티어 높은 순, 같은 티어는 ID 순):
 * 대역 하한 → 유스 → 최소 인원 보충 → 최대 인원 정리.
 */
export function aiSquadMaintenance(input: AiSquadInput): AiSquadResult {
  const A = LIFECYCLE.ai;
  const faSince = input.season - 1;
  const events: LifecycleEvent[] = [];
  const removed: PlayerId[] = [];
  let pool = [...input.pool];
  const toPool = (p: LifePlayer): LifePlayer => ({ ...p, clubId: null, faSince, retiring: false });
  const sign = (p: LifePlayer, clubId: ClubId, rng: Rng): LifePlayer => {
    const [lo, hi] = A.contractSeasons;
    return { ...p, clubId, faSince: undefined, contract: { ...p.contract, seasonsLeft: randInt(rng, lo, hi) } };
  };
  const takeFromPool = (ok: (p: LifePlayer) => boolean): LifePlayer | undefined => {
    const best = pool.filter(ok).sort(byOvrDesc)[0];
    if (best) pool = pool.filter((p) => p !== best);
    return best;
  };

  const clubs = [...input.clubs]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((c) => ({ ...c, players: [...c.players], rng: lifeRng(input.gameSeed, input.season, 'ai-squad', c.id) }));

  for (const c of clubs) {
    const ref = TIER_REFERENCE_OVR[c.tier];
    // 1. 약체 방출 (20세 이하 유스 보호)
    c.players = c.players.filter((p) => {
      if (p.isTemporary || p.age < A.weakMinAge || p.ovr >= ref - A.weakBelow) return true;
      pool.push(toPool(p));
      events.push({ kind: 'RELEASED', playerId: p.id, clubId: c.id });
      return false;
    });
    // 2. 대역 상한
    const sellMax = A.sellMaxPerSeason + (c.relegated ? A.relegatedSellExtra : 0);
    for (let n = 0; n < sellMax && squadStrength(c.players) > ref + A.bandHi; n++) {
      const x = c.players.filter((p) => !p.isTemporary && p.age <= A.sellMaxAge && p.ovr >= ref + A.sellOver).sort(byOvrDesc)[0];
      if (!x) break;
      c.players = c.players.filter((p) => p !== x);
      if (c.tier === 'T1') {
        removed.push(x.id);
        events.push({ kind: 'SOLD_ABROAD', playerId: x.id, clubId: c.id });
      } else {
        pool.push(toPool(x));
        events.push({ kind: 'SOLD_UP', playerId: x.id, clubId: c.id });
      }
    }
  }

  const second = [...clubs].sort((a, b) => (a.tier < b.tier ? -1 : a.tier > b.tier ? 1 : 0)); // 안정 정렬: 같은 티어는 ID 순
  for (const c of second) {
    const ref = TIER_REFERENCE_OVR[c.tier];
    const size = () => c.players.filter((p) => !p.isTemporary).length;
    const count = (pos: Position) => c.players.filter((p) => !p.isTemporary && p.primary === pos).length;
    const add = (p: LifePlayer, kind: 'SIGNED_FROM_POOL' | 'REGENERATED') => {
      c.players.push(p);
      events.push({ kind, playerId: p.id, clubId: c.id });
    };
    // 3. 대역 하한
    if (squadStrength(c.players) < ref - A.bandLo) {
      const x = takeFromPool((p) => p.age <= A.poolMaxAge && p.ovr >= ref - A.bandLo && p.ovr <= ref + A.bandLoPoolMax);
      if (x) add(sign(x, c.id, c.rng), 'SIGNED_FROM_POOL');
    }
    // 4. 유스 (생성과 결정을 한 번에, 방출 후보는 세계에 남지 않음)
    const cands = generateYouthCandidates(lifeRng(input.gameSeed, input.season, 'youth', c.id), c.id, c.tier, input.season);
    for (const id of pickYouthAi(cands, size(), ref, true)) {
      const { tierRange: _t, ...y } = cands.find((p) => p.id === id)!;
      c.players.push({ ...y, clubId: c.id });
      events.push({ kind: 'YOUTH_PROMOTED', playerId: id, clubId: c.id, auto: true });
    }
    // 5. 최소 인원 보충 (+ GK 2명)
    for (let n = 1; size() < A.minSquad || count('GK') < A.minGk; n++) {
      const need =
        count('GK') < A.minGk ? 'GK' : POSITIONS.reduce((b, pos) => (LIFECYCLE.squadTemplate[pos] - count(pos) > LIFECYCLE.squadTemplate[b] - count(b) ? pos : b));
      // M4.8: ref − 6 ≤ ovr ≤ ref + poolFillHi (위쪽을 막아야 만료 FA 로 커진 풀이 하위 티어 전력을 올리지 않는다)
      const x = takeFromPool((p) => p.primary === need && p.age <= A.poolMaxAge && p.ovr <= ref + A.poolFillHi && p.ovr >= ref - A.poolBand);
      if (x) { add(sign(x, c.id, c.rng), 'SIGNED_FROM_POOL'); continue; }
      add(regenPlayer(c.rng, c.id, need, ref, input.season, n), 'REGENERATED');
    }
    // 6. 최대 인원 정리 (GK 2명 미만으로는 내리지 않음)
    while (size() > A.maxSquad) {
      const score = (p: Player) => p.ovr - A.agedPenalty * Math.max(0, p.age - 30);
      const x = c.players
        .filter((p) => !p.isTemporary && (p.primary !== 'GK' || count('GK') > A.minGk))
        .sort((a, b) => score(a) - score(b) || (a.id < b.id ? -1 : 1))[0]!;
      c.players = c.players.filter((p) => p !== x);
      pool.push(toPool(x));
      events.push({ kind: 'RELEASED', playerId: x.id, clubId: c.id });
    }
  }
  return { clubs: clubs.map((c) => ({ id: c.id, players: c.players })), pool, removed, events };
}

/** 재생성 선수 (11.4, 5.1). ID r{season}-{clubId}-{n}. 연봉은 호출자(M1.3 S(OVR))가 정한다 */
function regenPlayer(rng: Rng, clubId: ClubId, pos: Position, ref: number, season: SeasonNo, n: number): LifePlayer {
  const A = LIFECYCLE.ai;
  const age = randInt(rng, A.regenAge[0], A.regenAge[1]);
  const ovr = clamp(ref + A.regenOffset + gauss(rng) * A.regenSd, ref + A.regenClamp[0], ref + A.regenClamp[1]);
  const base = generatePlayer(rng, pos, Math.round(ovr), age);
  const potential = clamp(age <= A.regenPotAge ? base.ovr + Math.round(rng() * A.regenPotAdd) : base.ovr, base.ovr, 95);
  return {
    ...base,
    id: `r${season}-${clubId}-${n}`,
    clubId,
    potential,
    scoutRange: scoutRangeOf({ potential, age }),
    contract: { ...base.contract, seasonsLeft: randInt(rng, A.contractSeasons[0], A.contractSeasons[1]) },
    dev: { bank: 0, minutesMark: 0 },
  };
}

/**
 * 경고 누적 징계 (10.1, D1~D4). 정지는 가산식: 퇴장 +1, 누적 5장 +1(누적 −5). 퇴장 경기의 경고는 누적에 넣지 않는다(표시 통계는 센다).
 * applyMatchLine 이 호출한다. 사건: 누적 4장 도달 YELLOW_WARNING, 누적 정지 SUSPENDED_ACCUM.
 */
export function applyDiscipline(p: Player, line: Pick<PlayerMatchLine, 'redCard' | 'yellowCards'>): { player: Player; events: LifecycleEvent[] } {
  const yc = line.yellowCards ?? 0;
  const before = p.availability.yellowAccum ?? 0;
  let accum = before + (line.redCard ? 0 : yc);
  let ban = 0;
  while (accum >= LIFECYCLE.yellowLimit) {
    ban++;
    accum -= LIFECYCLE.yellowLimit;
  }
  const events: LifecycleEvent[] = [];
  if (ban) events.push({ kind: 'SUSPENDED_ACCUM', playerId: p.id });
  else if (accum === LIFECYCLE.yellowLimit - 1 && before !== accum) events.push({ kind: 'YELLOW_WARNING', playerId: p.id });
  const player: Player = {
    ...p,
    availability: { ...p.availability, suspendedMatches: p.availability.suspendedMatches + (line.redCard ? 1 : 0) + ban, yellowAccum: accum },
    season: { ...p.season, yellowCards: (p.season.yellowCards ?? 0) + yc },
  };
  return { player, events };
}
