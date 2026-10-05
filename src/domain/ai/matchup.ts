/**
 * 전술 상성 정적 평가 (감독 AI 슬롯 선택·상대 분석·getMatchupPreview). 소유: A.
 * 엔진 rules.ts 를 RNG 없이 그대로 호출한다: 양 팀 TeamView(유닛·형태값)를 만들고 DP 별 대표 상황의 원기여를
 * 경기당 대략 빈도 × VALUE 로 xG 환산한다. 경기 결과에는 쓰지 않는다.
 */
import type {
  BinaryDP,
  ChanceType,
  DP,
  EngineConfig,
  EnginePlayer,
  FormationId,
  Lane,
  MatchupRuleHint,
  RoleId,
  RuleId,
  StyleFit,
  StyleId,
  StyleRequirementKey,
  TeamInstructions,
} from '../../types';
import {
  ENGINE_VERSION,
  EngineConstants,
  FORMATIONS,
  OPEN_CHANCES,
  STYLES,
  VALUE_TABLE,
  clamp,
  computeShape,
  computeUnitsFromOccupants,
  defaultRoles,
  evalBinaryRules,
  evalChoiceRules,
  eff,
  paceMult,
  sideOverload,
  type Occupant,
  type TeamView,
} from '../../engine';

export interface TacticShape {
  formation: FormationId;
  instructions: TeamInstructions;
  roles?: RoleId[];
}

/** 선수 정보가 없을 때 쓰는 평균 선수 (모든 능력치 12 ≈ OVR 60) */
function genericPlayer(i: number): EnginePlayer {
  const v = 12;
  return {
    id: `generic-${i}`,
    name: '',
    attrs: {
      passing: v,
      dribbling: v,
      finishing: v,
      crossing: v,
      tackling: v,
      vision: v,
      positioning: v,
      composure: v,
      workRate: v,
      pace: v,
      stamina: v,
      physical: v,
      reflexes: v,
      aerialCommand: v,
      kicking: v,
    },
    condition: 100,
    positions: {},
    primary: 'CM',
  };
}

/** 정적 평가용 TeamView. players 는 포메이션 슬롯 순(길이 11), 없으면 평균 선수 */
export function staticView(id: string, t: TacticShape, players?: readonly (EnginePlayer | undefined)[]): TeamView {
  const f = FORMATIONS[t.formation];
  const roles = t.roles && t.roles.length === f.slots.length ? t.roles : defaultRoles(t.formation);
  const occ: Occupant[] = f.slots.map((s, i) => {
    const p = players?.[i] ?? { ...genericPlayer(i), primary: s.position };
    return { player: p, position: s.position, role: roles[i]!, lane: s.lane, condition: 100 };
  });
  return {
    id,
    instr: t.instructions,
    formation: f,
    occ,
    units: computeUnitsFromOccupants(occ, { missing: 0 }),
    shape: computeShape(occ, t.instructions, f),
    familiarity: 100,
  };
}

const CONFIG: EngineConfig = { engineVersion: ENGINE_VERSION, tacCap: EngineConstants.DEFAULT_TAC_CAP, tacticsEnabled: true, disabledRules: [] };

/** 경기당 팀 한쪽의 결정 대략 빈도 (0.4.0 BASELINE 로그 평균 근사 [PH]) */
const FREQ: Record<BinaryDP, number> = { DP1: 55, DP2: 45, DP4: 13, DP5: 13, DP6: 30, DP7: 7, DP8: 35 };
/** 대표 찬스 유형 비중 (DP4) */
const CHANCE_SHARE: Record<(typeof OPEN_CHANCES)[number], number> = { CROSS: 0.27, THROUGH: 0.2, CUTBACK: 0.2, LONG: 0.18, SOLO: 0.15 };
/** 로짓 1 당 확률 변화 근사 p(1−p) */
const SLOPE = 0.2;

function vOf(dp: BinaryDP, chance?: ChanceType): number {
  const V = VALUE_TABLE;
  switch (dp) {
    case 'DP1':
      return V.DP1;
    case 'DP2':
      return V.DP2;
    case 'DP4':
      return chance && chance in V.DP4 ? V.DP4[chance as keyof typeof V.DP4] : V.DP4.CUTBACK;
    case 'DP5':
      return 1;
    case 'DP6':
      return V.DP6;
    case 'DP7':
      return V.DP7;
    case 'DP8':
      return V.DP8.z0;
  }
}

