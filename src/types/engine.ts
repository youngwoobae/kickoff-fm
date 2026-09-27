/**
 * 시뮬레이션 엔진 입출력 계약 (기획서 8.2~8.8).
 * 엔진은 이 타입과 src/types 만 알고, domain/services/ui 를 모른다.
 */
import type { ClubId, Lane, MatchId, PlayerId, Step } from './common';
import type { ConditionalOrder } from './plan';
import type { Attributes, FitLevel, Position } from './player';
import type { FormationId, RoleId, SlotKey, TacticCap, TeamInstructions } from './tactics';

export type Zone = 0 | 1 | 2;
export type DP = 'DP1' | 'DP2' | 'DP3' | 'DP4' | 'DP5' | 'DP6' | 'DP7' | 'DP8';
export type BinaryDP = Exclude<DP, 'DP3'>;

/** DP3 에서 다항 로짓으로 고르는 오픈 플레이 찬스 유형 */
export type OpenPlayChance = 'CROSS' | 'THROUGH' | 'CUTBACK' | 'LONG' | 'SOLO';
export type ChanceType = OpenPlayChance | 'COUNTER' | 'CORNER' | 'FK' | 'PK';

/**
 * 전술 가산치 출처. R8 은 v2 에서 삭제.
 * TEMPO: DP8 ±0.05 × tempo, LINE_FIT: 라인 +2 & PACE_D < 60 시 −0.10 (8.3-4)
 * 1.2.0(엔진 0.4.0): R11 하프스페이스 과부하, R12 측면 1:1(윙백 뒤 공간), R13 타깃맨 롱볼·세컨드볼
 */
export type RuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R9' | 'R10' | 'R11' | 'R12' | 'R13' | 'TEMPO' | 'LINE_FIT';

export type UnitKey =
  | 'BU'
  | 'PRG'
  | 'CRE'
  | 'FIN'
  | 'PRS'
  | 'MID'
  | 'BOX'
  | 'CTRL'
  | 'AER_A'
  | 'AER_D'
  | 'PACE_A'
  | 'PACE_D'
  | 'SIDE_A_L'
  | 'SIDE_A_R'
  | 'SIDE_D_L'
  | 'SIDE_D_R'
  | 'GK'
  | 'SPA'
  | 'SPD';

/** 팀 유닛 레이팅 0~100 (8.3-2) */
export type Units = Record<UnitKey, number>;

export interface EnginePlayer {
  id: PlayerId;
  name: string;
  attrs: Attributes;
  /** 경기 전 컨디션 0~100 */
  condition: number;
  /** 포지션별 적합도 (슬롯 전환·교체 시 재계산용) */
  positions: Partial<Record<Position, FitLevel>>;
  primary: Position;
}

export interface EngineTacticSlot {
  formation: FormationId;
  roles: RoleId[];
  instructions: TeamInstructions;
  familiarity: number;
}

export interface EngineTeamInput {
  clubId: ClubId;
  name: string;
  isHome: boolean;
  /** 길이 11, 시작 슬롯 포메이션 인덱스 순 */
  starters: EnginePlayer[];
  /** 최대 7 */
  bench: EnginePlayer[];
  slots: Record<SlotKey, EngineTacticSlot>;
  startSlot: SlotKey;
  opponentOrders?: { markTarget?: PlayerId; marker?: PlayerId; attackSide?: Exclude<Lane, 'C'> };
  conditionals: ConditionalOrder[];
  autoSubThreshold: number;
  /** 팀 사기 (선발 평균 반올림) → prepMod */
  morale: Step;
  setPieceTaker?: PlayerId;
}

export interface EngineConfig {
  engineVersion: string;
  /** 결정 지점별 tac 합 clamp 값. 기본 0.35 */
  tacCap: TacticCap;
  /** 보정용: 전술 효과 전부 끔(tac = 0) */
  tacticsEnabled: boolean;
  /** 보정용: 지정 규칙만 끔 (규칙별 단독 기여 측정) */
  disabledRules: RuleId[];
  /** 보정용: 이 규칙만 켬 (지정 시 disabledRules 무시) */
  onlyRules?: RuleId[];
  /** 보정용: homeMod = 0 ("홈 이점 제외" 시나리오) */
  neutralVenue?: boolean;
}

