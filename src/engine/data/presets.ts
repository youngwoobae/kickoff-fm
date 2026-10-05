/**
 * 실제 전술 스타일 9종(실축구_전술설계 1장)과 규칙 카탈로그 문구. 소유: A.
 * 기존 프리셋 ID 5종은 유지하고 라벨·값만 실제 스타일로 바꿨다(POSSESSION = 포지셔널, COUNTER = 미드 블록 역습, HIGH_PRESS = 게겐프레싱).
 */
import type { BotStyle, BotStyleTag, PresetDef, PresetId, RoleId, RuleDef, RuleId, StyleDef, StyleId, TeamInstructions } from '../../types';

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

type I = [m: number, p: number, l: number, w: number, t: number, d: number, counter?: boolean, trap?: boolean];
function ins([m, p, l, w, t, d, counter = false, trap = false]: I): TeamInstructions {
  return { mentality: m, press: p, line: l, width: w, tempo: t, directness: d, counter, offsideTrap: trap } as TeamInstructions;
}

/** 스타일 순서 = 상성 행렬 순서 (BAL, GP, POS, LB, MBC, DIR, WNG, HL, WB3) */
export const STYLE_IDS: StyleId[] = ['BALANCED', 'HIGH_PRESS', 'POSSESSION', 'LOW_BLOCK', 'COUNTER', 'DIRECT', 'WING_PLAY', 'HIGH_LINE', 'WINGBACK_3'];

/**
 * 설계 2.5 기대 상성 행렬 (행 팀 관점 승 − 패). 2 = ++, 1 = +, 0 = 0, −1 = −, −2 = −−.
 * STYLE_MATRIX 부호 일치율 검증과 StyleDef.goodAgainst/badAgainst 의 원천.
 */
export const STYLE_MATRIX_EXPECTED: Record<StyleId, Record<StyleId, number>> = (() => {
  const rows: number[][] = [
    [0, -1, -1, 0, 1, 1, 0, -1, 0],
    [1, 0, 1, -1, -1, -2, 1, 0, 1],
    [1, -1, 0, -2, 0, 1, 1, -1, 0],
    [0, 1, 2, 0, 0, -1, -2, 1, -1],
    [-1, 1, 0, 0, 0, 0, 1, 1, -1],
    [-1, 2, -1, 1, 0, 0, 0, 1, -1],
    [0, -1, -1, 2, -1, 0, 0, 0, 1],
    [1, 0, 1, -1, -1, -1, 0, 0, 1],
    [0, -1, 0, 1, 1, 1, -1, -1, 0],
  ];
  const out = {} as Record<StyleId, Record<StyleId, number>>;
  STYLE_IDS.forEach((r, i) => {
    out[r] = {} as Record<StyleId, number>;
    STYLE_IDS.forEach((c, j) => (out[r][c] = rows[i]![j]!));
  });
  return out;
})();

function ranked(id: StyleId, dir: 1 | -1): StyleId[] {
  return STYLE_IDS.filter((o) => o !== id && dir * STYLE_MATRIX_EXPECTED[id][o] > 0)
    .sort((a, b) => dir * (STYLE_MATRIX_EXPECTED[id][b] - STYLE_MATRIX_EXPECTED[id][a]))
    .slice(0, 2);
}

type StyleSpec = Omit<StyleDef, 'goodAgainst' | 'badAgainst' | 'instructions'> & { i: I };
const R = (...r: RoleId[]) => r;

