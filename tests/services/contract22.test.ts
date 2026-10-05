/** 서비스 계약 2.2.0 (M4.1, 추가만): 이적·계약·받은 편지함 메서드의 안전한 기본 구현 */
import { describe, expect, it } from 'vitest';
import { clock } from '../helpers';
import { CONTRACT_VERSION, createGameService, createMemoryStorage, isGameError, type GameService } from '../../src/services';
import type { GameErrorCode, InboxMessage } from '../../src/types';

const mk = (): GameService => {
  const s = createGameService({ storage: createMemoryStorage(), clock });
  s.newGame({ seed: 5 });
  return s;
};

function codeOf(fn: () => unknown): GameErrorCode | null {
  try {
    fn();
  } catch (e) {
    if (isGameError(e)) return e.code;
    throw e;
  }
  return null;
}

describe('서비스 계약 2.2.0 (2.2.1 연결 뒤에도 유지되는 부분)', () => {
  it('계약 버전 (유일한 버전 단언)', () => {
    expect(CONTRACT_VERSION).toBe('2.5.0');
    expect(mk().contractVersion).toBe('2.5.0');
  });

  it('게임 없으면 NO_GAME', () => {
    const s = createGameService({ storage: createMemoryStorage(), clock });
    expect(codeOf(() => s.getTransferWindow!())).toBe('NO_GAME');
    expect(codeOf(() => s.getInbox!())).toBe('NO_GAME');
  });

  it('이적: 창 없음 = null·빈 목록, 변경은 WINDOW_CLOSED', () => {
    const s = mk();
    const mine = s.getSquad()[0]!.id;
    expect(s.getTransferWindow!()).toBeNull();
    expect(s.listTransferListings!({ kind: 'NPC' })).toEqual([]);
    expect(s.listBids!()).toEqual([]);
    expect(codeOf(() => s.placeBid!({ listingId: 'x', fee: 1_000_000 }))).toBe('WINDOW_CLOSED');
    expect(codeOf(() => s.withdrawBid!('x'))).toBe('WINDOW_CLOSED');
    expect(codeOf(() => s.listForSale!(mine, 1_000_000))).toBe('WINDOW_CLOSED');
    expect(codeOf(() => s.withdrawListing!('x'))).toBe('WINDOW_CLOSED');
    expect(codeOf(() => s.listForSale!('nobody', 1))).toBe('NOT_FOUND');
  });

  it('계약: 재계약 RENEWAL_NOT_OPEN, 방출 견적은 언제나(2.2.1), 남의 선수 NOT_FOUND', () => {
    const s = mk();
    const mine = s.getSquad()[0]!.id;
    const other = s.getSnapshot()!.userClubId === 'c02' ? 'c01' : 'c02';
    const theirs = s.getSquad(other)[0]!.id;
    expect(codeOf(() => s.getRenewalQuote!(mine))).toBe('RENEWAL_NOT_OPEN');
    expect(codeOf(() => s.offerRenewal!(mine, 1, 1))).toBe('RENEWAL_NOT_OPEN');
    expect(s.getReleaseQuote!(mine)).toMatchObject({ playerId: mine, exempt: false });
    expect(codeOf(() => s.getRenewalQuote!(theirs))).toBe('NOT_FOUND');
    expect(codeOf(() => s.releasePlayer!(theirs))).toBe('NOT_FOUND');
  });

  it('권한: 코치는 변경 PERMISSION_DENIED, 조회는 허용', () => {
    const s = mk();
    const mine = s.getSquad()[0]!.id;
    s.switchRole('COACH');
    expect(codeOf(() => s.placeBid!({ listingId: 'x', fee: 1 }))).toBe('PERMISSION_DENIED');
    expect(codeOf(() => s.listForSale!(mine, 1))).toBe('PERMISSION_DENIED');
    expect(codeOf(() => s.offerRenewal!(mine, 1, 1))).toBe('PERMISSION_DENIED');
    expect(codeOf(() => s.releasePlayer!(mine))).toBe('PERMISSION_DENIED');
    expect(s.listTransferListings!()).toEqual([]);
    expect(s.getInbox!()).toEqual([]);
  });

  it('편지함: 최신 먼저·안 읽은 것 필터·같은 상태 같은 참조·markRead', () => {
    const s = mk();
    const msg = (id: string, day: number): InboxMessage => ({ id, season: 1, day, kind: 'GENERAL', title: id, body: '', read: false });
    const snap = s.getSnapshot()!;
    // 도메인 생성(M4.2) 전이라 세이브 가져오기로 메시지를 넣는다
    s.importSave(JSON.stringify({ ...snap, inbox: [msg('a', 1), msg('b', 2), msg('c', 3)] }));
    expect(s.getInbox!().map((m) => m.id)).toEqual(['c', 'b', 'a']);
    expect(s.getInbox!()).toBe(s.getInbox!());

    let calls = 0;
    s.subscribe(() => calls++);
    s.markRead!(['b', 'zzz']);
    expect(calls).toBe(1);
    expect(s.getInbox!({ unreadOnly: true }).map((m) => m.id)).toEqual(['c', 'a']);
    s.markRead!(['b']); // 바뀐 것 없음 → 통지 없음
    expect(calls).toBe(1);
    s.markRead!();
    expect(s.getInbox!({ unreadOnly: true })).toEqual([]);
    expect(s.getInbox!().every((m) => m.read)).toBe(true);
    expect(s.getSnapshot()!.seq).toBe(snap.seq); // 읽음은 게임 사건이 아니다
  });
});