interface Fire {
  id: RuleId;
  dp: DP;
  xg: number;
}

/** actor 관점 원기여를 (규칙, DP) 별 경기당 xG 로 누적. sign = actor 가 us 면 +1 */
function accumulate(out: Fire[], actor: TeamView, opp: TeamView, sign: 1 | -1): void {
  const add = (dp: DP, raw: Partial<Record<RuleId, number>>, w: number) => {
    const cap = CONFIG.tacCap;
    let sum = 0;
    for (const v of Object.values(raw)) sum += v ?? 0;
    const scale = Math.abs(sum) > cap ? cap / Math.abs(sum) : 1;
    for (const [k, v] of Object.entries(raw) as [RuleId, number][]) out.push({ id: k, dp, xg: sign * v * scale * w });
  };
  const sides: Lane[] = ['L', 'C', 'R'];
  for (const dp of ['DP1', 'DP2', 'DP6', 'DP7', 'DP8'] as const) add(dp, evalBinaryRules(dp, actor, opp, { zone: dp === 'DP8' ? 0 : 1 }, CONFIG), FREQ[dp] * SLOPE * vOf(dp));
  for (const c of OPEN_CHANCES) {
    for (const side of sides) {
      const w = FREQ.DP4 * CHANCE_SHARE[c] * (side === 'C' ? 0.3 : 0.35) * SLOPE;
      add('DP4', evalBinaryRules('DP4', actor, opp, { zone: 2, chance: c, side }, CONFIG), w * vOf('DP4', c));
    }
  }
  // DP3 선택: 규칙이 유형 비중을 바꾸는 효과 (선택 확률 변화 ≈ share × raw) × 유형 기대 xG
  for (const side of sides) {
    const byType = evalChoiceRules(actor, opp, CONFIG, side);
    for (const c of OPEN_CHANCES) {
      const w = FREQ.DP4 * (side === 'C' ? 0.3 : 0.35) * CHANCE_SHARE[c] * (1 - CHANCE_SHARE[c]) * VALUE_TABLE.chanceEv[c] * 8;
      add('DP3', byType[c], w);
    }
  }
}

/** 우리(us) 관점 규칙·DP 별 경기당 예상 xG 기여 (+ 우리 유리) */
export function matchupFires(us: TeamView, them: TeamView): Fire[] {
  const out: Fire[] = [];
  accumulate(out, us, them, 1);
  accumulate(out, them, us, -1);
  return out;
}

/** 우리(us) 관점 규칙별 예상 가산치 합 (+ 우리 유리, 경기당 xG 근사) */
export function tacticEdge(us: TacticShape, them: TacticShape): Partial<Record<RuleId, number>> {
  const out: Partial<Record<RuleId, number>> = {};
  for (const f of matchupFires(staticView('us', us), staticView('them', them))) out[f.id] = (out[f.id] ?? 0) + f.xg;
  return out;
}

/** 순수 함수라 모양 쌍으로 캐시한다 (M7.2: 봇 슬롯 선택이 매일 경기마다 두 번씩 부른다). ponytail: 1,000쌍 넘으면 통째로 비움 */
const edgeCache = new Map<string, number>();
export function tacticEdgeTotal(us: TacticShape, them: TacticShape): number {
  const key = JSON.stringify([us.formation, us.instructions, us.roles, them.formation, them.instructions, them.roles]);
  let v = edgeCache.get(key);
  if (v === undefined) {
    if (edgeCache.size >= 1000) edgeCache.clear();
    v = Object.values(tacticEdge(us, them)).reduce((a, b) => a + (b ?? 0), 0);
    edgeCache.set(key, v);
  }
  return v;
}

const RULE_NAME: Record<RuleId, string> = {
  R1: '압박',
  R2: '뒷공간',
  R3: '로우 블록',
  R4: '측면 과부하',
  R5: '역습',
  R6: '오프사이드 트랩',
  R7: '중앙 통제',
  R9: '집중 마크',
  R10: '공략 측면',
  R11: '하프스페이스',
  R12: '측면 1:1',
  R13: '타깃맨 롱볼',
  TEMPO: '템포',
  LINE_FIT: '느린 수비 라인',
};

const r1 = (x: number) => Math.round(x);

