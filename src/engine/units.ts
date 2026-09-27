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
