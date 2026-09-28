/**
 * 8.3 유닛 레이팅 계산. 소유: A.
 * eff(attr) = attr × 5 × FIT_MULT[fit] × conditionEfficiency(condition)
 * 유닛 = 역할 가중치(data/roleWeights.ts)로 가중 평균 → 0~100
 */
import type {
  AttrKey,
  EnginePlayer,
  EngineTacticSlot,
  FitLevel,
  FormationDef,
  TeamInstructions,
  Lane,
  Position,
  RoleId,
  UnitKey,
  Units,
} from '../types';
import { CONDITION, FIT_MULT, RULES } from './data/constants';
import { FORMATIONS } from './data/formations';
import {
  GK_SAVE_MIX,
  GK_UNIT_MIX,
  PIVOT_ROLES,
  PRESS_RESIST_ROLES,
  WIDE_ATTACK_ROLES,
  ROLE_SHAPE,
  ROLE_UNIT_WEIGHTS,
  SET_PIECE,
  UNIT_MIX,
  type AttrMix,
  type WeightedUnit,
} from './data/roleWeights';

/** 4.2 효율 배수: ≥90 → 1.00, 90→60 선형 1.00→0.85, <60 → 0.80 */
export function conditionEfficiency(condition: number): number {
  const c = CONDITION;
  if (condition >= c.effFullAt) return 1;
  if (condition >= c.effLinearLowAt) {
    const t = (c.effFullAt - condition) / (c.effFullAt - c.effLinearLowAt);
    return 1 - t * (1 - c.effAtLinearLow);
  }
  return c.effBelowLow;
}

export function fitOf(player: Pick<EnginePlayer, 'positions' | 'primary'>, position: Position): FitLevel {
  return player.positions[position] ?? (player.primary === position ? 'NATURAL' : 'UNSUITED');
}

/** 경기장 위 한 자리의 점유자 */
export interface Occupant {
  player: EnginePlayer;
  position: Position;
  role: RoleId;
  lane: Lane;
  /** 현재 컨디션 (경기 중 감소) */
  condition: number;
}

export function eff(o: Occupant, attr: AttrKey): number {
  return o.player.attrs[attr] * 5 * FIT_MULT[fitOf(o.player, o.position)] * conditionEfficiency(o.condition);
}

export function mixEff(o: Occupant, mix: AttrMix): number {
  let s = 0;
  let w = 0;
  for (const k of Object.keys(mix) as AttrKey[]) {
    const m = mix[k] ?? 0;
    s += eff(o, k) * m;
    w += m;
  }
  return w > 0 ? s / w : 0;
}

function unitMixFor(o: Occupant, unit: WeightedUnit): AttrMix {
  if (o.position === 'GK') return GK_UNIT_MIX[unit] ?? UNIT_MIX[unit];
  return UNIT_MIX[unit];
}

/** 선수의 유닛 가중치 (마커는 × 0.8) */
export function unitWeight(o: Occupant, unit: WeightedUnit, markerId?: string): number {
  const w = ROLE_UNIT_WEIGHTS[o.role][unit] ?? 0;
  return o.player.id === markerId ? w * RULES.R9.markerOtherUnitMult : w;
}

/** 유닛 가중치 합에서 이 선수의 비율 (R9 "공격 유닛 가중치 ≥ 0.15" 판정) */
export function unitShare(occ: readonly (Occupant | null)[], playerId: string, unit: WeightedUnit): number {
  let total = 0;
  let mine = 0;
  for (const o of occ) {
    if (!o) continue;
    const w = ROLE_UNIT_WEIGHTS[o.role][unit] ?? 0;
    total += w;
    if (o.player.id === playerId) mine += w;
  }
  return total > 0 ? mine / total : 0;
}

function weightedUnit(
  occ: readonly (Occupant | null)[],
  unit: WeightedUnit,
  markerId: string | undefined,
  laneFilter?: Lane,
): number {
  let s = 0;
  let w = 0;
  for (const o of occ) {
    if (!o) continue;
    if (laneFilter && o.lane !== laneFilter) continue;
    const wt = unitWeight(o, unit, markerId);
    if (wt <= 0) continue;
    s += mixEff(o, unitMixFor(o, unit)) * wt;
    w += wt;
  }
  if (w > 0) return s / w;
  // 해당 레인·역할에 기여자가 없으면 필드 선수 평균의 85% (구멍 난 측면)
  let fs = 0;
  let fn = 0;
  for (const o of occ) {
    if (!o || o.position === 'GK') continue;
    fs += mixEff(o, UNIT_MIX[unit]);
    fn += 1;
  }
  return fn > 0 ? (fs / fn) * 0.85 : 0;
}

