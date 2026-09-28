/**
 * 8.6 전술 상성 규칙 (tacMod 생성기), 엔진 0.4.0 (실축구_전술설계 2장). 소유: A.
 * - 값은 모두 actor(성공을 원하는 팀) 관점 부호. + = actor 유리.
 * - 이 파일은 "원기여 r_i" 만 만든다. 숙련도 계수·clamp 는 decide() 가 적용한다(전술 효과의 유일한 경로).
 * - DP 별로 RULES_BY_DP[dp] 에 있는 규칙만 값을 낼 수 있다(테스트로 검사).
 * - 크기는 팀 유닛 평균만이 아니라 역할 형태값(TeamShape)과 특정 선수 매치업(최고 러너 vs 최저 CB 등)으로 정한다.
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
import { ADVANCING_FB_ROLES, WIDE_ATTACK_ROLES } from './data/roleWeights';
import { clamp } from './math';
import { eff, unitShare, type Occupant, type TeamShape } from './units';

export interface TeamView {
  id: ClubId;
  instr: TeamInstructions;
  formation: FormationDef;
  occ: readonly (Occupant | null)[];
  units: Units;
  shape: TeamShape;
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

const tanhS = (x: number, s: number) => Math.tanh(x / s);
const rawAttr = (o: Occupant, a: Parameters<typeof eff>[1]) => eff(o, a) / 5;
const opposite = (side: Exclude<Lane, 'C'>): Exclude<Lane, 'C'> => (side === 'L' ? 'R' : 'L');

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

// ── R1 압박 vs 빌드업 ──────────────────────────────────────────────
function r1Value(att: TeamView, def: TeamView, perStep: number): number {
  if (def.instr.press < 1 || att.instr.directness > 0) return 0;
  const R = RULES.R1;
  const prs = def.units.PRS + R.pressingFwdPrs * def.shape.pressingFwds;
  const g = clamp(0.5 + (prs - att.units.BU) / 20, 0.25, 1);
  let resist = 1 - R.resistPer * att.shape.resist;
  if (att.shape.backLine === 3 && def.shape.frontPress <= 2) resist *= R.threeBackMult;
  return Math.max(perStep * def.instr.press, R.max) * g * resist * pressFit(def);
}

// ── R2 뒷공간 ──────────────────────────────────────────────────────
function r2Active(att: TeamView, def: TeamView): boolean {
  return att.instr.directness >= 1 && def.instr.line >= 1;
}
function r2Blocked(att: TeamView, def: TeamView): boolean {
  return att.instr.directness >= 1 && def.instr.line <= -1;
}
/** 가장 빠른 러너 vs 가장 느린 CB (1~20 유효값) */
export function paceMult(att: TeamView, def: TeamView): number {
  const R = RULES.R2;
  return clamp(1 + (att.shape.pRun - def.shape.pCb) / R.paceScale, R.paceMin, R.paceMax);
}
function r2Mult(att: TeamView, def: TeamView): number {
  const R = RULES.R2;
  const sp = def.shape.sweeperPace;
  const S = sp === null ? 1 : sp >= R.sweeperFastPace ? R.sweeperFast : R.sweeperSlow;
  const three = def.shape.backLine === 3 && att.shape.stCount <= 2 ? R.threeBackMult : 1;
  return paceMult(att, def) * S * three;
}

// ── R3 로우 블록 ───────────────────────────────────────────────────
function r3Active(att: TeamView, def: TeamView): boolean {
  return def.instr.line <= -1 && def.instr.mentality <= 0 && att.instr.directness <= -1;
}
function r3Comp(att: TeamView, def: TeamView): number {
  const R = RULES.R3;
  return clamp(R.compBase + (def.units.BOX - att.units.CRE) / R.compScale, R.compMin, R.compMax);
}

// ── R4 측면 과부하 ─────────────────────────────────────────────────
/** 공격 팀 side 측 측면 인원 − 수비 팀 맞은편 측면 수비 인원. 중앙은 양측 평균의 절반 */
export function sideOverload(att: TeamView, def: TeamView, side: Lane): number {
  const o = (s: Exclude<Lane, 'C'>) => att.shape.wA[s] - def.shape.wD[opposite(s)];
  return side === 'C' ? (o('L') + o('R')) / 4 : o(side);
}
/** 양방향: 측면 인원이 많으면 +, 수비 측면 인원이 더 많으면 − (0.4.0 보정: 리그 평균 득점 중립) */
function r4Value(att: TeamView, def: TeamView, side: Lane, k: number): number {
  const O = sideOverload(att, def, side);
  if (Math.abs(O) <= RULES.R4.threshold) return 0;
  return O > 0 ? k * Math.tanh(O) * widthFit(att) : k * RULES.R4.negMult * Math.tanh(O);
}

