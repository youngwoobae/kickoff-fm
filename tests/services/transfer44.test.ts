/** M4.4: 이적·계약·편지함 서비스 연결 (창 열림 → 입찰 → AI 입찰 → 정산, 판매, 재계약, 방출, 만료 FA, 강제 매각, 결정성, 이전 세이브) */
import { describe, expect, it } from 'vitest';
import { createGameService, createMemoryStorage, isGameError, type GameService } from '../../src/services';
import { TRANSFER } from '../../src/domain';
import type { GameErrorCode, GameState, LedgerEntry } from '../../src/types';

const clock = { nowIso: () => '2026-10-04T00:00:00.000Z' };
type Svc = Required<GameService>;
const mk = (seed = 7): Svc => {
  const s = createGameService({ storage: createMemoryStorage(), clock }) as Svc;
  s.newGame({ seed });
  return s;
};
const snap = (s: Svc) => s.getSnapshot()! as GameState;

/** (season, day) 까지 진행 (SEASON_OVER 면 새 시즌) */
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

const userLedger = (s: Svc): LedgerEntry[] => snap(s).finances[snap(s).userClubId]!.ledger;

describe('이적 연결 (M4.4)', () => {
  it('중간 창: Day 11 열림 → 사람 입찰(예약) → 정산 Day 15 → 선수 이동·원장·편지', () => {
    const s = mk();
    goTo(s, 1, 10);
    expect(s.getTransferWindow()).toBeNull();
    s.advanceDay();
    const w = s.getTransferWindow()!;
    expect(w).toMatchObject({ kind: 'MID', season: 1, openDay: 11, settleDay: 15, settleSeason: 1 });
    expect(s.getInbox().some((m) => m.kind === 'WINDOW_OPENED')).toBe(true);
    const npc = s.listTransferListings({ kind: 'NPC' });
    expect(npc).toHaveLength(10);
    expect(s.getPlayer(npc[0]!.playerId).id).toBe(npc[0]!.playerId); // NPC 도 getPlayer
    // AI 입찰은 열림과 같은 처리에서 들어간다(비공개)
    expect(snap(s).transferMarket!.bids.some((b) => b.clubId !== snap(s).userClubId)).toBe(true);
    expect(s.listBids()).toEqual([]);

    // 사람 입찰: 우리 티어(T5) NPC 중 가장 싼 것, 최고가
    const cheap = [...npc].sort((a, b) => a.minPrice - b.minPrice)[0]!;
    const f0 = s.getFinance();
    expect(codeOf(() => s.placeBid({ listingId: cheap.id, fee: cheap.maxPrice + 1000 }))).toBe('BID_OUT_OF_RANGE');
    try {
      s.placeBid({ listingId: cheap.id, fee: cheap.maxPrice + 1000 });
    } catch (e) {
      expect((e as Error).message).toMatch(/M~.*M 사이여야 해요/); // 해요체 + 범위
    }
    const bid = s.placeBid({ listingId: cheap.id, fee: cheap.maxPrice });
    expect(bid).toMatchObject({ clubId: snap(s).userClubId, placedDay: 11, fee: cheap.maxPrice });
    const f1 = s.getFinance();
    expect(f1.reserved).toBe(cheap.maxPrice);
    expect(f1.spendable).toBe(f0.spendable - cheap.maxPrice);
    expect(s.listBids()).toHaveLength(1);
    // 철회·재입찰
    s.withdrawBid(cheap.id);
    expect(s.getFinance().reserved).toBe(0);
    expect(codeOf(() => s.withdrawBid(cheap.id))).toBe('NOT_FOUND');
    s.placeBid({ listingId: cheap.id, fee: cheap.maxPrice });

    const before = snap(s).clubs[snap(s).userClubId]!.playerIds.length;
    goTo(s, 1, 15);
    expect(s.getTransferWindow()).toBeNull();
    expect(s.listBids()).toEqual([]);
    expect(s.getFinance().reserved).toBe(0);
    const won = s.getInbox().find((m) => m.listingId === cheap.id)!;
    expect(won.kind).toBe('BID_WON'); // 최고가(1.3V) 입찰
    {
      expect(snap(s).players[cheap.playerId]!.clubId).toBe(snap(s).userClubId);
      expect(snap(s).clubs[snap(s).userClubId]!.playerIds).toHaveLength(before + 1);
      expect(userLedger(s).some((e) => e.kind === 'TRANSFER_FEE_PAID' && e.amount === -cheap.maxPrice)).toBe(true);
      expect(snap(s).signingsThisSeason![snap(s).userClubId]).toBe(1);
    }
    // NPC 미판매분은 세계에 남지 않는다
    const npcIds = Object.keys(snap(s).players).filter((id) => id.startsWith('n1M-'));
    expect(npcIds.every((id) => snap(s).players[id]!.clubId !== null)).toBe(true);
  });

  it('정규 창: 판매 등록(Day 25~27) → Day 28 AI 입찰 → 다음 시즌 Day 2 정산 → 이적료 수입·이적세·편지', () => {
    // AI 는 싼 FA·필요 포지션을 먼저 사서 사람 매물 낙찰은 드물다 — 이 시드는 판매 가능 선수를 모두 최저가에 올리면 AI 입찰 7건
    const s = mk(3);
    goTo(s, 1, 25);
    expect(s.getTransferWindow()).toMatchObject({ kind: 'REGULAR', season: 1, settleSeason: 2, settleDay: 2 });
    const mine = s.getSquad().filter((p) => p.contract.seasonsLeft >= 2 && p.age <= 30);
    expect(mine.length).toBeGreaterThan(0);
    const exp = s.getSquad().find((p) => p.contract.seasonsLeft === 1);
    if (exp) expect(codeOf(() => s.listForSale(exp.id, s.getPlayerValue(exp.id).minPrice))).toBe('BID_OUT_OF_RANGE');
    const ids = mine.map((p) => {
      const v = s.getPlayerValue(p.id);
      expect(v.minPrice).toBe(Math.round((0.7 * v.value) / 1000) * 1000);
      expect(codeOf(() => s.listForSale(p.id, v.minPrice - 1000))).toBe('BID_OUT_OF_RANGE');
      return s.listForSale(p.id, v.minPrice).id;
    });
    expect(codeOf(() => s.placeBid({ listingId: ids[0]!, fee: s.listTransferListings().find((l) => l.id === ids[0])!.minPrice }))).toBe('BID_OUT_OF_RANGE'); // 자기 매물
    // 철회 후 다시
    s.withdrawListing(ids[0]!);
    expect(s.listTransferListings().some((l) => l.id === ids[0])).toBe(false);
    s.listForSale(mine[0]!.id, s.getPlayerValue(mine[0]!.id).minPrice);

    goTo(s, 1, 28);
    const m = snap(s).transferMarket!;
    // Day 28: 만료 예정 FA 등록 + AI 입찰
    expect(m.listings.some((l) => l.kind === 'FA' && snap(s).players[l.playerId]?.clubId)).toBe(true);
    const aiOnMine = m.bids.filter((b) => ids.includes(b.listingId));
    expect(aiOnMine.length).toBeGreaterThan(0);
    s.advanceDay(); // SEASON_OVER
    s.startNewSeason();
    expect(s.getTransferWindow()).not.toBeNull(); // 정규 창은 경계를 넘어 Day 2 까지
    s.advanceDay(); // Day 2 정산
    expect(s.getTransferWindow()).toBeNull();
    const sold = s.getInbox().filter((x) => x.kind === 'PLAYER_SOLD');
    expect(sold.length).toBeGreaterThan(0);
    const got = userLedger(s).filter((e) => e.kind === 'TRANSFER_FEE_RECEIVED');
    const tax = userLedger(s).filter((e) => e.kind === 'TRANSFER_TAX');
    expect(got.length).toBe(sold.length);
    for (let i = 0; i < got.length; i++) expect(tax[i]!.amount).toBe(-Math.round(got[i]!.amount * TRANSFER.taxRate));
    for (const x of sold) expect(snap(s).players[x.playerId!]!.clubId).not.toBe(snap(s).userClubId);
  });

  it('재계약: Day 20 편지 → 견적·거절·수락 → 갱신 보너스 → 경계에서 새 계약, 안 한 선수는 FA·편지', () => {
    const s = mk();
    expect(codeOf(() => s.getRenewalQuote(s.getSquad()[0]!.id))).toBe('RENEWAL_NOT_OPEN');
    goTo(s, 1, 20);
    expect(s.getInbox().some((m) => m.kind === 'RENEWAL_OPEN')).toBe(true);
    const expiring = s.getSquad().filter((p) => p.contract.seasonsLeft === 1 && !p.retiring);
    expect(expiring.length).toBeGreaterThanOrEqual(2);
    const [a, b] = expiring;
    const q = s.getRenewalQuote(a!.id);
    expect(q.askSalary).toBeGreaterThan(0);
    expect(s.offerRenewal(a!.id, q.askSalary - 1000, 1)).toEqual({ accepted: false, ask: q.askSalary });
    expect(s.offerRenewal(a!.id, q.askSalary, q.seasonsRange[1] + 1).accepted).toBe(false);
    const bal = s.getFinance().balance;
    expect(s.offerRenewal(a!.id, q.askSalary, q.seasonsRange[1])).toEqual({ accepted: true, ask: q.askSalary });
    const bonus = Math.round((0.1 * q.askSalary * q.seasonsRange[1]) / 1000) * 1000;
    expect(s.getFinance().balance).toBe(bal - bonus);
    expect(userLedger(s).at(-1)).toMatchObject({ kind: 'RENEWAL_BONUS', amount: -bonus });

    goTo(s, 2, 1);
    const pa = snap(s).players[a!.id]!;
    expect(pa.clubId).toBe(snap(s).userClubId);
    expect(pa.contract).toMatchObject({ seasonsLeft: q.seasonsRange[1], salary: q.askSalary });
    expect(pa.contract.bonusPerSeason).toBe(Math.round(bonus / q.seasonsRange[1]));
    // b 는 재계약 안 함 → FA (편지)
    const pb = snap(s).players[b!.id];
    if (pb) expect(pb.clubId === null || pb.contract.seasonsLeft === 1).toBe(true); // 긴급 FA 로 다시 왔을 수도
    expect(s.getInbox().some((m) => m.kind === 'CONTRACT_EXPIRED' && m.playerId === b!.id)).toBe(true);
    expect(snap(s).pendingRenewals).toEqual([]);
    expect(snap(s).signingsThisSeason).toEqual({});
  });

  it('방출: 견적 = 위약금 0.5 × 잔여 연봉, 실행하면 원장·FA 풀·편지, 18명 아래면 긴급 FA', () => {
    const s = mk();
    goTo(s, 1, 10);
    const p = s.getSquad().find((x) => x.contract.seasonsLeft >= 2)!;
    const q = s.getReleaseQuote(p.id);
    const remaining = Math.round((p.contract.salary * (29 - 10)) / 28 + p.contract.salary * (p.contract.seasonsLeft - 1));
    expect(q).toEqual({ playerId: p.id, penalty: Math.round((0.5 * remaining) / 1000) * 1000, exempt: false });
    const bal = s.getFinance().balance;
    s.releasePlayer(p.id);
    expect(snap(s).players[p.id]!.clubId).toBeNull();
    expect(s.getFinance().balance).toBe(bal - q.penalty);
    expect(userLedger(s).at(-1)).toMatchObject({ kind: 'RELEASE_PENALTY', amount: -q.penalty });
    expect(s.getInbox()[0]).toMatchObject({ kind: 'PLAYER_RELEASED', playerId: p.id });
    expect(codeOf(() => s.releasePlayer(p.id))).toBe('NOT_FOUND');
    // 18명 아래로 내리면 긴급 FA 가 채운다
    while (s.getSquad().filter((x) => !x.isTemporary).length > 18) s.releasePlayer(s.getSquad().at(-1)!.id);
    s.releasePlayer(s.getSquad().at(-1)!.id);
    expect(s.getSquad().length).toBe(18);
    expect(s.getInbox()[0]!.kind).toBe('GENERAL');
    s.switchRole('COACH');
    expect(codeOf(() => s.releasePlayer(s.getSquad()[0]!.id))).toBe('PERMISSION_DENIED');
  });

  it('D18: 잔액 음수 → 잠금(입찰 금지)·편지 → 3일째 처리 뒤 강제 매각 0.5V', () => {
    const s = mk();
    goTo(s, 1, 11);
    const x = snap(s);
    const uid = x.userClubId;
    const neg: GameState = { ...x, finances: { ...x.finances, [uid]: { ...x.finances[uid]!, balance: -5_000_000 } } };
    s.importSave(JSON.stringify(neg));
    const l = s.listTransferListings({ kind: 'NPC' })[0]!;
    expect(codeOf(() => s.placeBid({ listingId: l.id, fee: l.minPrice }))).toBe('NEGATIVE_BALANCE_LOCK');
    s.advanceDay(); // 1일째
    expect(snap(s).finances[uid]!.negativeSinceDay).toBe(12);
    expect(s.getInbox().some((m) => m.kind === 'NEGATIVE_BALANCE')).toBe(true);
    const size = s.getSquad().length;
    s.advanceDay(); // 2일째
    expect(s.getSquad().length).toBe(size);
    s.advanceDay(); // 3일째 → 매각
    const sales = userLedger(s).filter((e) => e.kind === 'FORCED_SALE');
    expect(sales.length).toBeGreaterThan(0);
    expect(s.getInbox().filter((m) => m.kind === 'FORCED_SALE')).toHaveLength(sales.length);
    expect(s.getFinance().balance).toBeGreaterThanOrEqual(0);
    s.advanceDay();
    expect(snap(s).finances[uid]!.negativeSinceDay).toBeUndefined();
  });

  it('결정성: 같은 시드·같은 행동이면 2시즌 뒤 상태가 같다', () => {
    const play = () => {
      const s = mk(11);
      goTo(s, 1, 11);
      const l = s.listTransferListings({ kind: 'NPC' }).sort((a, b) => a.minPrice - b.minPrice)[0]!;
      s.placeBid({ listingId: l.id, fee: l.minPrice });
      goTo(s, 2, 28);
      s.advanceDay();
      const x = snap(s);
      return JSON.stringify({ ...x, actionLog: [] });
    };
    expect(play()).toBe(play());
  });

  it('이전 세이브(새 필드 없음)도 열리고 창·재계약·경계가 돈다', () => {
    const s = mk();
    goTo(s, 1, 24);
    const x = snap(s);
    const old = { ...x } as Partial<GameState>;
    delete old.transferMarket;
    delete old.inbox;
    delete old.pendingRenewals; // Day 20 을 이 코드 없이 지난 세이브
    delete old.signingsThisSeason;
    const t = createGameService({ storage: createMemoryStorage(), clock }) as Svc;
    t.importSave(JSON.stringify(old));
    expect(t.getInbox()).toEqual([]);
    t.advanceDay(); // Day 25 정규 창
    expect(t.getTransferWindow()?.kind).toBe('REGULAR');
    const expiring = t.getSquad().filter((p) => p.contract.seasonsLeft === 1 && !p.retiring).map((p) => p.id);
    t.advanceToSeasonEnd();
    t.startNewSeason();
    // pendingRenewals 가 없으면 경계는 사람 구단도 AI 규칙으로 재계약(이전 동작에 가깝게): 상위 선수는 남는다
    const kept = expiring.filter((id) => t.getSnapshot()!.players[id]?.clubId === t.getSnapshot()!.userClubId);
    expect(kept.length).toBeGreaterThan(0);
    expect(t.getSquad().length).toBeGreaterThanOrEqual(18);
  });
});
