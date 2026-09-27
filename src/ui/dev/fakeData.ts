/**
 * 가짜 서비스용 고정 카탈로그·이름 생성기 (소유: B, 개발 전용).
 * 실제 수치는 백엔드(engine/data)가 정한다. 여기 값은 화면 개발용 근사치다.
 */
import type {
  AttrDef,
  AttrKey,
  BotStyleTag,
  Catalog,
  FitLevel,
  FormationDef,
  FormationId,
  FormationSlot,
  Lane,
  Position,
  PresetDef,
  PresetId,
  RoleDef,
  RoleId,
  RuleDef,
  TeamInstructions,
} from '../../types';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const ROLES_BY_POS: Record<Position, RoleId[]> = {
  GK: ['GK_TRADITIONAL', 'GK_SWEEPER'],
  CB: ['CB_STOPPER', 'CB_BALL_PLAYING'],
  FB: ['FB_DEFENSIVE', 'FB_OVERLAPPING'],
  DM: ['DM_ANCHOR', 'CM_BOX_TO_BOX'],
  CM: ['CM_BOX_TO_BOX', 'DM_ANCHOR', 'AM_PLAYMAKER'],
  AM: ['AM_PLAYMAKER', 'ST_FALSE_NINE'],
  W: ['W_WINGER', 'W_INSIDE_FORWARD'],
  ST: ['ST_POACHER', 'ST_TARGET', 'ST_FALSE_NINE'],
};

function mkFormation(
  id: FormationId,
  label: string,
  spec: [Position, Lane][],
  centralMidfielders: number,
  backLine: 3 | 4 | 5,
  isNarrow: boolean,
): FormationDef {
  const slots: FormationSlot[] = spec.map(([position, lane], index) => {
    const roles = ROLES_BY_POS[position];
    return { index, position, lane, allowedRoles: roles, defaultRole: roles[0] ?? 'CM_BOX_TO_BOX' };
  });
  return { id, label, slots, centralMidfielders, backLine, isNarrow };
}

export const FORMATIONS: FormationDef[] = [
  mkFormation(
    '4-4-2',
    '4-4-2',
    [
      ['GK', 'C'], ['FB', 'L'], ['CB', 'L'], ['CB', 'R'], ['FB', 'R'],
      ['W', 'L'], ['CM', 'L'], ['CM', 'R'], ['W', 'R'], ['ST', 'L'], ['ST', 'R'],
    ],
    2, 4, false,
  ),
  mkFormation(
    '4-4-2D',
    '4-4-2 다이아몬드',
    [
      ['GK', 'C'], ['FB', 'L'], ['CB', 'L'], ['CB', 'R'], ['FB', 'R'],
      ['DM', 'C'], ['CM', 'L'], ['CM', 'R'], ['AM', 'C'], ['ST', 'L'], ['ST', 'R'],
    ],
    4, 4, true,
  ),
  mkFormation(
    '4-3-3',
    '4-3-3',
    [
      ['GK', 'C'], ['FB', 'L'], ['CB', 'L'], ['CB', 'R'], ['FB', 'R'],
      ['DM', 'C'], ['CM', 'L'], ['CM', 'R'], ['W', 'L'], ['ST', 'C'], ['W', 'R'],
    ],
    3, 4, false,
  ),
  mkFormation(
    '4-2-3-1',
    '4-2-3-1',
    [
      ['GK', 'C'], ['FB', 'L'], ['CB', 'L'], ['CB', 'R'], ['FB', 'R'],
      ['DM', 'L'], ['DM', 'R'], ['W', 'L'], ['AM', 'C'], ['W', 'R'], ['ST', 'C'],
    ],
    3, 4, false,
  ),
  mkFormation(
    '3-5-2',
    '3-5-2',
    [
      ['GK', 'C'], ['CB', 'L'], ['CB', 'C'], ['CB', 'R'], ['FB', 'L'],
      ['DM', 'C'], ['CM', 'L'], ['CM', 'R'], ['FB', 'R'], ['ST', 'L'], ['ST', 'R'],
    ],
    3, 3, true,
  ),
  mkFormation(
    '5-3-2',
    '5-3-2',
    [
      ['GK', 'C'], ['FB', 'L'], ['CB', 'L'], ['CB', 'C'], ['CB', 'R'], ['FB', 'R'],
      ['CM', 'L'], ['DM', 'C'], ['CM', 'R'], ['ST', 'L'], ['ST', 'R'],
    ],
    3, 5, false,
  ),
];

