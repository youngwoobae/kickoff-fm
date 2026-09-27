/**
 * 8.6 전술 상성 규칙 (tacMod 생성기). 소유: A.
 * - 값은 모두 actor(성공을 원하는 팀) 관점 부호. + = actor 유리.
 * - 이 파일은 "원기여 r_i" 만 만든다. 숙련도 계수·clamp 는 decide() 가 적용한다(전술 효과의 유일한 경로).
 * - DP 별로 RULES_BY_DP[dp] 에 있는 규칙만 값을 낼 수 있다(테스트로 검사).
 */
import type {
  BinaryDP,
  ChanceType,
  ClubId,
  EngineConfig,
  FormationDef,
  Lane,
  OpenPlayChance,
  RoleId,
  RuleId,
  TeamInstructions,
  Units,
  Zone,
} from '../types';
import { FIT_REQUIREMENTS, RULES, RULES_BY_DP } from './data/constants';
import { clamp } from './math';
import { unitShare, type Occupant } from './units';

export interface TeamView {
  id: ClubId;
  instr: TeamInstructions;
  formation: FormationDef;
  occ: readonly (Occupant | null)[];
  units: Units;
  familiarity: number;
  /** 이 팀이 상대에게 거는 맞춤 지시 */
  markTarget?: string;
  /** 경기장 위에서 확정된 마커 */
  markerId?: string;
  attackSide?: Exclude<Lane, 'C'>;
}

export interface RuleCtx {
  zone?: Zone;
  chance?: ChanceType;
  side?: Lane;
  shooter?: Occupant;
}

export type RawMap = Partial<Record<RuleId, number>>;

export function ruleEnabled(rule: RuleId, config: EngineConfig): boolean {
  if (config.onlyRules && config.onlyRules.length > 0) return config.onlyRules.includes(rule);
  return !config.disabledRules.includes(rule);
}

export function hasRole(t: TeamView, role: RoleId): boolean {
  return t.occ.some((o) => o?.role === role);
}

function findOcc(t: TeamView, id: string | undefined): Occupant | undefined {
  if (!id) return undefined;
  return t.occ.find((o) => o?.player.id === id) ?? undefined;
}

function poacher(t: TeamView): Occupant | undefined {
  return t.occ.find((o) => o?.role === 'ST_POACHER') ?? undefined;
}

function skilledPoacher(o: Occupant | undefined): boolean {
  const th = RULES.R6.skilledThreshold;
  return !!o && o.player.attrs.positioning >= th && o.player.attrs.composure >= th;
}

function sweeperMult(def: TeamView): number {
  return hasRole(def, 'GK_SWEEPER') ? RULES.R2.sweeperMult : 1;
}

/** R1 압박 적합도: 압박 +2 & PRS < 65 → × PRS/65 */
function pressFit(t: TeamView): number {
  return t.instr.press === 2 && t.units.PRS < FIT_REQUIREMENTS.pressPlus2PRS ? t.units.PRS / FIT_REQUIREMENTS.pressPlus2PRS : 1;
}

/** R4 폭 적합도: 폭 +2 & 측면 공격 평균 < 60 → × 비율 */
function widthFit(t: TeamView): number {
  const side = (t.units.SIDE_A_L + t.units.SIDE_A_R) / 2;
  return t.instr.width === 2 && side < FIT_REQUIREMENTS.widthPlus2Side ? side / FIT_REQUIREMENTS.widthPlus2Side : 1;
}

/** R7 DP8 적합도: 패스 −2 & BU < 60 → × BU/60 */
function shortPassFit(t: TeamView): number {
  return t.instr.directness === -2 && t.units.BU < FIT_REQUIREMENTS.passShortBU ? t.units.BU / FIT_REQUIREMENTS.passShortBU : 1;
}

function r2Active(att: TeamView, def: TeamView): boolean {
  return att.instr.directness >= 1 && att.units.PACE_A > def.units.PACE_D && def.instr.line >= 1;
}

