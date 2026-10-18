/** 선수·스쿼드 생성기 (4.1, 9.1). 모든 무작위는 주입된 Rng 로만. 소유: A. */
import type {
  AttrKey,
  Attributes,
  BotStyle,
  Club,
  FitLevel,
  Nationality,
  Player,
  Position,
  ScoutGrade,
  Tier,
} from '../../types';
import { clamp, hashString, type Rng } from '../../engine';
import { styleTactics } from '../ai/managerAi';
import { baseSalary } from '../economy/economy';
import { OVR_WEIGHTS, computeOvr } from './ovr';

export { OVR_WEIGHTS, computeOvr };

export interface GenerateSquadOptions {
  clubId: string;
  /** 주전 11명 목표 평균 OVR (로테이션 11명은 −6) */
  targetOvr: number;
  size: number;
  tier: Tier;
  /** 보정 배치 전용: 성장 난수 소비를 0.6.0 보정 당시(옛 나이 분포)와 같게 해 고정 스쿼드 표본을 유지한다 */
  legacyRng?: boolean;
}

const ATTR_KEYS: AttrKey[] = [
  'passing',
  'dribbling',
  'finishing',
  'crossing',
  'tackling',
  'vision',
  'positioning',
  'composure',
  'workRate',
  'pace',
  'stamina',
  'physical',
  'reflexes',
  'aerialCommand',
  'kicking',
];
const GK_ONLY: AttrKey[] = ['reflexes', 'aerialCommand', 'kicking'];

/** 보조 포지션 적합도 후보 [포지션, 가능한 등급들] */
const SECONDARY: Record<Position, [Position, FitLevel[]][]> = {
  GK: [],
  CB: [
    ['FB', ['CAPABLE', 'CAPABLE', 'ACCOMPLISHED']],
    ['DM', ['CAPABLE', 'UNSUITED']],
  ],
  FB: [
    ['CB', ['CAPABLE', 'UNSUITED']],
    ['W', ['CAPABLE', 'ACCOMPLISHED', 'UNSUITED']],
  ],
  DM: [
    ['CM', ['ACCOMPLISHED', 'ACCOMPLISHED', 'CAPABLE']],
    ['CB', ['CAPABLE', 'UNSUITED']],
  ],
  CM: [
    ['DM', ['ACCOMPLISHED', 'CAPABLE']],
    ['AM', ['CAPABLE', 'ACCOMPLISHED']],
  ],
  AM: [
    ['CM', ['CAPABLE', 'ACCOMPLISHED']],
    ['W', ['CAPABLE', 'UNSUITED']],
    ['ST', ['CAPABLE', 'UNSUITED']],
  ],
  W: [
    ['AM', ['CAPABLE', 'ACCOMPLISHED']],
    ['ST', ['CAPABLE', 'UNSUITED']],
    ['FB', ['CAPABLE', 'UNSUITED', 'UNSUITED']],
  ],
  ST: [
    ['W', ['CAPABLE', 'UNSUITED']],
    ['AM', ['CAPABLE', 'UNSUITED']],
  ],
};

/** 기준 스쿼드 22명: 주전 11 + 로테이션 11 */
const STARTER_TEMPLATE: Position[] = ['GK', 'CB', 'CB', 'FB', 'FB', 'DM', 'CM', 'CM', 'AM', 'W', 'ST'];
const ROTATION_TEMPLATE: Position[] = ['GK', 'CB', 'CB', 'FB', 'FB', 'DM', 'CM', 'AM', 'W', 'ST', 'ST'];
export const ROTATION_OVR_GAP = 6;

/** 티어별 기준 주전 OVR [PH] (T3 = 60) */
export const TIER_REFERENCE_OVR: Record<Tier, number> = { T1: 72, T2: 66, T3: 60, T4: 54, T5: 48 };

const FAMILY = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍', '배', '문', '양', '손'];
const GIVEN_A = ['민', '서', '도', '준', '현', '지', '태', '우', '승', '재', '하', '시', '건', '유', '동', '성', '은', '영', '진', '한'];
const GIVEN_B = ['준', '호', '윤', '우', '민', '혁', '빈', '수', '훈', '원', '석', '규', '찬', '환', '결', '율', '겸', '온', '철', '범'];

/**
 * 2.6.0: 국적별 실제 이름 생성(한글 표기 — 게임 전체가 한국어 단일이라 외국 선수도
 * 중계·목록에서 로마자 없이 한글로 통일한다. 실존 선수 이름은 쓰지 않는다).
 * 소유: A. 각 풀은 "해당 국가에서 실제 쓰이는 이름 성분"이되 대표성 있는 소수 샘플만 둔다
 * (완전한 현지 데이터베이스가 아님 — 분위기용).
 */
