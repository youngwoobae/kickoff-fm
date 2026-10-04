/**
 * 경기 리포트 (8.8 블록 1·2·3·4·5·6·8) 와 텍스트 중계 재생 데이터.
 * 리포트는 "우리 구단" 관점으로 생성한다.
 */
import type { ClubId, Lane, MatchId, PlayerId } from './common';
import type { ChanceType, FactorBars, MatchEvent, RuleId, Zone } from './engine';
import type { FormationId, TeamInstructions } from './tactics';

export interface ReportSummary {
  goalsFor: number;
  goalsAgainst: number;
  xgFor: number;
  xgAgainst: number;
  possession: number;
  shotsFor: number;
  shotsAgainst: number;
  isHome: boolean;
  /** 1.3.0: 유효슈팅 (골 포함) */
  shotsOnTargetFor?: number;
  shotsOnTargetAgainst?: number;
  /** 1.3.0: 코너킥 */
  cornersFor?: number;
  cornersAgainst?: number;
  /** 1.3.0: 경고 */
  yellowCardsFor?: number;
  yellowCardsAgainst?: number;
  /** 1.3.0: 시간 가중 점유율 0~1 (우리 관점, 표시용). possession 은 시퀀스 비율 */
  possessionTime?: number;
}

export type LuckLevel = 'UNLUCKY' | 'NEUTRAL' | 'LUCKY';

export interface LuckIndicator {
  level: LuckLevel;
  /** (득실 차) − (xG 득실 차) */
  delta: number;
  text: string;
}

/** 블록 3 승부 요인 카드 */
export interface FactorCard {
  ruleId: RuleId;
  beneficiary: 'US' | 'THEM';
  /** 엔진이 실제 판정한 이벤트 수 (오프사이드, 롱볼 전진 등) 또는 발동 횟수 */
  count: number;
  leagueAvgCount: number;
  /** 우리 관점 xG 기여 (부호 포함) */
  xg: number;
  text: string;
}

export interface ZoneFlowRow {
  zone: 0 | 1 | 2;
  label: string;
  passRate: number;
  leagueAvg: number;
}

/** 1.3.0: YELLOW_CARD 추가 */
export type TimelineKind = 'GOAL' | 'TRIGGER' | 'SUB' | 'CONDITION' | 'INJURY' | 'RED_CARD' | 'YELLOW_CARD';

export interface TimelineItem {
  minute: number;
  /** 1.3.0: 추가시간 분 (minute 45/90 과 함께 "90+3") */
  addedMinute?: number;
  kind: TimelineKind;
  clubId: ClubId;
  text: string;
}

export interface Suggestion {
  ruleId: RuleId;
  text: string;
  /** "적용" 버튼용 지시 패치 (없으면 텍스트만) */
  instructionPatch?: Partial<TeamInstructions>;
}

export interface MatchReport {
  matchId: MatchId;
  clubId: ClubId;
  opponentId: ClubId;
  summary: ReportSummary;
  luck: LuckIndicator;
  /** 최대 3개, |xg| 내림차순 */
  keyFactors: FactorCard[];
  /** 블록 4, 분해 순서 전력 → 준비 → 전술 고정 */
  factorBars: FactorBars;
  zoneFlow: ZoneFlowRow[];
  timeline: TimelineItem[];
  /** 최대 2개 */
  suggestions: Suggestion[];
  /** 시즌 누적 기대 승점 vs 실제 승점 (이 경기 포함) */
  seasonPoints: { expected: number; actual: number };
  /** 개발자 패널: 규칙별 원시 기여 */
  debug?: { ruleXg: Partial<Record<RuleId, number>>; conservationError: number };
}

export type CommentaryKind = 'NEUTRAL' | 'CHANCE' | 'GOAL' | 'TACTIC' | 'SUB' | 'CARD' | 'PERIOD';

export interface CommentaryLine {
  minute: number;
  /** 1.3.0: 추가시간 분 (minute 45/90 과 함께 "90+3") */
  addedMinute?: number;
  kind: CommentaryKind;
  clubId?: ClubId;
  text: string;
  /** 이 줄 시점 스코어 [홈, 원정] */
  score: [number, number];
  /** 2.4.0: 이 줄의 원본 엔진 이벤트 종류(경기 종료 줄은 FULL_TIME). 필러 줄은 없음. 카드 종류 판정은 text 대신 이것으로 */
  event?: MatchEvent['type'];
  /** 2.4.0 (2D 연출용): 이 줄 시점의 공 위치. 공이 의미 없는 줄(교체·카드·부상·조건부 지시·하프타임·종료)은 없음 */
  pitch?: PitchCue;
}

/** 2.4.0: 2D 중계 공 위치 큐. 엔진 결정 로그(DP3·DP4·DP5)·이벤트에서 복사만 한다(화면 좌표는 UI 가 정함) */
export interface PitchCue {
  /** 공을 가진(공격) 팀. 엔진 결정 로그의 side(= Lane)와 뜻이 달라 이름을 team 으로 둔다 */
  team: 'HOME' | 'AWAY';
  /** 공격 팀 기준 구역 0 수비 진영 · 1 중원 · 2 공격 진영 */
  zone: Zone;
  /** 공격 방향 기준 레인 (결정 로그 side 복사, 없으면 C) */
  lane: Lane;
  /** 슈터·오프사이드 선수 */
  playerId?: PlayerId;
  /** SHOT·GOAL 줄: 찬스 유형 */
  chance?: ChanceType;
  /** SHOT·GOAL 줄: 유효슈팅 여부 (골은 true) */
  onTarget?: boolean;
}

/** 텍스트 중계 즉시 재생용 (결정적 재시뮬로 생성) */
export interface MatchReplay {
  matchId: MatchId;
  homeId: ClubId;
  awayId: ClubId;
  lines: CommentaryLine[];
  /** 18 세그먼트 모멘텀 −1..+1 */
  momentum: number[];
  /** 세그먼트별 구역 점유 비율 [Z0, Z1, Z2] (홈 공격 기준) */
  zoneBars: [number, number, number][];
  /** 2.4.0: 시작 포메이션 (TeamMatchStats.formationStart 복사) — 2D 선수 점 배치 */
  formations?: { home: FormationId; away: FormationId };
  /** 2.4.0: 선발 11명, 시작 슬롯 FormationDef.slots 인덱스 순 (서비스가 경기 입력에서 채움) */
  starters?: { home: PlayerId[]; away: PlayerId[] };
  /**
   * 2.4.0: 결정 로그에서 뽑은 공 경로 [분, 팀(0 홈·1 원정), 구역(그 팀 공격 기준), 레인(0 L·1 C·2 R)].
   * DP1·DP2·DP3·DP4 와 턴오버 성공(DP6)마다 1점, 시간순, 최대 300점(넘으면 고르게 솎음). DP1·DP2 는 레인 정보가 없어 1(C)
   */
  ballTrack?: [number, 0 | 1, Zone, 0 | 1 | 2][];
}