export interface SimulateInput {
  matchId: MatchId;
  /** 32bit 정수 시드. domain 에서 seedFrom(gameSeed, matchId, engineVersion) 로 계산 */
  seed: number;
  home: EngineTeamInput;
  away: EngineTeamInput;
  config: EngineConfig;
}

/** 이진 결정 지점 로그 (DP1,2,4,5,6,7,8). 8.8 기여도 계산의 원천 데이터 */
export interface BinaryDecisionLog {
  kind: 'BINARY';
  seq: number;
  minute: number;
  /** 이 결정에서 "성공"을 원하는 팀 (DP6·DP7 은 공을 뺏은 팀) */
  actor: ClubId;
  dp: BinaryDP;
  zone?: Zone;
  chance?: ChanceType;
  side?: Lane;
  /** 공격 유닛 값 A, 수비 유닛 값 D */
  a: number;
  d: number;
  base: number;
  /** K × (A − D) (+ 유형별 매치업 항) */
  strength: number;
  prep: number;
  home: number;
  /** 1.2.0(엔진 0.4.0): 경기 흐름 보정(60분 이후 지는 팀 공격 ↑ 등). 없으면 0 */
  state?: number;
  /** base + strength + prep + home + state (전술 제외) */
  logitNoTac: number;
  /** 규칙별 원기여 r'_i (숙련도 계수 적용 후, clamp 전) */
  raw: Partial<Record<RuleId, number>>;
  /** clamp(Σ raw, −cap, +cap) */
  tac: number;
  /** 최종 확률 (clamp 포함) */
  p: number;
  success: boolean;
  shooterId?: PlayerId;
}

/** DP3 찬스 유형 선택 로그 (다항 로짓) */
export interface ChoiceDecisionLog {
  kind: 'CHOICE';
  seq: number;
  minute: number;
  actor: ClubId;
  dp: 'DP3';
  side: Lane;
  /** ln(기본 가중) + 역할 보정 */
  baseLogits: Record<OpenPlayChance, number>;
  /** 유형별 clamp 후 tac */
  tacByType: Record<OpenPlayChance, number>;
  rawByType: Record<OpenPlayChance, Partial<Record<RuleId, number>>>;
  chosen: OpenPlayChance;
}

export type DecisionLog = BinaryDecisionLog | ChoiceDecisionLog;

/**
 * 경기 이벤트. 1.2.0: 추가시간 이벤트는 minute = 45 또는 90 이고 addedMinute 가 붙는다("45+2", "90+4").
 * YELLOW_CARD 추가, SHOT.onTarget 추가(골은 항상 true).
 */
export type MatchEvent = (
  | { type: 'KICK_OFF'; minute: 0 }
  | { type: 'HALF_TIME'; minute: 45 }
  | { type: 'FULL_TIME'; minute: 90 }
  | { type: 'SHOT'; minute: number; clubId: ClubId; playerId: PlayerId; chance: ChanceType; xg: number; goal: boolean; onTarget?: boolean }
  | { type: 'GOAL'; minute: number; clubId: ClubId; playerId: PlayerId; chance: ChanceType; xg: number }
  | { type: 'OFFSIDE'; minute: number; clubId: ClubId; playerId?: PlayerId }
  | { type: 'LONG_BALL_ADVANCE'; minute: number; clubId: ClubId }
  | { type: 'COUNTER_ATTACK'; minute: number; clubId: ClubId }
  | { type: 'TRIGGER_FIRED'; minute: number; clubId: ClubId; conditionalId: string; description: string }
  | { type: 'SUBSTITUTION'; minute: number; clubId: ClubId; out: PlayerId; in: PlayerId; reason: 'CONDITION' | 'INJURY' }
  | { type: 'INJURY'; minute: number; clubId: ClubId; playerId: PlayerId; days: number }
  | { type: 'RED_CARD'; minute: number; clubId: ClubId; playerId: PlayerId }
  | { type: 'YELLOW_CARD'; minute: number; clubId: ClubId; playerId: PlayerId }
  | { type: 'CONDITION_DROP'; minute: number; clubId: ClubId; playerId: PlayerId; condition: number }
) & { addedMinute?: number };