const ROLES: RoleDef[] = [
  { id: 'GK_TRADITIONAL', position: 'GK', label: '전통형 골키퍼', keyAttrs: ['reflexes', 'aerialCommand'], summary: '골문을 지키는 데 집중' },
  { id: 'GK_SWEEPER', position: 'GK', label: '스위퍼 키퍼', keyAttrs: ['kicking', 'pace'], summary: '높은 라인 뒷공간 커버, 롱볼 우회 약화' },
  { id: 'CB_STOPPER', position: 'CB', label: '스토퍼', keyAttrs: ['tackling', 'physical'], summary: '전진해서 공을 끊는 수비수' },
  { id: 'CB_BALL_PLAYING', position: 'CB', label: '빌드업형 센터백', keyAttrs: ['passing', 'composure'], summary: '후방 빌드업 기여' },
  { id: 'FB_DEFENSIVE', position: 'FB', label: '수비형 풀백', keyAttrs: ['tackling', 'positioning'], summary: '측면 수비 우선' },
  { id: 'FB_OVERLAPPING', position: 'FB', label: '오버래핑 풀백', keyAttrs: ['crossing', 'stamina'], summary: '측면 공격 가담, 크로스 증가' },
  { id: 'DM_ANCHOR', position: 'DM', label: '앵커', keyAttrs: ['positioning', 'tackling'], summary: '수비 앞 보호, 역습 차단' },
  { id: 'CM_BOX_TO_BOX', position: 'CM', label: '박스투박스', keyAttrs: ['workRate', 'stamina'], summary: '공수 전 구역 활동, 체력 소모 큼' },
  { id: 'AM_PLAYMAKER', position: 'AM', label: '플레이메이커', keyAttrs: ['vision', 'passing'], summary: '찬스 창출, 롱패스 찬스 증가' },
  { id: 'W_WINGER', position: 'W', label: '윙어', keyAttrs: ['pace', 'crossing'], summary: '측면 돌파 후 크로스' },
  { id: 'W_INSIDE_FORWARD', position: 'W', label: '인사이드 포워드', keyAttrs: ['dribbling', 'finishing'], summary: '안쪽으로 파고들어 컷백·슈팅' },
  { id: 'ST_TARGET', position: 'ST', label: '타깃맨', keyAttrs: ['physical', 'finishing'], summary: '공중볼 경합, 크로스 목표' },
  { id: 'ST_POACHER', position: 'ST', label: '침투형 스트라이커', keyAttrs: ['pace', 'positioning'], summary: '수비 뒷공간 침투' },
  { id: 'ST_FALSE_NINE', position: 'ST', label: '가짜 9번', keyAttrs: ['vision', 'dribbling'], summary: '내려와서 연결, 중원 숫자 추가' },
];

const I = (
  mentality: TeamInstructions['mentality'],
  press: TeamInstructions['press'],
  line: TeamInstructions['line'],
  width: TeamInstructions['width'],
  tempo: TeamInstructions['tempo'],
  directness: TeamInstructions['directness'],
  counter = false,
  offsideTrap = false,
): TeamInstructions => ({ mentality, press, line, width, tempo, directness, counter, offsideTrap });

