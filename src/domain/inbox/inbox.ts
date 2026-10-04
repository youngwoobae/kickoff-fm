/**
 * 받은 편지함 순수 함수 (M4.2, D27). 사건 → InboxMessage 초안 변환(문구), id 규칙, 보관.
 * 사람 구단 것만 넣는다: clubId 가 있는 사건은 여기서 거르고, clubId 없는 사건(경고·정지)은 호출자가 사람 구단 선수만 넘긴다.
 * 이적 결과(BID_WON 등) 문구는 M4.3 이 같은 draft 형식으로 만들어 appendInbox 로 넣는다.
 */
import type { ClubId, Day, InboxKind, InboxMessage, Kc, LifecycleEvent, PlayerId, SeasonNo } from '../../types';
import { SEASON_DAYS } from '../economy/economy';
import type { ContractEvent } from '../contract/contract';

/** D27: 3시즌(84일) 지나면 삭제. 개수 상한 [PH] */
export const INBOX = { keepDays: 3 * SEASON_DAYS, maxMessages: 300 } as const;

export type InboxDraft = Omit<InboxMessage, 'id' | 'season' | 'day' | 'read'>;

export interface InboxContext {
  userClubId: ClubId;
  /** 선수 이름 (없으면 id) */
  nameOf: (id: PlayerId) => string | undefined;
}

const fmtM = (kc: Kc) => `${(kc / 1_000_000).toFixed(2)}M`;

/** 수명주기 사건 → 편지 초안. 편지 대상이 아니면 null (성장·노화·AI 구단 사건 등) */
export function lifecycleDraft(e: LifecycleEvent, ctx: InboxContext): InboxDraft | null {
  if ('clubId' in e && e.clubId !== ctx.userClubId) return null;
  const name = 'playerId' in e ? (ctx.nameOf(e.playerId) ?? e.playerId) : '';
  const who = 'playerId' in e ? { playerId: e.playerId } : {};
  switch (e.kind) {
    case 'RETIRE_ANNOUNCED':
      return { kind: 'RETIREMENT_NOTICE', title: `${name} 은퇴 예고`, body: `${name} 선수가 이번 시즌을 끝으로 은퇴하겠다고 알려 왔어요.`, ...who, clubId: e.clubId };
    case 'YOUTH_OFFERED':
      return { kind: 'YOUTH_INTAKE', title: '유스 후보 도착', body: `유스 후보 ${e.count}명이 올라왔어요. Day 7까지 승격할 선수를 골라 주세요.`, clubId: e.clubId };
    case 'YOUTH_PROMOTED':
      return e.auto ? { kind: 'YOUTH_AUTO_DECIDED', title: '유스 승격 자동 결정', body: `기한이 지나 ${name} 선수가 자동으로 1군에 올라왔어요.`, ...who, clubId: e.clubId } : null;
    case 'YOUTH_AUTO_NONE':
      return { kind: 'YOUTH_AUTO_DECIDED', title: '유스 후보 자동 정리', body: `기한이 지나 유스 후보 ${e.count}명을 모두 돌려보냈어요. 눈에 띄는 유망주가 없었어요.`, clubId: e.clubId };
    case 'YELLOW_WARNING':
      return { kind: 'DISCIPLINE_WARNING', title: `${name} 경고 누적`, body: `${name} 선수가 경고 4장째예요. 한 장 더 받으면 출장 정지예요.`, ...who };
    case 'SUSPENDED_ACCUM':
      return { kind: 'SUSPENDED', title: `${name} 출장 정지`, body: `${name} 선수가 경고 누적으로 다음 경기에 나올 수 없어요.`, ...who };
    case 'RELEASED':
      return { kind: 'PLAYER_RELEASED', title: `${name} 방출`, body: `${name} 선수와 계약을 끝냈어요.`, ...who, clubId: e.clubId };
    case 'SOLD_UP':
    case 'SOLD_ABROAD':
      return { kind: 'PLAYER_SOLD', title: `${name} 이적`, body: `${name} 선수가 다른 구단으로 떠났어요.`, ...who, clubId: e.clubId };
    default:
      return null; // GREW·DECLINED·FA_RETIRED·RETIRED·SIGNED_FROM_POOL·REGENERATED
  }
}