interface NamePool {
  given: string[];
  family: string[];
  order: 'given-family' | 'family-given';
}

const NATIONALITY_POOLS: Record<Nationality, NamePool> = {
  KR: { given: [], family: [], order: 'family-given' }, // 기존 FAMILY/GIVEN_A/GIVEN_B 조합 경로를 그대로 씀(아래 generateName 참고)
  BR: {
    given: ['루카스', '가브리엘', '마테우스', '라파엘', '브루누', '치아구', '펠리피', '지에구', '카이우', '비니시우스'],
    family: ['실바', '산투스', '올리베이라', '소우자', '페레이라', '코스타', '아우메이다', '페헤이라', '호드리게스', '카르발류'],
    order: 'given-family',
  },
  JP: {
    given: ['히로토', '렌', '하루토', '유마', '소타', '이츠키', '리쿠', '미나토', '아오이', '유토'],
    family: ['사토', '스즈키', '다카하시', '다나카', '와타나베', '이토', '야마모토', '나카무라', '고바야시', '가토'],
    order: 'family-given',
  },
  GB: {
    given: ['잭', '해리', '찰리', '조지', '올리버', '토마스', '윌리엄', '제임스', '벤', '루카스'],
    family: ['스미스', '존스', '테일러', '브라운', '윌리엄스', '윌슨', '존슨', '데이비스', '로빈슨', '워커'],
    order: 'given-family',
  },
  FR: {
    given: ['루카', '루이', '가브리엘', '레오', '라파엘', '아르튀르', '쥘', '아당', '테오', '위고'],
    family: ['마르탱', '베르나르', '뒤부아', '토마', '로베르', '리샤르', '프티', '뒤랑', '르루아', '모로'],
    order: 'given-family',
  },
  NG: {
    given: ['치네두', '에메카', '올루와세운', '이페올루와', '다니엘', '사무엘', '조슈아', '빅터', '이삭', '주드'],
    family: ['오콘크워', '아데예미', '오콜리', '이부딘', '발로군', '에제', '은와치쿠', '오예레미', '우고', '아비올라'],
    order: 'given-family',
  },
  AR: {
    given: ['마티아스', '니콜라스', '파쿤도', '산티아고', '레안드로', '에세키엘', '발렌틴', '토마스', '아구스틴', '브루노'],
    family: ['로드리게스', '곤잘레스', '페르난데스', '로페스', '디아스', '마르티네스', '알바레스', '로메로', '수아레스', '토레스'],
    order: 'given-family',
  },
  ES: {
    given: ['알바로', '세르히오', '파블로', '마르코스', '디에고', '호르헤', '이반', '라울', '아드리안', '빅토르'],
    family: ['가르시아', '마르틴', '로페스', '산체스', '페레스', '고메스', '모레노', '히메네스', '루이즈', '디아즈'],
    order: 'given-family',
  },
};

/** 국적 분포: 한국 리그이므로 절대다수는 국내 출신, 외국 선수는 소수 비중(용병) */
const NATIONALITY_WEIGHTS: [Nationality, number][] = [
  ['KR', 0.85],
  ['BR', 0.03],
  ['JP', 0.03],
  ['GB', 0.02],
  ['FR', 0.02],
  ['NG', 0.02],
  ['AR', 0.02],
  ['ES', 0.01],
];

/**
 * 주입 rng 를 소비하지 않고 playerId 해시로만 국적·이름을 고른다(salaryFor 와 같은 이유:
 * rng 를 쓰면 같은 시드의 다음 선수 능력치가 밀려 엔진 보정 표본이 흔들린다).
 */
export function nationalityFor(playerId: string): Nationality {
  const u = hashString(`${playerId}|nationality`) / 0x100000000;
  let acc = 0;
  for (const [nat, w] of NATIONALITY_WEIGHTS) {
    acc += w;
    if (u < acc) return nat;
  }
  return 'KR';
}

export function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function randInt(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function pick<T>(rng: Rng, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length)]!;
}

export function scoutGrade(v: number): ScoutGrade {
  if (v >= 80) return 'S';
  if (v >= 72) return 'A';
  if (v >= 65) return 'B';
  if (v >= 58) return 'C';
  if (v >= 50) return 'D';
  return 'E';
}

