import type { ClubId, Kc, PlayerId, SeasonNo, Step } from './common';
import type { Tier } from './league';

/** 기획서 4.4 포지션 그룹. WB 는 3백/5백 포메이션의 FB 슬롯으로 표현한다. */
export type Position = 'GK' | 'CB' | 'FB' | 'DM' | 'CM' | 'AM' | 'W' | 'ST';

/** 필드 능력치 12종 (기술 5 + 정신 4 + 신체 3). 1~20 정수. */
export type OutfieldAttr =
  | 'passing'
  | 'dribbling'
  | 'finishing'
  | 'crossing'
  | 'tackling'
  | 'vision'
  | 'positioning'
  | 'composure'
  | 'workRate'
  | 'pace'
  | 'stamina'
  | 'physical';

/** GK 전용 3종: 선방, 공중 장악, 킥. */
export type GkAttr = 'reflexes' | 'aerialCommand' | 'kicking';

export type AttrKey = OutfieldAttr | GkAttr;

/** 모든 선수가 15개 키를 모두 가진다(필드 선수의 GK 능력치는 1~5 수준). */
export type Attributes = Record<AttrKey, number>;

/** 포지션 적합도. 효율 배수 1.00 / 0.95 / 0.88 / 0.75 (engine/data/constants.ts FIT_MULT). */
export type FitLevel = 'NATURAL' | 'ACCOMPLISHED' | 'CAPABLE' | 'UNSUITED';

export type ScoutGrade = 'E' | 'D' | 'C' | 'B' | 'A' | 'S';

export interface Contract {
  /** 잔여 시즌 수 1~5 */
  seasonsLeft: number;
  /** 연봉 = 시즌(28일)당 급여. 매일 salary/28 차감 */
  salary: Kc;
  /** 2.2.0 (M4.1, 경제 5.1): 계약금·갱신 보너스 ÷ 계약 시즌 수. 캡 산입에 더한다. 없으면 0 */
  bonusPerSeason?: Kc;
  /** 2.2.0: 캡 산입액 = max(salary, 0.8 × S(ovr)) + bonusPerSeason. 시즌 경계 재계산 값(표시용, M4.2) */
  capCharge?: Kc;
}

export interface Availability {
  /** 남은 부상 일수. 0 이면 출전 가능 */
  injuryDays: number;
  /** 남은 출장 정지 경기 수 (퇴장 → 1) */
  suspendedMatches: number;
}

export interface PlayerSeasonStats {
  apps: number;
  starts: number;
  minutes: number;
  goals: number;
  shots: number;
  keyPasses: number;
  tackles: number;
  redCards: number;
}

/** 2.1.0: 선수 시즌별 기록 한 줄 (시즌 경계에서 끝난 시즌을 추가, M3.3). 성장 추이 화면용 */
export interface PlayerSeasonLine {
  season: SeasonNo;
  /** 그 시즌의 나이 (나이 +1 전) */
  age: number;
  /** 시즌 종료 시점 OVR */
  ovr: number;
  clubId: ClubId | null;
  tier?: Tier;
  apps: number;
  goals: number;
}

/** 2.1.1 (M3.3, 수명주기 설계 14.1): 성장 저금통 (UI 비노출) */
export interface PlayerDev {
  /** OVR 단위 실수. 양수 = 성장 대기, 음수 = 노화 대기 */
  bank: number;
  /** 직전 성장 틱 시점의 season.minutes */
  minutesMark: number;
}

export interface Player {
  id: PlayerId;
  clubId: ClubId | null;
  name: string;
  age: number;
  primary: Position;
  /** 누락된 포지션은 UNSUITED 로 간주 */
  positions: Partial<Record<Position, FitLevel>>;
  attrs: Attributes;
  /** 표시용 OVR 1~100 (주 포지션 가중합 × 5). 엔진은 사용하지 않는다 */
  ovr: number;
  /** 숨김 잠재력(OVR 상한). UI 에 노출 금지, scoutRange 로만 공개 */
  potential: number;
  scoutRange: [ScoutGrade, ScoutGrade];
  /** 0~100 */
  condition: number;
  morale: Step;
  contract: Contract;
  availability: Availability;
  /** 18명 미만 시 자동 충원된 임시 계약 선수 */
  isTemporary: boolean;
  season: PlayerSeasonStats;
  /** 2.1.0: 지난 시즌 기록, 오래된 순. 없으면 [] (스키마 2 세이브·첫 시즌) */
  history?: PlayerSeasonLine[];
  /** 2.1.1: 성장 저금통. 없으면 { bank: 0, minutesMark: season.minutes } (UI 비노출) */
  dev?: PlayerDev;
  /** 2.1.1: Day 20 은퇴 예고. 시즌 경계에서 세계에서 사라진다 */
  retiring?: boolean;
  /** 2.1.1: 무소속(FA 풀)이 된 시즌 번호. clubId === null 일 때만 의미 */
  faSince?: SeasonNo;
  /** 2.1.1: 유스 출신 구단 (표시용) */
  academyClubId?: ClubId;
}