function r3Active(att: TeamView, def: TeamView): boolean {
  return def.instr.line <= -1 && def.instr.mentality <= 0 && att.instr.directness <= -1;
}

function r4Active(att: TeamView, def: TeamView): boolean {
  return att.instr.width >= 1 && (def.instr.width <= -1 || def.formation.isNarrow);
}

function r5Active(loser: TeamView, winner: TeamView): boolean {
  return loser.instr.mentality >= 1 && winner.instr.counter;
}

function r6Active(att: TeamView, def: TeamView): boolean {
  return def.instr.offsideTrap && !!poacher(att);
}

function lineFitActive(def: TeamView): boolean {
  return def.instr.line === 2 && def.units.PACE_D < FIT_REQUIREMENTS.linePlus2PACE_D;
}

/** R9: 수비 팀(def)의 마크 대상 T 가 공격 팀(att)에 있고 해당 유닛에 충분히 참여하면 */
function r9Value(att: TeamView, def: TeamView, unit: 'PRG' | 'CRE' | null, shooterId?: string): number {
  const T = findOcc(att, def.markTarget);
  const M = findOcc(def, def.markerId);
  if (!T || !M) return 0;
  if (unit) {
    if (unitShare(att.occ, T.player.id, unit) < RULES.R9.minUnitWeight) return 0;
  } else if (shooterId !== T.player.id) {
    return 0;
  }
  const ma = M.player.attrs;
  const ta = T.player.attrs;
  const markFit = clamp(0.5 + (ma.tackling + ma.positioning - (ta.dribbling + ta.positioning)) / 20, 0, 1);
  return RULES.R9.perMarkFit * markFit;
}

function sideUnits(att: TeamView, def: TeamView, side: Exclude<Lane, 'C'>): [number, number] {
  const a = side === 'L' ? att.units.SIDE_A_L : att.units.SIDE_A_R;
  // 공격의 L 은 수비의 R 측과 맞선다
  const d = side === 'L' ? def.units.SIDE_D_R : def.units.SIDE_D_L;
  return [a, d];
}

/**
 * 이진 결정 지점의 규칙 원기여 (famCoef·clamp 전).
 * actor: DP1·2·4·5·8 은 공격 팀, DP6·7 은 공을 뺏은 팀. opp 는 그 상대.
 */