const SPECS: StyleSpec[] = [
  {
    id: 'BALANCED',
    label: '균형',
    realModel: '공수 균형형 4-2-3-1',
    summary: '특정 국면에 치우치지 않는 더블 피벗 4-2-3-1',
    principle: '더블 피벗이 하프스페이스와 역습을 모두 막는다. 스스로 켜는 큰 이득은 없지만 큰 약점도 없다.',
    i: [0, 0, 0, 0, 0, 0],
    formation: '4-2-3-1',
    roles: R('GK_TRADITIONAL', 'FB_OVERLAPPING', 'CB_STOPPER', 'CB_BALL_PLAYING', 'FB_DEFENSIVE', 'DM_ANCHOR', 'CM_BOX_TO_BOX', 'W_WINGER', 'AM_PLAYMAKER', 'W_INSIDE_FORWARD', 'ST_ADVANCED_FORWARD'),
    requirements: [],
    strengths: ['R7', 'R11'],
    weaknesses: ['R1'],
    drainExtra: 0,
    staminaCost: 1,
  },
  {
    id: 'HIGH_PRESS',
    label: '게겐프레싱',
    realModel: '전방 압박으로 공을 되찾는 팀',
    summary: '잃자마자 되찾는 역압박, 높은 위치의 탈취가 곧 찬스',
    principle: '짧게 빌드업하는 상대를 질식시키고 탈취 직후 역습한다. 압박을 한 번에 넘기는 롱볼과 뒷공간에 약하고 후반 체력이 떨어진다.',
    i: [1, 2, 1, 0, 2, 1, true],
    formation: '4-3-3',
    roles: R('GK_SWEEPER', 'FB_OVERLAPPING', 'CB_COVER', 'CB_BALL_PLAYING', 'FB_OVERLAPPING', 'DM_BALL_WINNER', 'CM_BOX_TO_BOX', 'CM_BOX_TO_BOX', 'W_INSIDE_FORWARD', 'ST_PRESSING_FORWARD', 'W_INSIDE_FORWARD'),
    requirements: [
      { key: 'PRS', min: 65, label: '압박(PRS) 65' },
      { key: 'PACE_D', min: 60, label: '수비 속도(PACE_D) 60' },
    ],
    strengths: ['R1', 'R5'],
    weaknesses: ['R2', 'R13', 'LINE_FIT'],
    drainExtra: 8,
    staminaCost: 4,
  },
  {
    id: 'POSSESSION',
    label: '포지셔널 플레이',
    realModel: '짧은 패스로 점유하는 팀',
    summary: '5레인 점유와 하프스페이스 과부하 (티키타카)',
    principle: '인버티드 풀백과 메짤라로 중앙 수적 우위를 만들고 공을 오래 가진다. 깊은 블록 앞에서는 박스 안 공간을 못 찾고, 잃으면 높은 라인 뒤가 빈다.',
    i: [1, 1, 1, 1, -1, -2],
    formation: '4-3-3',
    roles: R('GK_SWEEPER', 'FB_INVERTED', 'CB_BALL_PLAYING', 'CB_BALL_PLAYING', 'FB_OVERLAPPING', 'DM_REGISTA', 'CM_MEZZALA', 'CM_DEEP_PLAYMAKER', 'W_INVERTED_WINGER', 'ST_FALSE_NINE', 'W_INSIDE_FORWARD'),
    requirements: [
      { key: 'BU', min: 65, label: '빌드업(BU) 65' },
      { key: 'CTRL', min: 65, label: '점유(CTRL) 65' },
    ],
    strengths: ['R7', 'R11'],
    weaknesses: ['R3', 'R5', 'R2', 'R1'],
    drainExtra: 3,
    staminaCost: 2,
  },
  {
    id: 'LOW_BLOCK',
    label: '로우 블록',
    realModel: '깊게 내려앉아 지키는 팀',
    summary: '박스 앞 두 줄로 중앙·뒷공간을 지우고 역습',
    principle: '5백 두 줄로 중앙·하프스페이스·뒷공간을 모두 지운다. 측면 크로스·중거리·세트피스에 약하고 코너를 많이 준다.',
    i: [-1, -1, -2, -1, -1, 1, true],
    formation: '5-3-2',
    roles: R('GK_TRADITIONAL', 'FB_DEFENSIVE', 'CB_STOPPER', 'CB_COVER', 'CB_STOPPER', 'FB_DEFENSIVE', 'CM_BOX_TO_BOX', 'DM_ANCHOR', 'CM_BOX_TO_BOX', 'ST_TARGET', 'ST_ADVANCED_FORWARD'),
    requirements: [
      { key: 'BOX', min: 65, label: '박스 수비(BOX) 65' },
      { key: 'AER_D', min: 60, label: '공중 수비(AER_D) 60' },
    ],
    strengths: ['R3', 'R2'],
    weaknesses: ['R4', 'R13'],
    drainExtra: -2,
    staminaCost: 1,
  },
  {
    id: 'COUNTER',
    label: '미드 블록 역습',
    realModel: '중원에서 기다렸다 역습하는 팀',
    summary: '중앙선 두 줄로 기다리다 빠른 공격수에게 수직 패스',
    principle: '상대가 올라올수록 뒷공간이 커진다. 빠른 러너가 핵심이며, 내려앉아 공을 주는 상대에게는 공략할 공간이 없다.',
    i: [-1, 0, 0, 0, 1, 1, true],
    formation: '4-4-2',
    roles: R('GK_TRADITIONAL', 'FB_DEFENSIVE', 'CB_COVER', 'CB_STOPPER', 'FB_DEFENSIVE', 'W_WIDE_MIDFIELDER', 'CM_BOX_TO_BOX', 'DM_BALL_WINNER', 'W_WIDE_MIDFIELDER', 'ST_ADVANCED_FORWARD', 'ST_PRESSING_FORWARD'),
    requirements: [
      { key: 'PACE_A', min: 65, label: '공격 속도(PACE_A) 65' },
      { key: 'MID', min: 60, label: '중원 수비(MID) 60' },
    ],
    strengths: ['R5', 'R2'],
    weaknesses: ['R7'],
    drainExtra: 1,
    staminaCost: 2,
  },
  {
    id: 'DIRECT',
    label: '다이렉트 롱볼',
    realModel: '롱볼과 세컨드볼로 싸우는 팀',
    summary: '빌드업을 건너뛰고 타깃맨에게 길게, 세컨드볼 싸움',
    principle: '압박하는 팀에 가장 강하다. 타깃맨이 공중볼을 따내고 중원이 세컨드볼을 줍는다. 키 큰 CB·3백 앞에서는 공만 준다.',
    i: [0, 0, 0, 1, 1, 2],
    formation: '4-4-2',
    roles: R('GK_TRADITIONAL', 'FB_DEFENSIVE', 'CB_STOPPER', 'CB_STOPPER', 'FB_DEFENSIVE', 'W_WIDE_MIDFIELDER', 'DM_BALL_WINNER', 'CM_BOX_TO_BOX', 'W_WINGER', 'ST_TARGET', 'ST_POACHER'),
    requirements: [{ key: 'TARGET_MAN', min: 65, label: '타깃맨 공중전 65' }],
    strengths: ['R13', 'R2'],
    weaknesses: ['R7'],
    drainExtra: 1,
    staminaCost: 2,
  },
  {
    id: 'WING_PLAY',
    label: '윙 플레이',
    realModel: '측면 크로스 중심의 4-4-2',
    summary: '폭을 최대로 벌려 측면 2 대 1, 크로스·컷백',
    principle: '좁은 수비를 측면 과부하로 벌린다. 풀백이 올라가 역습 뒷공간이 생기고 중앙 인원이 부족하다.',
    i: [1, 0, 0, 2, 0, 0],
    formation: '4-4-2',
    roles: R('GK_TRADITIONAL', 'FB_OVERLAPPING', 'CB_STOPPER', 'CB_BALL_PLAYING', 'FB_OVERLAPPING', 'W_WINGER', 'CM_BOX_TO_BOX', 'CM_DEEP_PLAYMAKER', 'W_WINGER', 'ST_TARGET', 'ST_POACHER'),
    requirements: [
      { key: 'SIDE_A', min: 60, label: '측면 공격(SIDE_A) 60' },
      { key: 'AER_A', min: 55, label: '공중 공격(AER_A) 55' },
    ],
    strengths: ['R4', 'R12'],
    weaknesses: ['R5', 'R7'],
    drainExtra: 2,
    staminaCost: 2,
  },
  {
    id: 'HIGH_LINE',
    label: '하이 라인 트랩',
    realModel: '라인을 높여 오프사이드를 노리는 팀',
    summary: '라인을 하프라인까지 올려 압축, 최전방 침투는 오프사이드',
    principle: '경기장을 좁혀 상대 중원을 질식시킨다. 라인 뒤가 비어 빠른 러너·2선 침투에 무너진다. 수비수 속도가 필수다.',
    i: [0, 1, 2, 0, 0, 0, false, true],
    formation: '4-3-3',
    roles: R('GK_SWEEPER', 'FB_DEFENSIVE', 'CB_COVER', 'CB_BALL_PLAYING', 'FB_DEFENSIVE', 'DM_ANCHOR', 'CM_BOX_TO_BOX', 'AM_PLAYMAKER', 'W_WINGER', 'ST_PRESSING_FORWARD', 'W_INSIDE_FORWARD'),
    requirements: [
      { key: 'P_CB_MIN', min: 13, label: 'CB 최저 속도 13' },
      { key: 'PACE_D', min: 65, label: '수비 속도(PACE_D) 65' },
    ],
    strengths: ['R6', 'R7'],
    weaknesses: ['R2', 'LINE_FIT'],
    drainExtra: 4,
    staminaCost: 3,
  },
  {
    id: 'WINGBACK_3',
    label: '3백 윙백',
    realModel: '3백과 윙백으로 폭을 쓰는 팀',
    summary: '3CB + 2윙백, 공격 3-2-5 / 수비 5백',
    principle: '3CB 가 상대 2톱에 수적 우위를 갖고 윙백이 폭을 맡는다. 윙백 뒤 공간(윙어 1:1)과 윙백 체력이 약점이다.',
    i: [0, 1, 0, 2, 0, 0, true],
    formation: '3-4-3',
    roles: R('GK_TRADITIONAL', 'CB_STOPPER', 'CB_BALL_PLAYING', 'CB_COVER', 'WB_WINGBACK', 'CM_BOX_TO_BOX', 'DM_ANCHOR', 'WB_WINGBACK', 'AM_SHADOW_STRIKER', 'ST_ADVANCED_FORWARD', 'AM_SHADOW_STRIKER'),
    requirements: [{ key: 'SIDE_A', min: 60, label: '측면 공격(SIDE_A) 60' }],
    strengths: ['R4', 'R11'],
    weaknesses: ['R12', 'R1'],
    drainExtra: 3,
    staminaCost: 3,
  },
];