export interface UnitOptions {
  /** 퇴장·부상 등으로 빠진 인원 (인원당 모든 유닛 × 0.9) */
  missing: number;
  markerId?: string;
  setPieceTakerId?: string;
}

/** 세트피스 키커: 지정 키커가 경기장에 있으면 그 선수, 아니면 크로스 최고 선수 */
export function pickSetPieceTaker(occ: readonly (Occupant | null)[], preferred?: string): Occupant | null {
  let best: Occupant | null = null;
  let bestV = -1;
  for (const o of occ) {
    if (!o) continue;
    if (o.player.id === preferred) return o;
    if (o.position === 'GK') continue;
    const v = eff(o, 'crossing');
    if (v > bestV) {
      bestV = v;
      best = o;
    }
  }
  return best;
}

export function computeUnitsFromOccupants(occ: readonly (Occupant | null)[], opts: UnitOptions): Units {
  const m = opts.markerId;
  const core = (u: WeightedUnit, lane?: Lane) => weightedUnit(occ, u, m, lane);
  const gk = occ.find((o) => o?.position === 'GK') ?? occ[0] ?? null;
  const gkSave = gk ? mixEff(gk, GK_SAVE_MIX) : 20;
  const gkAir = gk ? eff(gk, 'aerialCommand') : 20;
  const aerA = core('AER_A');
  const aerD = core('AER_D');
  const taker = pickSetPieceTaker(occ, opts.setPieceTakerId);
  const takerCross = taker ? eff(taker, 'crossing') : aerA;
  const units: Units = {
    BU: core('BU'),
    PRG: core('PRG'),
    CRE: core('CRE'),
    FIN: core('FIN'),
    PRS: core('PRS'),
    MID: core('MID'),
    BOX: core('BOX'),
    CTRL: core('CTRL'),
    AER_A: aerA,
    AER_D: aerD,
    PACE_A: core('PACE_A'),
    PACE_D: core('PACE_D'),
    SIDE_A_L: core('SIDE_A', 'L'),
    SIDE_A_R: core('SIDE_A', 'R'),
    SIDE_D_L: core('SIDE_D', 'L'),
    SIDE_D_R: core('SIDE_D', 'R'),
    GK: gkSave,
    SPA: takerCross * SET_PIECE.takerShare + aerA * (1 - SET_PIECE.takerShare),
    SPD: aerD * SET_PIECE.spdAerShare + gkAir * (1 - SET_PIECE.spdAerShare),
  };
  if (opts.missing > 0) {
    const f = Math.pow(CONDITION.tenMenUnitMult, opts.missing);
    for (const k of Object.keys(units) as UnitKey[]) units[k] *= f;
  }
  return units;
}

/** 공개 API: onPitch[i] ↔ 포메이션 슬롯 i (경기 전 컨디션 사용) */
export function computeUnits(onPitch: readonly EnginePlayer[], slot: EngineTacticSlot, redCards: number): Units {
  const def = FORMATIONS[slot.formation];
  const occ: Occupant[] = onPitch.slice(0, def.slots.length).map((player, i) => {
    const fs = def.slots[i]!;
    return {
      player,
      position: fs.position,
      role: slot.roles[i] ?? fs.defaultRole,
      lane: fs.lane,
      condition: player.condition,
    };
  });
  return computeUnitsFromOccupants(occ, { missing: redCards });
}

// ───────────────────────────────────────────── 0.4.0 팀 형태 (실축구_전술설계 2.1)

