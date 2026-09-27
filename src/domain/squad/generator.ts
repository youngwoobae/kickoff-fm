/** 선수·스쿼드 생성기 (4.1, 9.1). 모든 무작위는 주입된 Rng 로만. 소유: A. */
import type {
  AttrKey,
  Attributes,
  BotStyle,
  Club,
  FitLevel,
  Player,
  Position,
  ScoutGrade,
  Tier,
} from '../../types';
import { clamp, type Rng } from '../../engine';
import { styleTactics } from '../ai/managerAi';
import { TIER_ECONOMY } from '../economy/economy';
import { OVR_WEIGHTS, computeOvr } from './ovr';

export { OVR_WEIGHTS, computeOvr };

export interface GenerateSquadOptions {
  clubId: string;
  /** 주전 11명 목표 평균 OVR (로테이션 11명은 −6) */
  targetOvr: number;
  size: number;
  tier: Tier;
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

function gauss(rng: Rng): number {
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

export function generateName(rng: Rng): string {
  return pick(rng, FAMILY) + pick(rng, GIVEN_A) + pick(rng, GIVEN_B);
}

export function generatePlayer(rng: Rng, position: Position, targetOvr: number, age?: number): Player {
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
  const ageV = age ?? clamp(Math.round(25 + gauss(rng) * 4), 17, 35);
  const positions: Partial<Record<Position, FitLevel>> = { [position]: 'NATURAL' };
  for (const [pos, levels] of SECONDARY[position]) {
    const lv = pick(rng, levels);
    if (lv !== 'UNSUITED') positions[pos] = lv;
  }
  const ovr = computeOvr({ attrs, primary: position });
  const growth = ageV <= 21 ? randInt(rng, 6, 16) : ageV <= 24 ? randInt(rng, 2, 9) : ageV <= 28 ? randInt(rng, 0, 3) : 0;
  const potential = clamp(ovr + growth, ovr, 95);
  const seasonsLeft = ageV <= 23 ? randInt(rng, 1, 3) : randInt(rng, 1, 5);
  return {
    id: `x${Math.floor(rng() * 0xffffffff).toString(16)}`,
    clubId: null,
    name: generateName(rng),
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

/** 연봉 총액을 OVR² 비례로 배분 (사람 팀 ≈ 캡 94%, 7.5) */
export function assignSalaries(players: Player[], total: number): Player[] {
  const w = players.map((p) => p.ovr * p.ovr);
  const sum = w.reduce((a, b) => a + b, 0);
  let assigned = 0;
  return players.map((p, i) => {
    const salary = i === players.length - 1 ? total - assigned : Math.round((total * w[i]!) / sum / 1000) * 1000;
    assigned += salary;
    return { ...p, contract: { ...p.contract, salary } };
  });
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
    const p = generatePlayer(rng, x.pos, Math.round(x.ovr));
    const id = `${opts.clubId}p${String(i + 1).padStart(2, '0')}`;
    return { ...p, id, clubId: opts.clubId };
  });
  const econ = TIER_ECONOMY[opts.tier];
  const ref = TIER_REFERENCE_OVR[opts.tier];
  const scale = clamp(Math.pow(opts.targetOvr / ref, 2), 0.6, 1);
  return assignSalaries(players, Math.round(econ.salaryCap * 0.94 * scale));
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

export function botName(index: number): { name: string; shortName: string } {
  const n = BOT_NAMES[index % BOT_NAMES.length]!;
  return { name: n[0], shortName: n[1] };
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