export function generateName(rng: Rng, nationality: Nationality): string {
  if (nationality === 'KR') return pick(rng, FAMILY) + pick(rng, GIVEN_A) + pick(rng, GIVEN_B);
  const pool = NATIONALITY_POOLS[nationality];
  const given = pick(rng, pool.given);
  const family = pick(rng, pool.family);
  rng(); // KR 경로(3회 소비)와 draw 수를 맞춘다 — 이 함수의 rng 소비량이 국적에 따라 달라지면 같은 시드의 다음 선수부터 능력치가 밀려 엔진 보정 표본이 흔들린다
  return pool.order === 'given-family' ? `${given} ${family}` : `${family} ${given}`;
}

export function generatePlayer(rng: Rng, position: Position, targetOvr: number, age?: number, legacyRng = false): Player {
  const L = targetOvr / 5;
  const weights = OVR_WEIGHTS[position];
  const attrs = {} as Attributes;
  for (const k of ATTR_KEYS) {
    const isKey = (weights[k] ?? 0) > 0;
    if (position !== 'GK' && GK_ONLY.includes(k)) {
      attrs[k] = randInt(rng, 1, 5);
    } else if (position === 'GK' && !isKey && k !== 'stamina' && k !== 'pace') {
      attrs[k] = clamp(Math.round(L * 0.45 + gauss(rng) * 1.5), 1, 20);
    } else if (isKey) {
      attrs[k] = clamp(Math.round(L + gauss(rng) * 1.8), 1, 20);
    } else {
      attrs[k] = clamp(Math.round(L - 1.5 + gauss(rng) * 2.2), 1, 20);
    }
  }
  // 주 포지션 OVR 이 목표에 가깝도록 핵심 능력치를 평행 이동
  for (let iter = 0; iter < 4; iter++) {
    const ovr = computeOvr({ attrs, primary: position });
    const delta = Math.round((targetOvr - ovr) / 5);
    if (delta === 0) break;
    for (const k of Object.keys(weights) as AttrKey[]) attrs[k] = clamp(attrs[k] + delta, 1, 20);
  }
  const g = age === undefined ? gauss(rng) : 0;
  const ageV = age ?? clamp(Math.round(24.5 + g * 5), 17, 35);
  const positions: Partial<Record<Position, FitLevel>> = { [position]: 'NATURAL' };
  for (const [pos, levels] of SECONDARY[position]) {
    const lv = pick(rng, levels);
    if (lv !== 'UNSUITED') positions[pos] = lv;
  }
  const ovr = computeOvr({ attrs, primary: position });
  const growth = ageV <= 21 ? randInt(rng, 2, 6) : ageV <= 24 ? randInt(rng, 0, 3) : ageV <= 28 ? randInt(rng, 0, 1) : 0;
  // ponytail: 보정 배치(legacyRng)는 M3.6 나이 분포 변경 전과 rng 소비를 같게 둔다 — 옛 나이(25 + g×4) ≤ 28 이면 성장 난수를 하나 쓴다.
  // 소비가 달라지면 다음 선수 능력치가 바뀌어 엔진 보정(STYLE_MATRIX 등)이 맞춰진 스쿼드 표본이 흔들린다. 커리어 보정은 새 흐름에 맞춰져 있어 기본값은 그대로.
  // 엔진을 다시 보정할 때 이 분기를 지우고 새 흐름으로 맞출 것
  if (legacyRng && ageV > 28 && age === undefined && Math.round(25 + g * 4) <= 28) rng();
  const potential = clamp(ovr + growth, ovr, 95);
  const seasonsLeft = ageV <= 23 ? randInt(rng, 1, 3) : randInt(rng, 1, 5);
  const id = `x${Math.floor(rng() * 0xffffffff).toString(16)}`;
  const nationality = nationalityFor(id);
  return {
    id,
    clubId: null,
    name: generateName(rng, nationality),
    nationality,
    age: ageV,
    primary: position,
    positions,
    attrs,
    ovr,
    potential,
    scoutRange: [scoutGrade(potential - 4), scoutGrade(potential + 4)],
    condition: 100,
    morale: 0,
    contract: { seasonsLeft, salary: 0 },
    availability: { injuryDays: 0, suspendedMatches: 0 },
    isTemporary: false,
    season: { apps: 0, starts: 0, minutes: 0, goals: 0, shots: 0, keyPasses: 0, tackles: 0, redCards: 0 },
  };
}

/**
 * 경제 설계 K2: 연봉 = S(OVR) × U(0.9, 1.1), 합계 보정 없음 (기준 스쿼드 ≈ 캡 85~88%).
 * U 는 선수 ID·이름 해시에서 뽑는다 — 주입 rng 를 소비하면 같은 시드의 능력치가 바뀌어 보정 배치(generateSquad 사용)가 흔들린다.
 */