/** 규칙이 쓰는 팀 형태 합계와 핵심 매치업 값. 경기 시작·세그먼트·교체·퇴장 때 다시 계산한다 (엔진 내부) */
export interface TeamShape {
  /** 중앙 공격 점유 / 중앙 수비 커버 (역할 형태값 합, 지시 보정 포함) */
  cA: number;
  cD: number;
  /** 측면별 공격·수비 인원 (중앙 레인 선수는 양쪽에 절반) */
  wA: { L: number; R: number };
  wD: { L: number; R: number };
  hs: number;
  /** 하프스페이스 커버 (5백 +1.5, 3백 +1.0 포함) */
  hsC: number;
  /** 러너 중 최고 속도 (1~20 유효값). 러너가 없으면 전방 3명 최고 × 0.9 */
  pRun: number;
  /** 가장 느린 CB 속도 (커버 CB 가 있으면 0.3 × 최저 + 0.7 × 커버) */
  pCb: number;
  /** CB 최저 속도 (커버 보정 없음) */
  pCbMin: number;
  runners: number;
  /** 2선 침투 역할(또는 폴스9) 존재 */
  deep: boolean;
  /** 러너 중 최고 침투 숙련 (위치선정+침착)/2 */
  runnerSkill: number;
  /** R1 압박 저항 역할 수 (최대 3) */
  resist: number;
  stCount: number;
  /** 피벗 수: DM 슬롯 선수 + 피벗 역할(앵커·레지스타·볼 위닝). 1 이면 2톱 커버 섀도 대상 */
  pivots: number;
  /** 전방 압박 인원: 최전방(ST + 윙어·인사이드 포워드·인버티드 윙어) 수 (3톱이면 3) */
  frontPress: number;
  pressingFwds: number;
  /** 타깃맨 개인 공중 (0~100), 없으면 null */
  targetAer: number | null;
  /** 세컨드볼 역할 수 (볼 위닝·박스투박스) */
  sbRoles: number;
  /** R5 잔류 수비 배수 */
  rd: number;
  backLine: 3 | 4 | 5;
  /** 스위퍼 키퍼 속도 (없으면 null) */
  sweeperPace: number | null;
  /** 측면별 윙 역할 / 측면 수비수 (R12) */
  wing: { L: Occupant | null; R: Occupant | null };
  sideBack: { L: Occupant | null; R: Occupant | null };
  /** 최고 중거리 능력 (MF·AM, 0.6 결정력 + 0.4 침착, 1~20) */
  longShot: number;
}

const raw = (o: Occupant, a: AttrKey) => eff(o, a) / 5;

