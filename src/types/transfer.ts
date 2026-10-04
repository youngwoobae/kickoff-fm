/**
 * 2.2.0 (M4.1): 이적시장·계약 계약 타입 (경제 설계 docs/설계/오프라인_경제.md 5~6장, 14장).
 * 실제 풀 생성·입찰 정산은 M4.3, 재계약·방출 공식은 M4.2, 서비스 연결은 M4.4.
 */
import type { ClubId, Day, Kc, PlayerId, SeasonNo } from './common';
import type { Player, Position } from './player';

/** MID = 시즌 중간 창, REGULAR = 시즌 경계 정규 창(Day 28 → 다음 시즌 Day 2 정산) */
export type WindowKind = 'MID' | 'REGULAR';

export interface TransferWindow {
  kind: WindowKind;
  /** 창이 열린 시즌 */
  season: SeasonNo;
  openDay: Day;
  /** 정산 처리일(블라인드 입찰 결과 확정) */
  settleDay: Day;
  /** 정산이 일어나는 시즌 (정규 창은 다음 시즌) */
  settleSeason: SeasonNo;
}

/** NPC = 시스템 시장 신규, FA = 무소속, CLUB = 구단 이적 명단 */
export type ListingKind = 'NPC' | 'FA' | 'CLUB';

export interface TransferListing {
  id: string;
  kind: ListingKind;
  playerId: PlayerId;
  /** CLUB 만 판매 구단. NPC·FA 는 null */
  sellerClubId: ClubId | null;
  /** 평가가치 V (등록 시 고정, 경제 6.1) */
  value: Kc;
  /** 이적료 입찰 범위. FA 는 0 / 0 (계약금 범위는 bonusMax) */
  minPrice: Kc;
  maxPrice: Kc;
  /** FA: 계약금 상한(1.0 × S) */
  bonusMax?: Kc;
  /** FA: 연봉 하한 */
  salaryFloor?: Kc;
  /** FA: 허용 계약 시즌 [최소, 최대] */
  seasonsRange?: [number, number];
}

/** listTransferListings 필터. 모든 조건 AND */
export interface TransferListingFilter {
  kind?: ListingKind;
  position?: Position;
  minOvr?: number;
  /** NPC·CLUB 는 minPrice, FA 는 계약금 0 기준으로 비교 */
  maxPrice?: Kc;
}

/** 블라인드 입찰. 매물당 구단당 1건(같은 매물 재입찰 = 수정) */
export interface Bid {
  listingId: string;
  clubId: ClubId;
  placedDay: Day;
  /** NPC·CLUB: 이적료 */
  fee?: Kc;
  /** FA: 계약금·연봉·계약 시즌 수 */
  bonus?: Kc;
  salary?: Kc;
  seasons?: number;
}

/** placeBid 입력 (구단·날짜는 서비스가 채운다) */
export type BidInput = Omit<Bid, 'clubId' | 'placedDay'>;

/** 재계약 견적 (경제 5.2). 협상 난수 없음: 같은 입력이면 같은 askSalary */
export interface RenewalQuote {
  playerId: PlayerId;
  askSalary: Kc;
  seasonsRange: [number, number];
  /** 갱신 보너스 = rate × 새 연봉 × 시즌 수 (기본 0.10) */
  bonusPerSeasonRate: number;
}

export interface RenewalResult {
  accepted: boolean;
  ask: Kc;
}

/** 방출 견적 (경제 5.3) */
export interface ReleaseQuote {
  playerId: PlayerId;
  /** 위약금 = 0.5 × 잔여 연봉. exempt 면 0 */
  penalty: Kc;
  /** 임시 계약·무위약 방출권·유스 후보 */
  exempt: boolean;
}

/** 2.2.1 (M4.4): 성립된 재계약. 시즌 경계에서 새 계약이 된다(GameState.pendingRenewals, 사람·AI 구단 공통) */
export interface PendingRenewal {
  playerId: PlayerId;
  salary: Kc;
  seasons: number;
  bonusPerSeason: Kc;
}

/** 2.2.1 (M4.4): 열린 창 하나의 시장 상태(GameState.transferMarket). 창이 열린 동안만 있고 정산일 처리에서 지운다 */
export interface TransferMarketState {
  window: TransferWindow;
  /** 등록 순서 */
  listings: TransferListing[];
  /** 모든 구단의 미정산 입찰(사람 + AI). UI 에는 사람 구단 것만(listBids) */
  bids: Bid[];
  /** NPC 매물 선수. 낙찰되면 players 로 옮기고, 미판매분은 창과 함께 사라진다 */
  npcPlayers: Record<PlayerId, Player>;
}
