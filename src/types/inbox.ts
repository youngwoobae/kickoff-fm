/**
 * 2.2.0 (M4.1): 받은 편지함. 사용자 구단에게 오는 알림 한 통.
 * 생성 규칙·문구·보관(D27)은 M4.2(도메인), 이적 결과 메시지는 M4.3, 서비스 연결은 M4.4.
 * 수명주기 사건(domain/squad/lifecycle.ts LifecycleEvent)도 여기로 변환돼 들어온다.
 */
import type { ClubId, Day, MatchId, PlayerId, SeasonNo } from './common';

export type InboxKind =
  // 이적 (M4.3)
  | 'WINDOW_OPENED'
  | 'BID_WON'
  | 'BID_LOST'
  | 'PLAYER_SOLD'
  | 'LISTING_UNSOLD'
  // 계약·재정 (M4.2)
  | 'RENEWAL_OPEN'
  | 'CONTRACT_EXPIRED'
  | 'PLAYER_RELEASED'
  | 'NEGATIVE_BALANCE'
  | 'FORCED_SALE'
  // 수명주기 (선수_수명주기 설계 6·7·10장)
  | 'RETIREMENT_NOTICE'
  | 'YOUTH_INTAKE'
  | 'YOUTH_AUTO_DECIDED'
  | 'DISCIPLINE_WARNING'
  | 'SUSPENDED'
  // 그 밖 (시즌 결과 등)
  | 'GENERAL';

export interface InboxMessage {
  /** 세이브 안에서 유일. 형식은 도메인 소유(예: `s{season}-d{day}-{kind}-{n}`) */
  id: string;
  season: SeasonNo;
  day: Day;
  kind: InboxKind;
  title: string;
  body: string;
  /** 관련 대상 (화면 이동용, 모두 선택) */
  playerId?: PlayerId;
  clubId?: ClubId;
  listingId?: string;
  matchId?: MatchId;
  read: boolean;
}