export function computeShape(occ: readonly (Occupant | null)[], instr: TeamInstructions, formation: FormationDef): TeamShape {
  let cA = 0;
  let cD = 0;
  let hs = 0;
  let hsC = 0;
  const wA = { L: 0, R: 0 };
  const wD = { L: 0, R: 0 };
  let pRun = 0;
  let runners = 0;
  let runnerSkill = 0;
  let deep = false;
  let resist = 0;
  let stCount = 0;
  let pivots = 0;
  let pressingFwds = 0;
  let frontLine = 0;
  let targetAer: number | null = null;
  let sbRoles = 0;
  let rd = 1;
  let sweeperPace: number | null = null;
  let longShot = 0;
  const cbPaces: number[] = [];
  let coverPace: number | null = null;
  let frontBest = 0;
  const wing: TeamShape['wing'] = { L: null, R: null };
  const sideBack: TeamShape['sideBack'] = { L: null, R: null };
  for (const o of occ) {
    if (!o) continue;
    const s = ROLE_SHAPE[o.role];
    // 중앙 유효 인원은 미드필드·전방만 센다 (설계 2.4 계산 예). 수비 라인은 인버티드 풀백만 공격 시 중원에 합류
    const midfieldLine = o.position !== 'CB' && o.position !== 'FB' && o.position !== 'GK';
    if (midfieldLine || o.role === 'FB_INVERTED') cA += s.cA;
    if (midfieldLine) cD += o.role === 'W_WIDE_MIDFIELDER' && instr.width <= -1 ? RULES.R7.narrowWideMid : s.cD;
    hs += s.hs;
    hsC += s.hsC;
    const wdv = o.role === 'WB_WINGBACK' && instr.mentality >= 1 ? 0.4 : s.wD;
    if (o.lane === 'C') {
      wA.L += s.wA / 2;
      wA.R += s.wA / 2;
      wD.L += wdv / 2;
      wD.R += wdv / 2;
    } else {
      wA[o.lane] += s.wA;
      wD[o.lane] += wdv;
    }
    const pace = raw(o, 'pace');
    if (s.run) {
      runners += 1;
      pRun = Math.max(pRun, pace);
      runnerSkill = Math.max(runnerSkill, (raw(o, 'positioning') + raw(o, 'composure')) / 2);
    }
    if (s.deep || o.role === 'ST_FALSE_NINE') deep = true;
    if (PRESS_RESIST_ROLES.includes(o.role)) resist += 1;
    if (o.position === 'ST') stCount += 1;
    if (o.position === 'ST' || o.position === 'W' || (o.position === 'AM' && o.lane !== 'C')) frontBest = Math.max(frontBest, pace);
    if (o.position === 'DM' || PIVOT_ROLES.includes(o.role)) pivots += 1;
    if (o.role === 'ST_PRESSING_FORWARD') pressingFwds += 1;
    if (o.position === 'ST' || WIDE_ATTACK_ROLES.includes(o.role)) frontLine += 1;
    if (o.role === 'ST_TARGET') targetAer = Math.max(targetAer ?? 0, 0.7 * eff(o, 'physical') + 0.3 * eff(o, 'positioning'));
    if (o.role === 'DM_BALL_WINNER' || o.role === 'CM_BOX_TO_BOX' || o.role === 'DM_ANCHOR') sbRoles += 1;
    if (o.role === 'DM_ANCHOR') rd -= 0.4;
    if (o.role === 'DM_BALL_WINNER') rd -= 0.2;
    if (o.role === 'FB_INVERTED') rd -= 0.15;
    if (o.role === 'GK_SWEEPER') sweeperPace = raw(o, 'pace');
    if (o.position === 'CB') {
      cbPaces.push(pace);
      if (o.role === 'CB_COVER') coverPace = Math.max(coverPace ?? 0, pace);
    }
    if (o.position === 'DM' || o.position === 'CM' || o.position === 'AM') longShot = Math.max(longShot, 0.6 * raw(o, 'finishing') + 0.4 * raw(o, 'composure'));
    if (o.lane !== 'C') {
      if (o.position === 'W' || o.position === 'AM') wing[o.lane] = wing[o.lane] ?? o;
      if (o.position === 'FB') sideBack[o.lane] = o;
    }
  }
  if (runners === 0) pRun = frontBest * 0.9;
  const pCbMin = cbPaces.length > 0 ? Math.min(...cbPaces) : 10;
  const pCb = coverPace !== null ? 0.3 * pCbMin + 0.7 * coverPace : pCbMin;
  // 더블 피벗(DM 슬롯 2명): 하프스페이스 커버 (설계 1.2 균형 "더블 피벗이 하프스페이스를 막는다")
  if (occ.filter((o) => o?.position === 'DM').length >= 2) hsC += RULES.R11.doublePivot;
  if (formation.backLine === 5) hsC += RULES.R11.fiveBack;
  else if (formation.backLine === 3) hsC += RULES.R11.threeBack;
  // 공격 폭 단계마다 wA ±0.25, 좁은 수비(폭 ≤ −1)는 wD −0.25 × |폭|
  wA.L += RULES.R4.widthStep * instr.width;
  wA.R += RULES.R4.widthStep * instr.width;
  if (instr.width <= -1) {
    wD.L -= RULES.R4.narrowStep * -instr.width;
    wD.R -= RULES.R4.narrowStep * -instr.width;
  }
  // 라인 +2 압축: 라인 사이 간격이 좁아 중앙·하프스페이스 커버가 사실상 늘어난다
  if (instr.line >= 2) {
    cD += RULES.R7.compression;
    hsC += RULES.R7.compression;
  }
  return {
    cA,
    cD,
    wA,
    wD,
    hs,
    hsC,
    pRun,
    pCb,
    pCbMin,
    runners,
    deep,
    runnerSkill,
    resist: Math.min(resist, RULES.R1.resistMax),
    stCount,
    pivots,
    frontPress: frontLine,
    pressingFwds,
    targetAer,
    sbRoles,
    rd: Math.max(RULES.R5.rdMin, rd),
    backLine: formation.backLine,
    sweeperPace,
    wing,
    sideBack,
    longShot,
  };
}