// ── R5 공격 성향 ↔ 역습 ────────────────────────────────────────────
function r5Active(loser: TeamView, winner: TeamView): boolean {
  return loser.instr.mentality >= 1 && winner.instr.counter;
}

// ── R6 오프사이드 트랩 ─────────────────────────────────────────────
function r6Active(att: TeamView, def: TeamView): boolean {
  return def.instr.offsideTrap && att.shape.runners >= 1;
}
function r6Value(att: TeamView, def: TeamView): number {
  const R = RULES.R6;
  const sk = clamp(att.shape.runnerSkill - 10, 0, 5) / 12;
  const dr = att.shape.deep ? R.deepMult : 1;
  const tf = def.shape.pCbMin >= R.cbPaceOk ? 1 : R.slowCbMult;
  return R.dp4Through * (1 - sk) * dr * tf;
}

// ── R7 중앙 통제 ───────────────────────────────────────────────────
/** 중앙 유효 인원 차 C = cA(공격) − cD(수비, 커버 섀도 포함) */
export function centralDiff(att: TeamView, def: TeamView): number {
  const R = RULES.R7;
  let cD = def.shape.cD;
  if (def.shape.stCount >= 2 && att.shape.pivots === 1) cD += def.instr.press >= 1 ? R.coverShadowPress : R.coverShadow;
  return att.shape.cA - cD;
}
function r7Value(att: TeamView, def: TeamView, k: number, dp8: boolean): number {
  if (att.instr.directness >= 1) return 0;
  const C = centralDiff(att, def);
  if (C === 0) return 0;
  const v = k * tanhS(C, RULES.R7.scale);
  if (dp8) return v * shortPassFit(att);
  return v > 0 ? v * Math.min(1, att.units.BU / RULES.R7.fitBU) : v;
}

// ── R11 하프스페이스 ───────────────────────────────────────────────
function r11H(att: TeamView, def: TeamView): number {
  return att.shape.hs - def.shape.hsC - RULES.R11.offset;
}
function r11Cf(att: TeamView): number {
  return clamp(att.units.CRE / RULES.R11.cfScale, RULES.R11.cfMin, 1);
}

// ── R12 측면 1:1 (윙백 뒤 공간) ────────────────────────────────────
/** 공격 팀 side 측 윙어 vs 수비 팀 맞은편 올라가는 측면 수비수. 조건 불충족이면 null */
function r12Pair(att: TeamView, def: TeamView, side: Exclude<Lane, 'C'>): { w: Occupant; d: Occupant } | null {
  if (def.instr.mentality < 0) return null;
  const w = att.shape.wing[side];
  const d = def.shape.sideBack[opposite(side)];
  if (!w || !d || !WIDE_ATTACK_ROLES.includes(w.role) || !ADVANCING_FB_ROLES.includes(d.role)) return null;
  return { w, d };
}
function r12M1(p: { w: Occupant; d: Occupant }): number {
  return clamp((rawAttr(p.w, 'pace') - rawAttr(p.d, 'pace')) / 4 + 0.5, 0, 1) * r12Wb(p);
}
/** 3백 윙백 뒤 공간은 공격형 풀백보다 넓다 (3백 시스템의 고전적 약점) */
function r12Wb(p: { d: Occupant }): number {
  return p.d.role === 'WB_WINGBACK' ? RULES.R12.wbMult : 1;
}
function r12D1(p: { w: Occupant; d: Occupant }): number {
  return (rawAttr(p.w, 'dribbling') + rawAttr(p.w, 'pace')) / 2 - (rawAttr(p.d, 'tackling') + rawAttr(p.d, 'pace')) / 2;
}

// ── R13 타깃맨 롱볼·세컨드볼 ───────────────────────────────────────
function r13Active(att: TeamView): boolean {
  return att.instr.directness >= 1 && att.shape.targetAer !== null;
}
function r13Three(att: TeamView, def: TeamView): number {
  return def.shape.backLine === 3 && att.shape.stCount <= 2 ? RULES.R13.threeBackMult : 1;
}

