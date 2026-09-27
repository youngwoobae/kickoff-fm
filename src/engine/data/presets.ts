/** 팀 지시 프리셋 5종 (10.5.2)과 규칙 카탈로그 문구. 소유: A. */
import type { PresetDef, PresetId, RuleDef, RuleId, TeamInstructions } from '../../types';

export const NEUTRAL_INSTRUCTIONS: TeamInstructions = {
  mentality: 0,
  press: 0,
  line: 0,
  width: 0,
  tempo: 0,
  directness: 0,
  counter: false,
  offsideTrap: false,
};

export const PRESETS: Record<PresetId, PresetDef> = {
  BALANCED: { id: 'BALANCED', label: '균형', instructions: { ...NEUTRAL_INSTRUCTIONS } },
  POSSESSION: {
    id: 'POSSESSION',
    label: '점유',
    instructions: { mentality: 1, press: 1, line: 1, width: 1, tempo: -1, directness: -2, counter: false, offsideTrap: false },
  },
  COUNTER: {
    id: 'COUNTER',
    label: '역습',
    instructions: { mentality: -1, press: -1, line: -1, width: 0, tempo: 1, directness: 2, counter: true, offsideTrap: false },
  },
  HIGH_PRESS: {
    id: 'HIGH_PRESS',
    label: '전방압박',
    instructions: { mentality: 1, press: 2, line: 2, width: 0, tempo: 1, directness: 0, counter: false, offsideTrap: true },
  },
  LOW_BLOCK: {
    id: 'LOW_BLOCK',
    label: '잠그기',
    instructions: { mentality: -1, press: -1, line: -2, width: -1, tempo: -1, directness: -1, counter: true, offsideTrap: false },
  },
};

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

export const RULE_DEFS: Record<RuleId, RuleDef> = {
  R1: { id: 'R1', label: '전방 압박이 약한 빌드업을 공략', counter: '패스 길게 / 볼플레잉 CB' },
  R2: { id: 'R2', label: '롱볼·침투로 압박 우회', counter: '라인 내리기 / 스위퍼 키퍼' },
  R3: { id: 'R3', label: '낮은 블록이 점유 축구를 질식', counter: '폭 넓히기 / 타깃맨' },
  R4: { id: 'R4', label: '폭으로 좁은 수비 벌리기', counter: '5백 / 수비형 풀백 / 폭 넓히기' },
  R5: { id: 'R5', label: '공격 성향 과잉을 역습으로 처벌', counter: '공격 성향 낮추기 / 앵커 DM' },
  R6: { id: 'R6', label: '오프사이드 트랩 vs 침투형', counter: '가짜 9번 / 템포 느리게' },
  R7: { id: 'R7', label: '중원 수적 우위', counter: '중앙 MF 가 많은 포메이션' },
  R9: { id: 'R9', label: '집중 마크', counter: '대상 선수 역할 변경 / 측면 공격' },
  R10: { id: 'R10', label: '공략 측면', counter: '해당 측 수비형 풀백 / 5백' },
  TEMPO: { id: 'TEMPO', label: '템포와 턴오버', counter: '템포 낮추기' },
  LINE_FIT: { id: 'LINE_FIT', label: '느린 수비의 높은 라인', counter: '라인 낮추기 / 빠른 수비수' },
};

export const RULE_IDS = Object.keys(RULE_DEFS) as RuleId[];