export const STYLES = Object.fromEntries(
  SPECS.map(({ i, ...s }) => [s.id, { ...s, instructions: ins(i), goodAgainst: ranked(s.id, 1), badAgainst: ranked(s.id, -1) } satisfies StyleDef]),
) as Record<StyleId, StyleDef>;

/** 기존 프리셋 5종 (지시값만, 계약 PresetDef). 라벨·값은 STYLES 와 같다 */
export const PRESETS = Object.fromEntries(
  (['BALANCED', 'POSSESSION', 'COUNTER', 'HIGH_PRESS', 'LOW_BLOCK'] as PresetId[]).map((id) => [id, { id, label: STYLES[id].label, instructions: { ...STYLES[id].instructions } }]),
) as Record<PresetId, PresetDef>;

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

/** BotStyle(8종) → 레거시 표시 태그(5종) */
export function legacyBotTag(style: BotStyle): BotStyleTag {
  switch (style) {
    case 'DIRECT':
      return 'COUNTER';
    case 'HIGH_LINE':
      return 'HIGH_PRESS';
    case 'WING_PLAY':
    case 'WINGBACK_3':
      return 'WIDE';
    default:
      return style;
  }
}

/** 지시값에서 가장 가까운 스타일 (슬라이더 L1 거리 + 토글) */
export function nearestStyle(i: TeamInstructions): { id: StyleId; exact: boolean } {
  let best: StyleId = 'BALANCED';
  let bd = Infinity;
  for (const id of STYLE_IDS) {
    const s = STYLES[id].instructions;
    const d =
      Math.abs(s.mentality - i.mentality) +
      Math.abs(s.press - i.press) +
      Math.abs(s.line - i.line) +
      Math.abs(s.width - i.width) +
      Math.abs(s.tempo - i.tempo) +
      Math.abs(s.directness - i.directness) +
      (s.counter !== i.counter ? 1 : 0) +
      (s.offsideTrap !== i.offsideTrap ? 1 : 0);
    if (d < bd) {
      bd = d;
      best = id;
    }
  }
  return { id: best, exact: bd === 0 };
}

