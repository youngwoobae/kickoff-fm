/** M4.8: 서비스로 확인된 도메인 문제 수정 (긴급 FA·자기 선수 입찰·재계약 선수 판매·중간 창 2차 AI 입찰) */
import { describe, expect, it } from 'vitest';
import { createGameService, createMemoryStorage, isGameError, type GameService } from '../../src/services';
import type { GameErrorCode, GameState } from '../../src/types';

const clock = { nowIso: () => '2026-10-04T00:00:00.000Z' };
type Svc = Required<GameService>;
const mk = (seed = 7): Svc => {
  const s = createGameService({ storage: createMemoryStorage(), clock }) as Svc;
  s.newGame({ seed });
  return s;
};
const snap = (s: Svc) => s.getSnapshot()! as GameState;

function goTo(s: Svc, season: number, day: number): void {
  for (let i = 0; i < 200; i++) {
    const t = snap(s).time;
    if (t.season === season && t.day === day && snap(s).phase !== 'SEASON_OVER') return;
    if (snap(s).phase === 'SEASON_OVER') s.startNewSeason();
    else s.advanceDay();
  }
  throw new Error(`도달 실패 ${season}/${day}`);
}

function codeOf(fn: () => unknown): GameErrorCode | null {
  try {
    fn();
  } catch (e) {
    if (isGameError(e)) return e.code;
    throw e;
  }
  return null;
}

const registered = (s: Svc) => s.getSquad().filter((x) => !x.isTemporary);

describe('M4.8 도메인 수정', () => {
  it('긴급 FA: Day 28 에 18명이면 계약하지 않고, 경계에서 만료로 줄면 새 시즌 Day 1 날짜로 채운다. 방출한 선수는 다시 데려오지 않는다', () => {
    const s = mk();
    goTo(s, 1, 26);
    const released = new Set<string>();
    while (registered(s).length > 18) {
      const p = registered(s).sort((a, b) => b.contract.seasonsLeft - a.contract.seasonsLeft || a.ovr - b.ovr)[0]!; // 만료 예정자는 남긴다
      released.add(p.id);
      s.releasePlayer(p.id);
    }
    goTo(s, 1, 28);
    expect(registered(s)).toHaveLength(18);
    expect(s.getInbox().some((m) => m.title === '긴급 FA 계약')).toBe(false);
    const expiring = registered(s).filter((p) => p.contract.seasonsLeft === 1).length;
    expect(expiring).toBeGreaterThan(0);
    while (snap(s).phase !== 'SEASON_OVER') s.advanceDay();
    s.startNewSeason();
    const mail = s.getInbox().find((m) => m.title === '긴급 FA 계약');
    expect(mail).toMatchObject({ season: 2, day: 1 });
    expect(registered(s).length).toBeGreaterThanOrEqual(18);
    expect(registered(s).some((p) => released.has(p.id))).toBe(false);
  }, 60_000);

  it('만료 예정 FA 매물(Day 28)이 우리 선수면 입찰할 수 없다', () => {
    const s = mk();
    goTo(s, 1, 28);
    const ownIds = new Set(s.getSquad().map((p) => p.id));
    const own = s.listTransferListings({ kind: 'FA' }).find((l) => ownIds.has(l.playerId))!;
    expect(own).toBeDefined();
    expect(codeOf(() => s.placeBid({ listingId: own.id, bonus: 0, salary: own.salaryFloor!, seasons: own.seasonsRange![0] }))).toBe('BID_OUT_OF_RANGE');
    // AI 도 자기 만료 예정자에게 입찰하지 않는다
    const m = snap(s).transferMarket!;
    const sellerOf = new Map(Object.values(snap(s).players).map((p) => [p.id, p.clubId]));
    const listing = new Map(m.listings.map((l) => [l.id, l]));
    expect(m.bids.some((b) => listing.get(b.listingId)?.kind === 'FA' && sellerOf.get(listing.get(b.listingId)!.playerId) === b.clubId)).toBe(false);
  }, 60_000);

  it('재계약이 성립한 선수는 정규 창에 판매 등록할 수 있다', () => {
    const s = mk();
    goTo(s, 1, 20);
    const p = s.getSquad().find((x) => x.contract.seasonsLeft === 1 && !x.isTemporary)!;
    const q = s.getRenewalQuote(p.id);
    expect(s.offerRenewal(p.id, q.askSalary, q.seasonsRange[1]).accepted).toBe(true);
    goTo(s, 1, 25);
    const v = s.getPlayerValue(p.id);
    expect(s.listForSale(p.id, v.maxPrice).playerId).toBe(p.id);
  }, 60_000);

  it('중간 창: Day 14 처리에서 AI 가 2차 입찰한다(사람이 Day 11 뒤에 올린 매물도 판단 대상)', () => {
    const s = mk();
    goTo(s, 1, 12);
    const p = [...registered(s)].sort((a, b) => b.ovr - a.ovr)[0]!;
    const l = s.listForSale(p.id, s.getPlayerValue(p.id).minPrice);
    expect(snap(s).transferMarket!.bids.some((b) => b.listingId === l.id)).toBe(false);
    goTo(s, 1, 14);
    const ai = snap(s).transferMarket!.bids.filter((b) => b.clubId !== snap(s).userClubId);
    expect(ai.length).toBeGreaterThan(0);
    expect(ai.every((b) => b.placedDay === 14)).toBe(true); // Day 11 입찰은 Day 14 판단으로 바뀐다
  }, 60_000);
});