export const PRESET_INSTR: Record<PresetId, TeamInstructions> = {
  BALANCED: I(0, 0, 0, 0, 0, 0),
  POSSESSION: I(0, 1, 1, 1, -1, -2),
  COUNTER: I(-1, -1, -1, 0, 1, 1, true),
  HIGH_PRESS: I(1, 2, 2, 0, 1, 0, false, true),
  LOW_BLOCK: I(-2, -1, -2, -1, -1, 1, true),
};

const PRESETS: PresetDef[] = [
  { id: 'BALANCED', label: '균형', instructions: PRESET_INSTR.BALANCED },
  { id: 'POSSESSION', label: '점유', instructions: PRESET_INSTR.POSSESSION },
  { id: 'COUNTER', label: '역습', instructions: PRESET_INSTR.COUNTER },
  { id: 'HIGH_PRESS', label: '전방압박', instructions: PRESET_INSTR.HIGH_PRESS },
  { id: 'LOW_BLOCK', label: '잠그기', instructions: PRESET_INSTR.LOW_BLOCK },
];

const ATTRS: AttrDef[] = [
  { key: 'passing', label: '패스', group: 'TECHNICAL' },
  { key: 'dribbling', label: '드리블', group: 'TECHNICAL' },
  { key: 'finishing', label: '결정력', group: 'TECHNICAL' },
  { key: 'crossing', label: '크로스', group: 'TECHNICAL' },
  { key: 'tackling', label: '태클', group: 'TECHNICAL' },
  { key: 'vision', label: '시야', group: 'MENTAL' },
  { key: 'positioning', label: '위치선정', group: 'MENTAL' },
  { key: 'composure', label: '침착성', group: 'MENTAL' },
  { key: 'workRate', label: '활동량', group: 'MENTAL' },
  { key: 'pace', label: '속도', group: 'PHYSICAL' },
  { key: 'stamina', label: '체력', group: 'PHYSICAL' },
  { key: 'physical', label: '피지컬', group: 'PHYSICAL' },
  { key: 'reflexes', label: '선방', group: 'GOALKEEPING' },
  { key: 'aerialCommand', label: '공중 장악', group: 'GOALKEEPING' },
  { key: 'kicking', label: '킥', group: 'GOALKEEPING' },
];

export const RULES: RuleDef[] = [
  { id: 'R1', label: '전방 압박', counter: '패스 방식을 길게(+2) 바꿔 압박을 넘기세요' },
  { id: 'R2', label: '롱볼 우회', counter: '수비 라인을 낮추거나 스위퍼 키퍼를 쓰세요' },
  { id: 'R3', label: '낮은 블록', counter: '경기 폭을 넓혀(+2) 크로스로 공략하세요' },
  { id: 'R4', label: '측면 폭', counter: '경기 폭을 넓혀 측면 수적 열세를 막으세요' },
  { id: 'R5', label: '역습 처벌', counter: '공격 성향을 0으로 낮춰 역습 공간을 줄이세요' },
  { id: 'R6', label: '오프사이드 트랩', counter: '템포를 낮추고(−1) 침투 대신 연결을 늘리세요' },
  { id: 'R7', label: '중원 수적 우위', counter: '중앙 미드필더가 많은 포메이션을 고려하세요' },
  { id: 'R9', label: '집중 마크', counter: '핵심 선수 의존을 줄이고 다른 공격 경로를 쓰세요' },
  { id: 'R10', label: '공략 측면', counter: '약한 쪽 측면 수비를 보강하세요' },
  { id: 'TEMPO', label: '템포', counter: '템포를 낮춰 턴오버를 줄이세요' },
  { id: 'LINE_FIT', label: '라인 적합도', counter: '느린 수비진이면 라인을 낮추세요' },
];

export const CATALOG: Catalog = { formations: FORMATIONS, roles: ROLES, presets: PRESETS, attributes: ATTRS, rules: RULES };