/** 규칙 힌트 문장 (선수 매치업 수치 포함, 우리 관점). 1.3.0: 가능한 규칙마다 관련 수치를 붙인다 */
function reasonOf(id: RuleId, sign: 1 | -1, us: TeamView, them: TeamView): string {
  // att = 이 규칙의 수혜 측, def = 손해 측
  const [att, def] = sign > 0 ? [us, them] : [them, us];
  const who = sign > 0 ? '우리' : '상대';
  const other = sign > 0 ? '상대' : '우리';
  const n = RULE_NAME[id];
  switch (id) {
    case 'R1': {
      // 수혜 측이 압박 팀
      const nums = `압박 ${r1(att.units.PRS)} vs 빌드업 ${r1(def.units.BU)}`;
      return sign > 0 ? `${n}: 우리 압박이 상대의 짧은 빌드업을 노린다 (${nums})` : `${n}: 상대 압박에 짧은 빌드업이 걸린다 (${nums}) → 패스 길게·볼플레잉 CB 추천`;
    }
    case 'R2':
      return `${n}: ${who} 최고 러너 속도 ${r1(att.shape.pRun)} vs ${other} 최저 CB ${r1(def.shape.pCb)} (${other} 라인 ${def.instr.line >= 1 ? '높음' : '낮음'}, 배수 ×${paceMult(att, def).toFixed(1)})`;
    case 'R3': {
      // 수혜 측이 로우 블록(수비) 팀
      const nums = `박스 수비 ${r1(att.units.BOX)} vs 창의성 ${r1(def.units.CRE)}`;
      return sign > 0 ? `${n}: 상대의 짧은 패스는 우리 두 줄 앞에서 막힌다 (${nums})` : `${n}: 짧은 패스로는 박스 진입이 막힌다 (${nums}) → 폭·크로스·중거리 추천`;
    }
    case 'R4': {
      const o = sideOverload(att, def, 'L') >= sideOverload(att, def, 'R') ? 'L' : 'R';
      const d = o === 'L' ? 'R' : 'L';
      return `${n}: ${who} 측면 인원이 ${other}보다 많다 (${o === 'L' ? '왼쪽' : '오른쪽'} ${f1(att.shape.wA[o])} vs ${f1(def.shape.wD[d])}) → 크로스·컷백 ↑`;
    }
    case 'R5': {
      const nums = `러너 속도 ${r1(att.shape.pRun)} vs CB ${r1(def.shape.pCb)}`;
      return sign > 0 ? `${n}: 상대가 올라올수록 우리 역습 공간이 커진다 (${nums})` : `${n}: 공격 성향이 높아 상대 역습에 노출된다 (${nums}) → 앵커·성향 낮추기`;
    }
    case 'R6': {
      // 수혜 측이 트랩 팀, def 가 침투 팀
      const nums = `침투 숙련 ${r1(def.shape.runnerSkill)} vs 최저 CB 속도 ${r1(att.shape.pCbMin)}`;
      return sign > 0 ? `${n}: 상대 최전방 침투가 우리 트랩에 걸린다 (${nums})` : `${n}: 상대 트랩 (${nums}) → 폴스9·메짤라 등 2선 침투 추천`;
    }
    case 'R7':
      return `${n}: ${who} 중앙 유효 인원 우위 (${f1(att.shape.cA)} vs ${f1(def.shape.cD)}, 역할 기준)`;
    case 'R11':
      return `${n}: ${who} 하프스페이스 점유가 ${other} 커버보다 많다 (${f1(att.shape.hs)} vs ${f1(def.shape.hsC)})`;
    case 'R12': {
      const p = bestWingDuel(att, def);
      return `${n}: ${who} 윙어가 ${other} 윙백·공격형 풀백 뒤 공간에서 1:1${p ? ` (속도 ${p[0]} vs ${p[1]})` : ''}`;
    }
    case 'R13': {
      const t = att.shape.targetAer ?? 0;
      return `${n}: ${who} 타깃맨 공중 ${r1(t)} vs ${other} 공중 수비 ${r1(def.units.AER_D)}`;
    }
    case 'LINE_FIT':
      return `${n}: ${other} 수비가 느린데 라인이 높다 (${other} 수비 속도 ${r1(def.units.PACE_D)} vs 필요 ${EngineConstants.FIT_REQUIREMENTS.linePlus2PACE_D}, CB ${r1(def.shape.pCb)} vs 필요 ${EngineConstants.RULES.LINE_FIT.cbPaceRequired})`;
    default:
      return `${n}: ${who} 유리`;
  }
}