/** 계약·재정 사건 → 편지 초안. RENEWED(사용자가 직접 한 일)·다른 구단 사건은 null */
export function contractDraft(e: ContractEvent, ctx: InboxContext): InboxDraft | null {
  if (e.clubId !== ctx.userClubId) return null;
  const name = 'playerId' in e ? (ctx.nameOf(e.playerId) ?? e.playerId) : '';
  switch (e.kind) {
    case 'RENEWAL_OPEN':
      return e.playerIds.length
        ? { kind: 'RENEWAL_OPEN', title: '재계약 협상 시작', body: `계약이 이번 시즌에 끝나는 선수 ${e.playerIds.length}명과 Day 27까지 재계약할 수 있어요. 재계약하지 않으면 시즌이 끝날 때 FA가 돼요.`, clubId: e.clubId }
        : null;
    case 'CONTRACT_EXPIRED':
      return { kind: 'CONTRACT_EXPIRED', title: `${name} 계약 만료`, body: `${name} 선수의 계약이 끝나 FA 풀로 떠났어요.`, playerId: e.playerId, clubId: e.clubId };
    case 'PLAYER_RELEASED':
      return {
        kind: 'PLAYER_RELEASED',
        title: `${name} 방출`,
        body: e.penalty > 0 ? `${name} 선수를 방출했어요. 위약금 ${fmtM(e.penalty)}를 냈어요.` : `${name} 선수를 위약금 없이 방출했어요.`,
        playerId: e.playerId,
        clubId: e.clubId,
      };
    case 'NEGATIVE_BALANCE':
      return { kind: 'NEGATIVE_BALANCE', title: '잔액 부족', body: `구단 잔액이 ${fmtM(e.balance)}예요. 3일 안에 0 이상으로 돌려놓지 않으면 선수가 강제로 매각돼요.`, clubId: e.clubId };
    case 'FORCED_SALE':
      return { kind: 'FORCED_SALE', title: `${name} 강제 매각`, body: `잔액 부족으로 ${name} 선수가 ${fmtM(e.amount)}에 매각됐어요.`, playerId: e.playerId, clubId: e.clubId };
    default:
      return null;
  }
}

/** id 규칙: `s{season}-d{day}-{kind}-{n}`, n = 같은 접두의 기존 편지 수부터 0,1,2… */
export function inboxId(season: SeasonNo, day: Day, kind: InboxKind, n: number): string {
  return `s${season}-d${day}-${kind}-${n}`;
}

const absDay = (season: SeasonNo, day: Day) => (season - 1) * SEASON_DAYS + day;

/** D27 보관: 84일 이상 지난 편지 삭제, 그 뒤 개수 상한 넘으면 오래된 것부터 삭제. inbox 는 오래된 → 최신 순 */
export function pruneInbox(inbox: readonly InboxMessage[], season: SeasonNo, day: Day): InboxMessage[] {
  const now = absDay(season, day);
  const kept = inbox.filter((m) => now - absDay(m.season, m.day) < INBOX.keepDays);
  return kept.length > INBOX.maxMessages ? kept.slice(kept.length - INBOX.maxMessages) : kept;
}

/** 초안을 (season, day) 편지로 붙이고 보관 규칙 적용. 입력 순서 = 편지 순서 */
export function appendInbox(inbox: readonly InboxMessage[], drafts: readonly (InboxDraft | null)[], season: SeasonNo, day: Day): InboxMessage[] {
  const used = new Set(inbox.map((m) => m.id));
  const next = [...inbox];
  for (const d of drafts) {
    if (!d) continue;
    let n = 0;
    while (used.has(inboxId(season, day, d.kind, n))) n++;
    const id = inboxId(season, day, d.kind, n);
    used.add(id);
    next.push({ ...d, id, season, day, read: false });
  }
  return pruneInbox(next, season, day);
}