export const KEY_ATTRS: Record<Position, AttrKey[]> = {
  GK: ['reflexes', 'aerialCommand', 'kicking', 'positioning', 'composure'],
  CB: ['tackling', 'positioning', 'physical', 'pace', 'composure'],
  FB: ['pace', 'tackling', 'crossing', 'stamina', 'workRate'],
  DM: ['tackling', 'passing', 'positioning', 'workRate', 'composure'],
  CM: ['passing', 'vision', 'workRate', 'stamina', 'tackling'],
  AM: ['passing', 'vision', 'dribbling', 'composure', 'finishing'],
  W: ['pace', 'dribbling', 'crossing', 'finishing', 'stamina'],
  ST: ['finishing', 'composure', 'positioning', 'pace', 'physical'],
};

export const ADJACENT: Record<Position, Partial<Record<Position, FitLevel>>> = {
  GK: {},
  CB: { FB: 'CAPABLE', DM: 'CAPABLE' },
  FB: { CB: 'CAPABLE', W: 'CAPABLE' },
  DM: { CM: 'ACCOMPLISHED', CB: 'CAPABLE' },
  CM: { DM: 'ACCOMPLISHED', AM: 'ACCOMPLISHED' },
  AM: { CM: 'ACCOMPLISHED', W: 'CAPABLE', ST: 'CAPABLE' },
  W: { AM: 'CAPABLE', FB: 'CAPABLE', ST: 'CAPABLE' },
  ST: { AM: 'CAPABLE', W: 'CAPABLE' },
};

export const CLUB_NAMES: [string, string][] = [
  ['성수 유나이티드', '성수'],
  ['한강 FC', '한강'],
  ['마포 시티', '마포'],
  ['용산 레인저스', '용산'],
  ['강동 FC', '강동'],
  ['송파 로얄스', '송파'],
  ['노원 스타즈', '노원'],
  ['은평 FC', '은평'],
  ['서초 SC', '서초'],
  ['관악 워리어스', '관악'],
  ['구로 FC', '구로'],
  ['영등포 유나이티드', '영등포'],
  ['동작 시티', '동작'],
  ['광진 FC', '광진'],
];

export const BOT_STYLES: BotStyleTag[] = [
  'POSSESSION', 'COUNTER', 'HIGH_PRESS', 'LOW_BLOCK', 'WIDE',
  'POSSESSION', 'COUNTER', 'HIGH_PRESS', 'LOW_BLOCK', 'WIDE',
  'POSSESSION', 'COUNTER', 'HIGH_PRESS',
];

export const STYLE_SETUP: Record<BotStyleTag, { formation: FormationId; preset: PresetId; alt: FormationId; altPreset: PresetId }> = {
  POSSESSION: { formation: '4-3-3', preset: 'POSSESSION', alt: '4-2-3-1', altPreset: 'LOW_BLOCK' },
  COUNTER: { formation: '4-4-2', preset: 'COUNTER', alt: '4-4-2', altPreset: 'HIGH_PRESS' },
  HIGH_PRESS: { formation: '4-2-3-1', preset: 'HIGH_PRESS', alt: '4-3-3', altPreset: 'BALANCED' },
  LOW_BLOCK: { formation: '5-3-2', preset: 'LOW_BLOCK', alt: '3-5-2', altPreset: 'COUNTER' },
  WIDE: { formation: '4-4-2', preset: 'BALANCED', alt: '4-3-3', altPreset: 'POSSESSION' },
};

const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍'];
const GIVEN = ['민', '준', '서', '현', '우', '진', '도', '하', '지', '태', '성', '재', '영', '호', '석', '빈', '훈', '결', '율', '찬', '규', '원', '혁', '수'];

export function koreanName(rng: () => number): string {
  const pick = (arr: string[]) => arr[Math.floor(rng() * arr.length)] ?? arr[0] ?? '';
  return pick(SURNAMES) + pick(GIVEN) + pick(GIVEN);
}
