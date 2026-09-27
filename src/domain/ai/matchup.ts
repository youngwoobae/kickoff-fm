/**
 * 전술 상성 휴리스틱 (감독 AI 슬롯 선택·상대 분석·보정 배치 "최선 카운터" 참고용). 소유: A.
 * 엔진 규칙(8.6)의 발동 조건을 선수 능력 없이 지시·포메이션만으로 근사한다. 경기 결과에는 쓰지 않는다.
 */
import type { FormationId, RoleId, RuleId, TeamInstructions } from '../../types';
import { FORMATIONS } from '../../engine';

export interface TacticShape {
  formation: FormationId;
  instructions: TeamInstructions;
  roles?: RoleId[];
}

/** 우리(us) 관점 규칙별 예상 가산치 합 (+ 우리 유리). 대략적인 신호일 뿐이다 */
export function tacticEdge(us: TacticShape, them: TacticShape): Partial<Record<RuleId, number>> {
  const out: Partial<Record<RuleId, number>> = {};
  const add = (r: RuleId, v: number) => {
    if (v !== 0) out[r] = (out[r] ?? 0) + v;
  };
  const u = us.instructions;
  const t = them.instructions;
  const fu = FORMATIONS[us.formation];
  const ft = FORMATIONS[them.formation];
  const has = (s: TacticShape, r: RoleId) => (s.roles ?? []).includes(r);
  // R1: 압박 vs 짧은 빌드업
  if (t.press >= 1 && u.directness <= 0) add('R1', -0.1 * t.press);
  if (u.press >= 1 && t.directness <= 0) add('R1', 0.1 * u.press);
  // R2: 롱볼 우회 vs 높은 라인
  if (u.directness >= 1 && t.line >= 1) add('R2', 0.1 * u.directness);
  if (t.directness >= 1 && u.line >= 1) add('R2', -0.1 * t.directness);
  if (u.directness >= 1 && t.line <= -1) add('R2', -0.08 * u.directness * -t.line);
  if (t.directness >= 1 && u.line <= -1) add('R2', 0.08 * t.directness * -u.line);
  // R3: 낮은 블록 vs 점유
  if (t.line <= -1 && t.mentality <= 0 && u.directness <= -1) add('R3', -0.2);
  if (u.line <= -1 && u.mentality <= 0 && t.directness <= -1) add('R3', 0.2);
  // R4: 폭 vs 좁은 수비
  if (u.width >= 1 && (t.width <= -1 || ft.isNarrow)) add('R4', 0.15);
  if (t.width >= 1 && (u.width <= -1 || fu.isNarrow)) add('R4', -0.15);
  // R5: 공격 성향 과잉 vs 역습
  if (u.mentality >= 1 && t.counter) add('R5', -0.2);
  if (t.mentality >= 1 && u.counter) add('R5', 0.2);
  if (u.mentality >= 1) add('R5', 0.12 * u.mentality);
  if (t.mentality >= 1) add('R5', -0.12 * t.mentality);
  // R6: 오프사이드 트랩 vs 침투형
  if (t.offsideTrap && has(us, 'ST_POACHER')) add('R6', -0.15);
  if (u.offsideTrap && has(them, 'ST_POACHER')) add('R6', 0.15);
  // R7: 중원 수적 우위
  add('R7', 0.1 * (fu.centralMidfielders - ft.centralMidfielders));
  return out;
}

export function tacticEdgeTotal(us: TacticShape, them: TacticShape): number {
  return Object.values(tacticEdge(us, them)).reduce((a, b) => a + (b ?? 0), 0);
}