function lineFitActive(def: TeamView): boolean {
  return def.instr.line >= 2 && (def.units.PACE_D < FIT_REQUIREMENTS.linePlus2PACE_D || def.shape.pCb < RULES.LINE_FIT.cbPaceRequired);
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
    if (v === 0 || !Number.isFinite(v) || !ruleEnabled(id, config)) return;
    raw[id] = (raw[id] ?? 0) + v;
  };
  const R = RULES;
  switch (dp) {
    case 'DP1': {
      const att = actor;
      const def = opp;
      put('R1', r1Value(att, def, R.R1.perPressStep));
      if (r2Active(att, def)) put('R2', Math.min(R.R2.perDirectStep * att.instr.directness, R.R2.max) * r2Mult(att, def));
      else if (r2Blocked(att, def)) put('R2', R.R2.deepBlockPerStep * att.instr.directness * -def.instr.line);
      if (r13Active(att)) {
        put('R13', R.R13.dp1 * tanhS(att.shape.targetAer! - def.units.AER_D + R.R13.aerOffset, R.R13.scale) * (def.instr.press >= 1 ? R.R13.vsPress : 1) * r13Three(att, def));
      }
      break;
    }
    case 'DP2': {
      put('R7', r7Value(actor, opp, R.R7.dp2, false));
      put('R9', r9Value(actor, opp, 'PRG'));
      if (opp.instr.line <= -1) put('R3', R.R3.dp2PerDeepLine * -opp.instr.line);
      if (r2Blocked(actor, opp)) put('R2', R.R2.deepBlockPerStep * actor.instr.directness * -opp.instr.line);
      const H = r11H(actor, opp);
      if (H > 0) put('R11', R.R11.dp2 * Math.tanh(H) * r11Cf(actor));
      if (r13Active(actor)) {
        const sb = (t: TeamView) => t.units.MID + R.R13.sbPerRole * t.shape.sbRoles;
        // 세컨드볼 우위만 이득 (열세면 0: 롱볼 자체의 손해는 DP1 공중전 항이 맡는다)
        put('R13', R.R13.dp2 * Math.max(0, tanhS(sb(actor) - sb(opp), R.R13.scale)) * r13Three(actor, opp));
      }
      break;
    }
    case 'DP4': {
      const att = actor;
      const def = opp;
      const c = ctx.chance;
      const side = ctx.side ?? 'C';
      if (r3Active(att, def) && c !== 'LONG' && c !== 'CROSS') put('R3', R.R3.dp4 * r3Comp(att, def));
      if (r3Active(att, def) && c === 'CROSS') put('R3', R.R3.crossAer * tanhS(att.units.AER_A - def.units.AER_D, R.R3.aerScale));
      if (c === 'CROSS' || c === 'CUTBACK') put('R4', r4Value(att, def, side, R.R4.dp4));
      if (c === 'THROUGH' && r6Active(att, def)) put('R6', r6Value(att, def));
      put('R9', r9Value(att, def, 'CRE'));
      if (att.attackSide && side === att.attackSide) {
        const [a, d] = sideUnits(att, def, att.attackSide);
        put('R10', R.R10.dp4 * Math.tanh((a - d) / R.R10.tanhScale));
      }
      if (c === 'THROUGH' && lineFitActive(def)) put('LINE_FIT', -R.LINE_FIT.penalty);
      // 공격 성향 트레이드오프 (양방향): +1 이상 찬스 ↑, −1 이하 찬스 ↓
      if (att.instr.mentality !== 0) put('R5', R.R5.dp4PerMentality * att.instr.mentality);
      if (c === 'THROUGH' || c === 'CUTBACK') {
        const H = r11H(att, def);
        if (H > 0) put('R11', R.R11.dp4 * Math.tanh(H) * r11Cf(att));
      }
      if ((c === 'SOLO' || c === 'CROSS') && side !== 'C') {
        const p = r12Pair(att, def, side);
        // 윙백 뒤 공간 자체가 이점(d1Offset), 선수 매치업이 크기를 조정
        if (p) put('R12', R.R12.dp4 * tanhS(r12D1(p) + R.R12.d1Offset, R.R12.d1Scale) * r12Wb(p));
      }
      break;
    }
    case 'DP5': {
      const att = actor;
      const def = opp;
      if (ctx.chance === 'THROUGH' && r6Active(att, def) && ctx.shooter && ctx.shooter.role && rawAttr(ctx.shooter, 'pace') >= R.R6.dp5Pace) {
        put('R6', R.R6.dp5Bonus);
      }
      if (ctx.chance === 'LONG' && r3Active(att, def)) put('R3', R.R3.dp5Long * clamp((att.shape.longShot - 13) / 5, 0, 1));
      // 0.4.0 보정: 측면 과부하·1:1 은 크로스·컷백·돌파 찬스의 "질"(슈팅 전환)에도 작용한다
      const side5 = ctx.side ?? 'C';
      if (ctx.chance === 'CROSS' || ctx.chance === 'CUTBACK') put('R4', r4Value(att, def, side5, R.R4.dp5));
      if ((ctx.chance === 'CROSS' || ctx.chance === 'SOLO') && side5 !== 'C') {
        const p = r12Pair(att, def, side5);
        if (p) put('R12', R.R12.dp5 * tanhS(r12D1(p) + R.R12.d1Offset, R.R12.d1Scale) * r12Wb(p));
      }
      // 0.4.0 보정: 상성 우위로 만든 찬스는 질도 좋다 (슈팅 전환 가산, 같은 발동 조건)
      const c5 = ctx.chance;
      if ((c5 === 'THROUGH' || c5 === 'COUNTER') && r2Active(att, def)) put('R2', R.R2.dp5 * r2Mult(att, def));
      if (c5 !== 'LONG' && c5 !== 'CROSS' && c5 !== 'CORNER' && c5 !== 'FK' && c5 !== 'PK' && r3Active(att, def)) put('R3', -R.R3.dp5Box * r3Comp(att, def));
      if ((c5 === 'THROUGH' || c5 === 'CUTBACK') && r11H(att, def) > 0) put('R11', R.R11.dp5 * Math.tanh(r11H(att, def)) * r11Cf(att));
      if ((c5 === 'CROSS' || c5 === 'CORNER') && r13Active(att)) put('R13', R.R13.dp5 * tanhS(att.shape.targetAer! - def.units.AER_D + R.R13.aerOffset, R.R13.scale) * r13Three(att, def));
      if (c5 === 'COUNTER') {
        if (r5Active(def, att)) put('R5', R.R5.dp5 * def.shape.rd);
        if (att.instr.press >= 1 && def.instr.directness <= 0) put('R1', R.R1.dp5Counter);
      }
      put('R9', r9Value(att, def, null, ctx.shooter?.player.id));
      break;
    }
    case 'DP6': {
      const winner = actor;
      const loser = opp;
      // 역압박 전환은 짧게 빌드업하다 잃은 공에만 (롱볼 팀은 압박을 건너뛴다)
      if (winner.instr.press >= 1 && loser.instr.directness <= 0) put('R1', (R.R1.dp6CounterBonus * winner.instr.press) / 2 * Math.min(1, winner.units.PRS / FIT_REQUIREMENTS.pressPlus2PRS) + R.R1.pressingFwdDp6 * winner.shape.pressingFwds);
      if (r5Active(loser, winner)) put('R5', R.R5.dp6 * loser.shape.rd);
      break;
    }
    case 'DP7': {
      const winner = actor;
      const loser = opp;
      if (r5Active(loser, winner)) {
        put('R5', R.R5.dp7 * clamp((winner.shape.pRun - loser.shape.pCb) / R.R5.paceScale, 0, 1) * loser.shape.rd);
      }
      let best = 0;
      for (const s of ['L', 'R'] as const) {
        const p = r12Pair(winner, loser, s);
        if (p) best = Math.max(best, r12M1(p));
      }
      put('R12', R.R12.dp7 * best);
      if (lineFitActive(loser)) put('LINE_FIT', -R.LINE_FIT.penalty);
      break;
    }
    case 'DP8': {
      put('R7', r7Value(actor, opp, R.R7.dp8, true));
      put('R1', r1Value(actor, opp, R.R1.dp8PerPress));
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

/** DP3 유형별 규칙 원기여 (side = 이번 공격 측면) */
export function evalChoiceRules(att: TeamView, def: TeamView, config: EngineConfig, side: Lane = 'C'): Record<OpenPlayChance, RawMap> {
  const out: Record<OpenPlayChance, RawMap> = { CROSS: {}, THROUGH: {}, CUTBACK: {}, LONG: {}, SOLO: {} };
  const put = (t: OpenPlayChance, id: RuleId, v: number) => {
    if (v === 0 || !Number.isFinite(v) || !ruleEnabled(id, config)) return;
    out[t][id] = (out[t][id] ?? 0) + v;
  };
  const R = RULES;
  if (r2Active(att, def)) put('THROUGH', 'R2', R.R2.dp3Through * r2Mult(att, def));
  if (r3Active(att, def)) {
    put('LONG', 'R3', R.R3.dp3LongCross);
    put('CROSS', 'R3', R.R3.dp3LongCross);
  }
  const r4 = r4Value(att, def, side, R.R4.dp3);
  put('CROSS', 'R4', r4);
  put('CUTBACK', 'R4', r4);
  const H = r11H(att, def);
  if (H > 0) {
    put('THROUGH', 'R11', R.R11.dp3 * Math.tanh(H));
    put('CUTBACK', 'R11', R.R11.dp3 * Math.tanh(H));
  }
  return out;
}