export function salaryFor(p: Pick<Player, 'id' | 'name' | 'ovr'>): number {
  const u = hashString(`${p.id}|${p.name}|salary`) / 0x100000000;
  return Math.round((baseSalary(p.ovr) * (0.9 + 0.2 * u)) / 1000) * 1000;
}

/** 기준 스쿼드 22명: GK 2 / CB 4 / FB 4 / DM 2 / CM 3 / AM 2 / W 2 / ST 3 [PH] */
export function generateSquad(rng: Rng, opts: GenerateSquadOptions): Player[] {
  const offsets = STARTER_TEMPLATE.map(() => gauss(rng) * 3);
  const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
  const plan: { pos: Position; ovr: number }[] = [];
  STARTER_TEMPLATE.forEach((pos, i) => plan.push({ pos, ovr: opts.targetOvr + offsets[i]! - mean }));
  ROTATION_TEMPLATE.forEach((pos) => plan.push({ pos, ovr: opts.targetOvr - ROTATION_OVR_GAP + gauss(rng) * 3 }));
  while (plan.length < opts.size) {
    const pos = ROTATION_TEMPLATE[plan.length % ROTATION_TEMPLATE.length]!;
    plan.push({ pos, ovr: opts.targetOvr - ROTATION_OVR_GAP - 2 + gauss(rng) * 3 });
  }
  const players = plan.slice(0, opts.size).map((x, i) => {
    const p = generatePlayer(rng, x.pos, Math.round(x.ovr), undefined, opts.legacyRng);
    const id = `${opts.clubId}p${String(i + 1).padStart(2, '0')}`;
    return { ...p, id, clubId: opts.clubId };
  });
  return players.map((p) => ({ ...p, contract: { ...p.contract, salary: salaryFor(p) } }));
}

const BOT_NAMES = [
  ['한강 FC', '한강'],
  ['남산 유나이티드', '남산'],
  ['동해 시티', '동해'],
  ['서해 로버스', '서해'],
  ['백두 SC', '백두'],
  ['태백 워리어스', '태백'],
  ['금강 FC', '금강'],
  ['영산 레인저스', '영산'],
  ['지리산 AFC', '지리'],
  ['설악 스타즈', '설악'],
  ['낙동 유나이티드', '낙동'],
  ['섬진 FC', '섬진'],
  ['한라 SC', '한라'],
  ['무등 시티', '무등'],
  ['소백 애슬레틱', '소백'],
  ['속리 FC', '속리'],
  ['오대 로얄스', '오대'],
  ['덕유 레드', '덕유'],
] as const;

/** 피라미드 70구단용 추가 지명 (BOT_NAMES 뒤로 이어 붙인다, 2.1.0 M3.2) */
const MORE_PLACES = [
  '청계', '관악', '북한', '도봉', '수락', '팔공', '가야', '월악', '계룡', '내장', '변산', '월출', '주왕', '치악', '칠갑', '대둔', '천마', '명지',
  '용문', '운악', '감악', '마니', '화악', '가리', '백운', '황매', '민주', '두륜', '조계', '선운', '모악', '천관', '능가', '금오', '비슬', '운문',
  '가지', '신불', '영취', '토함', '남한', '북악', '인왕', '아차', '불암', '용마', '검단', '청량', '광교', '수리', '소요', '천보',
];
const MORE_SUFFIX = ['FC', '유나이티드', '시티', 'SC', '로버스', '애슬레틱', '레인저스', '워리어스'];

/** 봇 이름. 0~17 은 Phase 0 이름 그대로, 그 뒤는 지명 + 접미사 (index 0~69 에서 서로 다름) */
export function botName(index: number): { name: string; shortName: string } {
  if (index < BOT_NAMES.length) {
    const n = BOT_NAMES[index]!;
    return { name: n[0], shortName: n[1] };
  }
  const k = (index - BOT_NAMES.length) % MORE_PLACES.length;
  const place = MORE_PLACES[k]!;
  return { name: `${place} ${MORE_SUFFIX[k % MORE_SUFFIX.length]}`, shortName: place };
}

export function createBotClub(rng: Rng, id: string, style: BotStyle, players: readonly Player[]): Club {
  const { name, shortName } = botName(Math.floor(rng() * BOT_NAMES.length));
  const t = styleTactics(style);
  return {
    id,
    name,
    shortName,
    isHuman: false,
    style,
    playerIds: players.map((p) => p.id),
    tactics: t,
  };
}