export const RULE_DEFS: Record<RuleId, RuleDef> = {
  R1: { id: 'R1', label: '압박 vs 짧은 빌드업', counter: '패스 길게 / 볼플레잉 CB·레지스타 / 3백', why: '짧게 푸는 팀은 압박에 걸리면 자기 진영에서 공을 잃는다' },
  R2: { id: 'R2', label: '뒷공간 (가장 빠른 러너 vs 가장 느린 CB)', counter: '라인 내리기 / 커버 CB / 스위퍼 키퍼', why: '라인이 높으면 CB 뒤가 넓고, 한 명의 느린 CB 가 약점이 된다' },
  R3: { id: 'R3', label: '로우 블록이 짧은 패스를 질식', counter: '폭·크로스 / 타깃맨 / 중거리 슈터', why: '깊은 두 줄 앞에서는 박스 안에 들어갈 공간이 없다' },
  R4: { id: 'R4', label: '측면 과부하', counter: '5백 / 수비형 풀백 / 와이드 미드필더', why: '측면 인원이 더 많으면 2 대 1 로 크로스·컷백이 산다' },
  R5: { id: 'R5', label: '공격 성향 ↔ 역습', counter: '성향 낮추기 / 앵커 / 인버티드 풀백', why: '많이 올라가면 공을 잃었을 때 뒤에 남는 인원이 적다' },
  R6: { id: 'R6', label: '오프사이드 트랩', counter: '폴스9 / 메짤라 / 섀도 스트라이커', why: '최전방 침투는 트랩에 걸리지만 2선에서 늦게 뛰는 선수는 잡기 어렵다' },
  R7: { id: 'R7', label: '중앙 통제 (역할 유효 인원)', counter: '중앙 인원이 많은 역할 / 2톱 커버 / 패스 길게', why: '중앙에 한 명 더 있으면 패스 길이 하나 더 생긴다' },
  R9: { id: 'R9', label: '집중 마크', counter: '대상 선수 역할 변경 / 측면 공격', why: '핵심 선수 한 명을 지우면 공격이 막힌다' },
  R10: { id: 'R10', label: '공략 측면', counter: '해당 측 수비형 풀백 / 5백', why: '약한 측면을 집중 공략한다' },
  R11: { id: 'R11', label: '하프스페이스 과부하', counter: '5백·3백 / 더블 피벗 / 앵커', why: '풀백과 CB 사이 채널에 선수가 서면 4백은 누가 맡을지 정하지 못한다' },
  R12: { id: 'R12', label: '측면 1:1 (윙백 뒤 공간)', counter: '수비형 풀백 / 성향 −1 / 와이드 미드필더', why: '윙백·공격형 풀백이 올라가면 그 뒤에 윙어가 1:1 로 남는다' },
  R13: { id: 'R13', label: '타깃맨 롱볼·세컨드볼', counter: '스토퍼 CB(공중전) / 3백', why: '압박을 넘어 곧장 타깃맨 머리로, 세컨드볼은 중원이 줍는다' },
  TEMPO: { id: 'TEMPO', label: '템포와 턴오버', counter: '템포 낮추기', why: '빠를수록 리셋이 어렵다' },
  LINE_FIT: { id: 'LINE_FIT', label: '느린 수비의 높은 라인', counter: '라인 낮추기 / 커버 CB', why: '느린 수비수로 라인을 올리면 스루패스·역습에 무너진다' },
};

export const RULE_IDS = Object.keys(RULE_DEFS) as RuleId[];