export interface ZonePass {
  attempts: number;
  successes: number;
}

export interface TeamMatchStats {
  clubId: ClubId;
  goals: number;
  xg: number;
  shots: number;
  /** 점유 시퀀스 비율 0~1 */
  possession: number;
  zonePass: { z0: ZonePass; z1: ZonePass; z2: ZonePass };
  counters: number;
  offsides: number;
  longBallAdvances: number;
  /** 규칙이 0 이 아닌 값으로 발동한 결정 수 (이 팀이 수혜 측일 때) */
  ruleFires: Partial<Record<RuleId, number>>;
  formationStart: FormationId;
  instructionsStart: TeamInstructions;
  /** 1.2.0: 유효슈팅 (골 포함) */
  shotsOnTarget?: number;
  /** 1.2.0: 코너킥 수 (코너 슈팅 + 막힌 슈팅의 코너) */
  corners?: number;
  /** 1.2.0: 경고 수 */
  yellowCards?: number;
  /** 1.2.0: 시간 가중 점유율 0~1 (표시용). possession 은 시퀀스 비율로 유지 */
  possessionTime?: number;
}

export interface PlayerMatchLine {
  playerId: PlayerId;
  clubId: ClubId;
  started: boolean;
  minutes: number;
  goals: number;
  shots: number;
  keyPasses: number;
  tackles: number;
  conditionAfter: number;
  injuredDays: number;
  redCard: boolean;
  /** 1.2.0 */
  yellowCards?: number;
}

export interface MatchResult {
  matchId: MatchId;
  seed: number;
  engineVersion: string;
  tacCap: TacticCap;
  home: TeamMatchStats;
  away: TeamMatchStats;
  events: MatchEvent[];
  players: PlayerMatchLine[];
  /** 18 세그먼트별 모멘텀 (−1 원정 우세 .. +1 홈 우세) */
  momentum: number[];
  /** 전체 결정 로그. 영속화하지 않는다(재시뮬로 복원) */
  log: DecisionLog[];
}

/** 8.8-2 VALUE 테이블: 결정 성공/실패의 기대 xG 차. 엔진 버전별 데이터 파일 */
export interface ValueTable {
  engineVersion: string;
  DP1: number;
  DP2: number;
  DP4: Record<OpenPlayChance | 'COUNTER', number>;
  DP6: number;
  DP7: number;
  DP8: { z0: number; z1: number };
  /** DP3 유형 선택 기여 계산용: 유형 선택 시점의 기대 xG */
  chanceEv: Record<OpenPlayChance, number>;
}

export interface RuleContribution {
  ruleId: RuleId;
  /** 이 팀 관점 순 xG 기여 (+ 이 팀에 유리) */
  xg: number;
  /** 이 팀에 유리하게 발동한 횟수 / 불리하게 발동한 횟수 */
  firesFor: number;
  firesAgainst: number;
}

/** 8.8-3 요소별 영향 막대 (xG 환산, 이 팀 관점) */
export interface FactorBars {
  strength: number;
  prep: number;
  tactics: number;
  /** (실제 득실 차) − (xG 득실 차) */
  luck: number;
  /** 1.2.0: 경기 흐름(STATE) 기여. 전력 → 준비 → 경기 흐름 → 전술 순서 */
  state?: number;
}

export interface TeamExplanation {
  clubId: ClubId;
  rules: RuleContribution[];
  bars: FactorBars;
  /** 전술 총효과 확률 합 보존 검증용 (Σ Δp_i − Σ Δp_tac, 0 이어야 함) */
  conservationError: number;
}

export interface MatchExplanation {
  matchId: MatchId;
  home: TeamExplanation;
  away: TeamExplanation;
}
