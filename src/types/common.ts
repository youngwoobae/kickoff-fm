/**
 * 공통 원시 타입. 모든 레이어(engine/domain/services/ui)가 공유하는 계약.
 * 이 디렉터리(src/types)는 타입 전용이다. 런타임 코드를 두지 않는다.
 */

export type ClubId = string;
export type PlayerId = string;
/** 형식: `s{season}-d{day}-{homeId}-{awayId}` (domain/league/schedule.ts 에서 생성) */
export type MatchId = string;
export type UserId = string;
export type ProposalId = string;

/** KC 정수 단위. 1M KC = 1_000_000. 표시(`85.0M`)는 UI 책임. */
export type Kc = number;

/** 시즌 내 날짜 1..28 (Day 1~26 경기일, 27 리뷰, 28 정산). */
export type Day = number;
export type SeasonNo = number;

/** 5단계 지시·사기 값. */
export type Step = -2 | -1 | 0 | 1 | 2;

export type Side = 'HOME' | 'AWAY';
/** 좌/중/우. R10 공략 측면, 포메이션 슬롯 레인에 사용. */
export type Lane = 'L' | 'C' | 'R';

export interface GameTime {
  season: SeasonNo;
  day: Day;
}

/** 게임 내 사건 순서를 정하는 타임스탬프. seq 는 GameState 안에서 단조 증가. */
export interface GameTimestamp extends GameTime {
  seq: number;
}