const f1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

/** R12 표시용: att 윙어 vs def 맞은편 측면 수비수 속도 차가 가장 큰 쌍 [윙어, 수비수] (1~20) */
function bestWingDuel(att: TeamView, def: TeamView): [number, number] | null {
  let best: [number, number] | null = null;
  for (const s of ['L', 'R'] as const) {
    const w = att.shape.wing[s];
    const d = def.shape.sideBack[s === 'L' ? 'R' : 'L'];
    if (!w || !d) continue;
    const pair: [number, number] = [r1(eff(w, 'pace') / 5), r1(eff(d, 'pace') / 5)];
    if (!best || pair[0] - pair[1] > best[0] - best[1]) best = pair;
  }
  return best;
}

/** getMatchupPreview 본체: 규칙 힌트(크기 S/M/L)와 전체 판정 −2~+2 */
export function matchupPreview(us: TeamView, them: TeamView): { rules: MatchupRuleHint[]; styleEdge: -2 | -1 | 0 | 1 | 2; total: number } {
  const fires = matchupFires(us, them);
  const byKey = new Map<string, Fire>();
  for (const f of fires) {
    const k = `${f.id}|${f.dp}`;
    const cur = byKey.get(k);
    if (cur) cur.xg += f.xg;
    else byKey.set(k, { ...f });
  }
  // 규칙별로 가장 큰 DP 하나만 대표로 (이유 문장이 규칙 단위)
  const byRule = new Map<RuleId, { dp: DP; xg: number; total: number }>();
  for (const f of byKey.values()) {
    const cur = byRule.get(f.id);
    if (!cur) byRule.set(f.id, { dp: f.dp, xg: f.xg, total: f.xg });
    else {
      cur.total += f.xg;
      if (Math.abs(f.xg) > Math.abs(cur.xg)) {
        cur.dp = f.dp;
        cur.xg = f.xg;
      }
    }
  }
  const total = fires.reduce((a, f) => a + f.xg, 0);
  const rules: MatchupRuleHint[] = [...byRule.entries()]
    .filter(([, v]) => Math.abs(v.total) >= 0.01)
    .sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total))
    .slice(0, 6)
    .map(([id, v]) => {
      const sign: 1 | -1 = v.total > 0 ? 1 : -1;
      const a = Math.abs(v.total);
      return { id, dp: v.dp, sign, size: a >= 0.08 ? 'L' : a >= 0.03 ? 'M' : 'S', reason: reasonOf(id, sign, us, them) };
    });
  const e = clamp(Math.round(total / 0.06), -2, 2) as -2 | -1 | 0 | 1 | 2;
  return { rules, styleEdge: e, total };
}


/** 스타일 적합도 (실축구_전술설계 1.3): fit = min(1, Π 요구 미달 항목의 실제/요구). players 는 스타일 포메이션 슬롯 순 */
export function styleFitOf(style: StyleId, players: readonly (EnginePlayer | undefined)[]): StyleFit {
  const d = STYLES[style];
  const v = staticView('fit', { formation: d.formation, instructions: d.instructions, roles: d.roles }, players);
  const actual = (k: StyleRequirementKey): number => {
    switch (k) {
      case 'P_CB_MIN':
        return v.shape.pCbMin;
      case 'TARGET_MAN':
        return v.shape.targetAer ?? 0;
      case 'SIDE_A':
        return (v.units.SIDE_A_L + v.units.SIDE_A_R) / 2;
      default:
        return v.units[k];
    }
  };
  let fit = 1;
  const missing: StyleFit['missing'] = [];
  for (const r of d.requirements) {
    const a = actual(r.key);
    if (a < r.min) {
      fit *= Math.max(0, a) / r.min;
      missing.push({ key: r.key, label: r.label, actual: Math.round(a * 10) / 10, required: r.min });
    }
  }
  fit = Math.min(1, fit);
  // 1.3.0: 요구치 미달 항목이 하나라도 있으면 fit 이 0.95 이상이어도 최대 OK
  const level: StyleFit['level'] = fit >= 0.95 && missing.length === 0 ? 'GOOD' : fit >= 0.8 ? 'OK' : 'POOR';
  return { styleId: style, fit: Math.round(fit * 1000) / 1000, level, missing };
}