export function evalBinaryRules(dp: BinaryDP, actor: TeamView, opp: TeamView, ctx: RuleCtx, config: EngineConfig): RawMap {
  const raw: RawMap = {};
  const put = (id: RuleId, v: number) => {
    if (v === 0 || !ruleEnabled(id, config)) return;
    raw[id] = (raw[id] ?? 0) + v;
  };
  const R = RULES;
  switch (dp) {
    case 'DP1': {
      const att = actor;
      const def = opp;
      if (def.instr.press >= 1 && att.units.BU < def.units.PRS) {
        put('R1', Math.max(R.R1.perPressStep * def.instr.press, R.R1.max) * pressFit(def));
      }
      if (r2Active(att, def)) {
        put('R2', Math.min(R.R2.perDirectStep * att.instr.directness, R.R2.max) * sweeperMult(def));
      }
      break;
    }
    case 'DP2': {
      const diff = actor.formation.centralMidfielders - opp.formation.centralMidfielders;
      if (diff !== 0) put('R7', clamp(R.R7.perMid * diff, -R.R7.max, R.R7.max));
      put('R9', r9Value(actor, opp, 'PRG'));
      break;
    }
    case 'DP4': {
      const att = actor;
      const def = opp;
      const c = ctx.chance;
      if (r3Active(att, def)) {
        if (c !== 'LONG' && c !== 'CROSS') put('R3', R.R3.dp4);
        else if (c === 'CROSS' && att.units.AER_A > def.units.AER_D) put('R3', R.R3.targetManCross);
      }
      if (r4Active(att, def) && (c === 'CROSS' || c === 'CUTBACK')) put('R4', R.R4.dp4 * widthFit(att));
      if (c === 'THROUGH' && r6Active(att, def)) {
        put('R6', skilledPoacher(poacher(att)) ? R.R6.dp4ThroughSkilled : R.R6.dp4Through);
      }
      put('R9', r9Value(att, def, 'CRE'));
      if (att.attackSide && ctx.side === att.attackSide) {
        const [a, d] = sideUnits(att, def, att.attackSide);
        put('R10', R.R10.dp4 * Math.tanh((a - d) / R.R10.tanhScale));
      }
      if (c === 'THROUGH' && lineFitActive(def)) put('LINE_FIT', -R.LINE_FIT.penalty);
      break;
    }
    case 'DP5': {
      const att = actor;
      const def = opp;
      if (ctx.chance === 'THROUGH' && r6Active(att, def) && ctx.shooter?.role === 'ST_POACHER' && skilledPoacher(ctx.shooter)) {
        put('R6', R.R6.dp5Bonus);
      }
      put('R9', r9Value(att, def, null, ctx.shooter?.player.id));
      break;
    }
    case 'DP6': {
      const winner = actor;
      const loser = opp;
      if (winner.instr.press >= 1) put('R1', R.R1.dp6CounterBonus);
      if (r5Active(loser, winner)) put('R5', R.R5.dp6 * (hasRole(loser, 'DM_ANCHOR') ? R.R5.anchorMult : 1));
      break;
    }
    case 'DP7': {
      const winner = actor;
      const loser = opp;
      if (r5Active(loser, winner)) {
        const pace = clamp((winner.units.PACE_A - loser.units.PACE_D) / R.R5.paceScale, 0, 1);
        put('R5', R.R5.dp7 * pace * (hasRole(loser, 'DM_ANCHOR') ? R.R5.anchorMult : 1));
      }
      if (lineFitActive(loser)) put('LINE_FIT', -R.LINE_FIT.penalty);
      break;
    }
    case 'DP8': {
      const diff = actor.formation.centralMidfielders - opp.formation.centralMidfielders;
      if (diff !== 0) put('R7', R.R7.dp8Reset * Math.sign(diff) * shortPassFit(actor));
      put('TEMPO', -R.TEMPO.dp8PerStep * actor.instr.tempo);
      break;
    }
  }
  // 방어적 검사: DP 에 허용되지 않은 규칙은 버린다
  const allowed = RULES_BY_DP[dp];
  for (const k of Object.keys(raw) as RuleId[]) if (!allowed.includes(k)) delete raw[k];
  return raw;
}

export const OPEN_CHANCES: readonly OpenPlayChance[] = ['CROSS', 'THROUGH', 'CUTBACK', 'LONG', 'SOLO'];

/** DP3 유형별 규칙 원기여 */
export function evalChoiceRules(att: TeamView, def: TeamView, config: EngineConfig): Record<OpenPlayChance, RawMap> {
  const out: Record<OpenPlayChance, RawMap> = { CROSS: {}, THROUGH: {}, CUTBACK: {}, LONG: {}, SOLO: {} };
  const put = (t: OpenPlayChance, id: RuleId, v: number) => {
    if (v === 0 || !ruleEnabled(id, config)) return;
    out[t][id] = (out[t][id] ?? 0) + v;
  };
  const R = RULES;
  if (r2Active(att, def)) put('THROUGH', 'R2', R.R2.dp3Through * sweeperMult(def));
  if (r3Active(att, def)) {
    put('LONG', 'R3', R.R3.dp3LongCross);
    put('CROSS', 'R3', R.R3.dp3LongCross);
  }
  if (r4Active(att, def)) {
    const f = widthFit(att);
    put('CROSS', 'R4', R.R4.dp3 * f);
    put('CUTBACK', 'R4', R.R4.dp3 * f);
  }
  return out;
}
