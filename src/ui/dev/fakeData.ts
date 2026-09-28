/**
 * 가짜 서비스용 고정 카탈로그·이름 생성기 (소유: B, 개발 전용).
 * 실제 수치는 백엔드(engine/data)가 정한다. 여기 값은 화면 개발용 근사치다.
 */
import type { AttrKey, BotStyle, BotStyleTag, Catalog, FitLevel, Position, StyleDef, TeamInstructions } from '../../types';
import { createGameService, createMemoryStorage } from '../../services';

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

/**
 * 카탈로그(포메이션 9·역할 28·스타일 9·규칙)는 실제 서비스의 정적 카탈로그를 그대로 쓴다.
 * getCatalog 는 게임 상태가 필요 없어서 메모리 저장소 인스턴스로 읽기만 한다.
 */
export const CATALOG: Catalog = createGameService({ storage: createMemoryStorage() }).getCatalog();
export const STYLES: StyleDef[] = CATALOG.styles ?? [];
export const RULES = CATALOG.rules;
export const BALANCED_INSTR: TeamInstructions = STYLES.find((x) => x.id === 'BALANCED')?.instructions ?? {
  mentality: 0, press: 0, line: 0, width: 0, tempo: 0, directness: 0, counter: false, offsideTrap: false,
};

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

export const BOT_STYLES: BotStyle[] = [
  'POSSESSION', 'COUNTER', 'HIGH_PRESS', 'LOW_BLOCK', 'DIRECT', 'WING_PLAY', 'HIGH_LINE', 'WINGBACK_3',
  'POSSESSION', 'COUNTER', 'HIGH_PRESS', 'DIRECT', 'WING_PLAY',
];

/** 레거시 5종 태그로 접기 (계약 16장) */
export const FOLD_TAG: Record<BotStyle, BotStyleTag> = {
  POSSESSION: 'POSSESSION', COUNTER: 'COUNTER', HIGH_PRESS: 'HIGH_PRESS', LOW_BLOCK: 'LOW_BLOCK',
  DIRECT: 'COUNTER', HIGH_LINE: 'HIGH_PRESS', WING_PLAY: 'WIDE', WINGBACK_3: 'WIDE',
};

const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍'];
const GIVEN = ['민', '준', '서', '현', '우', '진', '도', '하', '지', '태', '성', '재', '영', '호', '석', '빈', '훈', '결', '율', '찬', '규', '원', '혁', '수'];

export function koreanName(rng: () => number): string {
  const pick = (arr: string[]) => arr[Math.floor(rng() * arr.length)] ?? arr[0] ?? '';
  return pick(SURNAMES) + pick(GIVEN) + pick(GIVEN);
}
