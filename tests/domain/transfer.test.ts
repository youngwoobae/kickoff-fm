/** 이적 도메인 (M4.3). 기준: docs/설계/오프라인_경제.md 6·7장, D16~D18 */
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/engine';
import type { Bid, Player, Position, Tier, TransferListing } from '../../src/types';
import { TIER_ECONOMY, baseSalary, startingBalance } from '../../src/domain/economy/economy';
import { TIER_REFERENCE_OVR, generatePlayer, generateSquad } from '../../src/domain/squad/generator';
import { squadStrength } from '../../src/domain/squad/lifecycle';
import {
  budgetB,
  isSettleDay,
  potentialEstimate,
  valueOf,
  windowAt,
  windowOf,
} from '../../src/domain/transfer/value';
import {
  type MarketClub,
  clubListing,
  faListing,
  forcedSales,
  generateNpcListings,
  negativeBalanceStatus,
  reservationOf,
  settleWindow,
  upsertBid,
  validateBid,
} from '../../src/domain/transfer/market';
import { capUsage as capUse } from '../../src/domain/contract/contract';
import { aiAggr, aiBids, aiSellListings, aiTransferBudget } from '../../src/domain/transfer/ai';

const SEED = 20261004;
const M = 1_000_000;
const REG = windowOf(1, 'REGULAR');
const MID = windowOf(1, 'MID');

function mk(id: string, clubId: string | null, ovr: number, age = 25, extra: Partial<Player> = {}, pos: Position = 'CM'): Player {
  const p = generatePlayer(mulberry32(id.length * 7919 + ovr), pos, ovr, age);
  return {
    ...p,
    id,
    clubId,
    ovr,
    scoutRange: ['E', 'E'],
    contract: { seasonsLeft: 3, salary: baseSalary(ovr) },
    ...extra,
  };
}

function club(id: string, tier: Tier, extra: Partial<MarketClub> = {}): MarketClub {
  return { id, tier, balance: 50 * M, transferOnly: 0, budget: 50 * M, capLimit: 1000 * M, signings: 0, signingLimit: 8, ...extra };
}

const asMap = <T extends { id: string }>(xs: readonly T[]) => Object.fromEntries(xs.map((x) => [x.id, x]));

describe('창 일정 (D16)', () => {
  it('중간 창 Day 11~15, 정규 창 Day 25 ~ 다음 시즌 Day 2', () => {
    expect(windowAt({ season: 3, day: 10 })).toBeNull();
    expect(windowAt({ season: 3, day: 11 })).toEqual({ kind: 'MID', season: 3, openDay: 11, settleDay: 15, settleSeason: 3 });
    expect(windowAt({ season: 3, day: 15 })?.kind).toBe('MID');
    expect(windowAt({ season: 3, day: 16 })).toBeNull();
    expect(windowAt({ season: 3, day: 24 })).toBeNull();
    expect(windowAt({ season: 3, day: 25 })).toEqual({ kind: 'REGULAR', season: 3, openDay: 25, settleDay: 2, settleSeason: 4 });
    expect(windowAt({ season: 4, day: 2 })).toEqual(windowOf(3, 'REGULAR'));
    expect(windowAt({ season: 4, day: 3 })).toBeNull();
    expect(windowAt({ season: 1, day: 1 })).toBeNull();
    expect(isSettleDay({ season: 4, day: 2 }, windowOf(3, 'REGULAR'))).toBe(true);
    expect(isSettleDay({ season: 3, day: 2 }, windowOf(3, 'REGULAR'))).toBe(false);
  });
});

describe('평가가치 V (6.1, 스크립트 D 표)', () => {
  const cases: [string, Parameters<typeof valueOf>[0], number][] = [
    ['T5 유망주 18세 OVR44 +14', { ovr: 44, age: 18, seasonsLeft: 3, potEstimate: 58 }, 8.61],
    ['T5 주전 25세 OVR48 2시즌', { ovr: 48, age: 25, seasonsLeft: 2, potEstimate: 48 }, 5.31],
    ['T3 주전 25세 OVR60 2시즌', { ovr: 60, age: 25, seasonsLeft: 2, potEstimate: 60 }, 12.75],
    ['T3 주전 29세 OVR60 1시즌', { ovr: 60, age: 29, seasonsLeft: 1, potEstimate: 60 }, 7.2],
    ['T3 베테랑 32세 OVR61 1시즌', { ovr: 61, age: 32, seasonsLeft: 1, potEstimate: 61 }, 4.84],
    ['T1 스타 24세 OVR78 +4', { ovr: 78, age: 24, seasonsLeft: 3, potEstimate: 82 }, 62.56],
    ['T1 주전 27세 OVR72 3시즌', { ovr: 72, age: 27, seasonsLeft: 3, potEstimate: 72 }, 36.04],
  ];
  it.each(cases)('%s', (_n, input, expectM) => {
    const v = valueOf(input);
    expect(v % 1000).toBe(0);
    expect(Math.abs(v - expectM * M)).toBeLessThanOrEqual(15_000); // 표는 0.01M 반올림
  });

  it('잠재력 계수 상한 0.45, 공개 추정치 = 등급 구간 중간값', () => {
    expect(valueOf({ ovr: 50, age: 25, seasonsLeft: 3, potEstimate: 90 })).toBe(Math.round((5 * baseSalary(50) * 1.45) / 1000) * 1000);
    expect(potentialEstimate(['D', 'B'])).toBe(60.5);
    expect(potentialEstimate(['S', 'S'])).toBe(85);
  });
});

describe('매물·입찰 범위 (6.2·6.3)', () => {
  const seller = mk('s1', 'A', 60, 25, { contract: { seasonsLeft: 2, salary: 3 * M } });
  const V = 12.75 * M;

  it('구단 명단 최저가 0.7V~1.3V, 정규 창 잔여 1시즌 불가', () => {
    expect(clubListing(MID, seller, 0.7 * V).maxPrice).toBe(Math.round((1.3 * V) / 1000) * 1000);
    expect(() => clubListing(MID, seller, 0.7 * V - 1000)).toThrow(expect.objectContaining({ code: 'BID_OUT_OF_RANGE' }));
    expect(() => clubListing(MID, seller, 1.3 * V + 1000)).toThrow(expect.objectContaining({ code: 'BID_OUT_OF_RANGE' }));
    expect(() => clubListing(REG, { ...seller, contract: { seasonsLeft: 1, salary: 1 } }, V)).toThrow(expect.objectContaining({ code: 'BID_OUT_OF_RANGE' }));
  });

  it('이적료 입찰: 최저가·1.3V 경계 포함, 밖은 BID_OUT_OF_RANGE', () => {
    const l = clubListing(MID, seller, V);
    const base = { window: MID, listing: l, club: club('B', 'T3'), clubBids: [], listings: asMap([l]), placedDay: 12 };
    expect(validateBid({ ...base, input: { listingId: l.id, fee: l.minPrice } }).fee).toBe(l.minPrice);
    expect(validateBid({ ...base, input: { listingId: l.id, fee: l.maxPrice } }).fee).toBe(l.maxPrice);
    for (const fee of [l.minPrice - 1, l.maxPrice + 1, 1.5]) {
      expect(() => validateBid({ ...base, input: { listingId: l.id, fee } })).toThrow(expect.objectContaining({ code: 'BID_OUT_OF_RANGE' }));
    }
    expect(() => validateBid({ ...base, club: club('A', 'T3'), input: { listingId: l.id, fee: V } })).toThrow(expect.objectContaining({ code: 'BID_OUT_OF_RANGE' }));
  });

  it('FA 입찰: 계약금 0~1.0S, 연봉 ≥ 0.9S, 기간 허용 범위', () => {
    const fa = mk('f1', null, 60, 31);
    const l = faListing(MID, fa);
    expect(l).toMatchObject({ minPrice: 0, maxPrice: 0, bonusMax: 3 * M, salaryFloor: 2.7 * M, seasonsRange: [1, 2] });
    const base = { window: MID, listing: l, club: club('B', 'T3'), clubBids: [], listings: asMap([l]), placedDay: 12 };
    const ok = { listingId: l.id, bonus: 3 * M, salary: 2.7 * M, seasons: 2 };
    expect(validateBid({ ...base, input: ok })).toMatchObject(ok);
    for (const bad of [{ bonus: 3 * M + 1 }, { bonus: -1 }, { salary: 2.7 * M - 1 }, { seasons: 3 }, { seasons: 0 }]) {
      expect(() => validateBid({ ...base, input: { ...ok, ...bad } })).toThrow(expect.objectContaining({ code: 'BID_OUT_OF_RANGE' }));
    }
    // 예약액 = 계약금 + 연봉 × 남은 일수/28 (중간 창 정산 Day 15 → 13일)
    expect(reservationOf(MID, l, ok)).toBe(3 * M + Math.round((2.7 * M * 13) / 28));
  });

  it('자금 부족·음수 잔액 잠금, 같은 매물 수정은 예약을 두 번 세지 않음', () => {
    const l1 = clubListing(MID, seller, V);
    const l2 = clubListing(MID, mk('s2', 'A', 60, 25, { contract: { seasonsLeft: 2, salary: 3 * M } }), V);
    const listings = asMap([l1, l2]);
    const c = club('B', 'T3', { budget: 2 * V });
    const b1 = validateBid({ window: MID, listing: l1, club: c, clubBids: [], listings, input: { listingId: l1.id, fee: V }, placedDay: 12 });
    expect(validateBid({ window: MID, listing: l2, club: c, clubBids: [b1], listings, input: { listingId: l2.id, fee: V }, placedDay: 12 }).fee).toBe(V);
    expect(() => validateBid({ window: MID, listing: l2, club: c, clubBids: [b1], listings, input: { listingId: l2.id, fee: V + 1000 }, placedDay: 12 })).toThrow(
      expect.objectContaining({ code: 'INSUFFICIENT_FUNDS' }),
    );
    // 같은 매물 재입찰은 기존 예약을 대체
    expect(validateBid({ window: MID, listing: l1, club: club('B', 'T3', { budget: V + 1000 }), clubBids: [b1], listings, input: { listingId: l1.id, fee: V + 1000 }, placedDay: 13 }).fee).toBe(V + 1000);
    expect(upsertBid([b1], { ...b1, fee: V + 1000 })).toHaveLength(1);
    expect(() => validateBid({ window: MID, listing: l1, club: club('B', 'T3', { balance: -1 }), clubBids: [], listings, input: { listingId: l1.id, fee: V }, placedDay: 12 })).toThrow(
      expect.objectContaining({ code: 'NEGATIVE_BALANCE_LOCK' }),
    );
  });

  it('NPC 매물: 정규 티어당 6명·중간 2명, OVR = REF ± 4, 나이 19~30, 가격 V~1.3V, 결정적', () => {
    const a = generateNpcListings(SEED, REG);
    expect(a.listings).toHaveLength(30);
    expect(generateNpcListings(SEED, MID).listings).toHaveLength(10);
    for (const [i, p] of a.players.entries()) {
      const tier = p.id.split('-')[1] as Tier;
      expect(Math.abs(p.ovr - TIER_REFERENCE_OVR[tier])).toBeLessThanOrEqual(5); // 생성기 OVR 오차 ±1 허용
      expect(p.age).toBeGreaterThanOrEqual(19);
      expect(p.age).toBeLessThanOrEqual(30);
      expect(p.clubId).toBeNull();
      const l = a.listings[i]!;
      expect(l.minPrice).toBe(l.value);
      expect(l.maxPrice).toBe(Math.round((1.3 * l.value) / 1000) * 1000);
    }
    expect(generateNpcListings(SEED, REG)).toEqual(a);
  });
});

describe('정산 (6.4, D17)', () => {
  const sellerP = mk('sp', 'S', 60, 25, { contract: { seasonsLeft: 2, salary: 3 * M } });
  const L = clubListing(MID, sellerP, 12.75 * M);
  const bid = (clubId: string, fee: number, listingId = L.id): Bid => ({ listingId, clubId, placedDay: 12, fee });

  it('최고 입찰 낙찰, 이적료 90% 판매자·10% 이적세 소멸, 선수 이동', () => {
    const r = settleWindow({ gameSeed: SEED, window: MID, listings: [L], bids: [bid('B', 13 * M), bid('C', 14 * M)], clubs: [club('S', 'T3'), club('B', 'T3'), club('C', 'T3')], players: asMap([sellerP]) });
    expect(r.deals).toHaveLength(1);
    expect(r.deals[0]).toMatchObject({ toClubId: 'C', fromClubId: 'S', amount: 14 * M, tax: 1.4 * M });
    expect(r.players.sp!.clubId).toBe('C');
    expect(r.money).toEqual([
      { clubId: 'C', kind: 'TRANSFER_FEE_PAID', amount: -14 * M, playerId: 'sp', fromTransferOnly: 0 },
      { clubId: 'S', kind: 'TRANSFER_FEE_RECEIVED', amount: 14 * M, playerId: 'sp' },
      { clubId: 'S', kind: 'TRANSFER_TAX', amount: -1.4 * M, playerId: 'sp' },
    ]);
    const byId = asMap(r.clubs);
    expect(byId.C!.balance).toBe(36 * M);
    expect(byId.S!.balance).toBe(50 * M + 12.6 * M);
    expect(byId.C!.signings).toBe(1);
  });

  it('1,000 KC 단위 동률: 하위 티어 가중 2배 (약 2/3)', () => {
    let lower = 0;
    const N = 600;
    for (let s = 0; s < N; s++) {
      const r = settleWindow({ gameSeed: s, window: MID, listings: [L], bids: [bid('HI', 13_000_000), bid('LO', 13_000_400)], clubs: [club('S', 'T3'), club('HI', 'T2'), club('LO', 'T4')], players: asMap([sellerP]) });
      if (r.deals[0]!.toClubId === 'LO') lower++;
    }
    expect(lower / N).toBeGreaterThan(0.6);
    expect(lower / N).toBeLessThan(0.73);
    // 같은 티어 동률은 1:1, 1,000 KC 이상 차이는 동률 아님
    const r = settleWindow({ gameSeed: 1, window: MID, listings: [L], bids: [bid('HI', 13_000_000), bid('LO', 13_001_000)], clubs: [club('S', 'T3'), club('HI', 'T2'), club('LO', 'T4')], players: asMap([sellerP]) });
    expect(r.deals[0]!.toClubId).toBe('LO');
  });

  it('정산 시점 자금 부족 → 다음 순위 낙찰', () => {
    const other = mk('sq', 'S', 60, 25, { contract: { seasonsLeft: 2, salary: 3 * M } });
    const L2 = clubListing(MID, other, 12.75 * M); // maxPrice 같음 → ID 순: sp 매물 먼저
    const r = settleWindow({
      gameSeed: SEED,
      window: MID,
      listings: [L2, L],
      bids: [bid('B', 15 * M), bid('B', 15 * M, L2.id), bid('C', 13 * M, L2.id)],
      clubs: [club('S', 'T3'), club('B', 'T3', { budget: 20 * M }), club('C', 'T3')],
      players: asMap([sellerP, other]),
    });
    expect(r.deals.map((d) => [d.playerId, d.toClubId])).toEqual([['sp', 'B'], ['sq', 'C']]);
  });

  it('캡 초과·25명·영입 한도·음수 잔액 → 다음 순위, 전원 실패면 미판매', () => {
    const run = (b: Partial<MarketClub>, squad: Player[] = []) =>
      settleWindow({ gameSeed: SEED, window: MID, listings: [L], bids: [bid('B', 15 * M), bid('C', 13 * M)], clubs: [club('S', 'T3'), club('B', 'T3', b), club('C', 'T3')], players: asMap([sellerP, ...squad]) }).deals[0]?.toClubId;
    expect(run({})).toBe('B');
    const sq25 = Array.from({ length: 25 }, (_, i) => mk(`b${i}`, 'B', 50));
    expect(run({}, sq25)).toBe('C');
    expect(run({}, sq25.slice(0, 24))).toBe('B');
    const capFull = capUse(sq25.slice(0, 10));
    expect(run({ capLimit: capFull + 3 * M - 1000 }, sq25.slice(0, 10))).toBe('C');
    expect(run({ capLimit: capFull + 3 * M }, sq25.slice(0, 10))).toBe('B');
    expect(run({ signings: 8 })).toBe('C');
    expect(run({ balance: -1 })).toBe('C');
    const none = settleWindow({ gameSeed: SEED, window: MID, listings: [L], bids: [bid('B', 15 * M)], clubs: [club('S', 'T3'), club('B', 'T3', { signings: 8 })], players: asMap([sellerP]) });
    expect(none.deals).toHaveLength(0);
    expect(none.unsold).toEqual([L.id]);
    // M4.8: 정산 실패 사유를 남긴다 (편지용)
    expect(none.failures).toEqual([{ listingId: L.id, clubId: 'B', reason: '시즌 영입 한도 8명을 다 썼어요' }]);
    const capFail = settleWindow({ gameSeed: SEED, window: MID, listings: [L], bids: [bid('B', 15 * M)], clubs: [club('S', 'T3'), club('B', 'T3', { capLimit: 1 * M })], players: asMap([sellerP]) });
    expect(capFail.failures[0]!.reason).toMatch(/연봉 캡을 넘어요/);
  });

  it('M4.8 입찰 검증: 우리 선수 FA 매물 금지, 중간 창은 정산과 같은 캡·25명·영입 한도를 입찰 때 본다', () => {
    const mine = mk('mine', 'B', 60, 25, { contract: { seasonsLeft: 1, salary: 3 * M } });
    const fa = faListing(REG, mine);
    expect(() => validateBid({ window: REG, listing: fa, input: { listingId: fa.id, bonus: 0, salary: fa.salaryFloor!, seasons: 1 }, club: club('B', 'T3'), clubBids: [], listings: {}, placedDay: 28, playerClubId: 'B' })).toThrow(/재계약/);
    const base = { window: MID, listing: L, input: { listingId: L.id, fee: 13 * M }, clubBids: [], listings: {}, placedDay: 12, player: sellerP };
    expect(() => validateBid({ ...base, club: club('B', 'T3', { signings: 8 }) })).toThrow(/영입 한도/);
    expect(() => validateBid({ ...base, club: club('B', 'T3', { capLimit: 2 * M }), squad: [] })).toThrow(/연봉 캡/);
    const full = Array.from({ length: 25 }, (_, i) => mk(`f${i}`, 'B', 50));
    expect(() => validateBid({ ...base, club: club('B', 'T3'), squad: full })).toThrow(/25명/);
    expect(validateBid({ ...base, club: club('B', 'T3'), squad: full.slice(0, 20) }).fee).toBe(13 * M);
  });

  it('FA 낙찰: 비교값 = 계약금 + 연봉 × 시즌 × 0.5, 계약 생성, 정규 창은 한정 예산 먼저', () => {
    const fa = mk('fa', null, 60, 25, { faSince: 1 });
    const l = faListing(REG, fa);
    const r = settleWindow({
      gameSeed: SEED,
      window: REG,
      listings: [l],
      bids: [
        { listingId: l.id, clubId: 'B', placedDay: 25, bonus: 0, salary: 4 * M, seasons: 3 }, // 6M
        { listingId: l.id, clubId: 'C', placedDay: 25, bonus: 1 * M, salary: 3 * M, seasons: 3 }, // 5.5M
      ],
      clubs: [club('B', 'T3'), club('C', 'T3', { transferOnly: 0.4 * M })],
      players: asMap([fa]),
    });
    expect(r.deals[0]).toMatchObject({ toClubId: 'B', amount: 0, contract: { salary: 4 * M, seasonsLeft: 3, bonusPerSeason: 0 } });
    expect(r.players.fa).toMatchObject({ clubId: 'B', faSince: undefined });
    expect(r.money).toEqual([]); // 계약금 0 은 원장 없음
    const r2 = settleWindow({
      gameSeed: SEED,
      window: REG,
      listings: [l],
      bids: [{ listingId: l.id, clubId: 'C', placedDay: 25, bonus: 1 * M, salary: 3 * M, seasons: 3 }],
      clubs: [club('C', 'T3', { transferOnly: 0.4 * M })],
      players: asMap([fa]),
    });
    expect(r2.money[0]).toMatchObject({ kind: 'SIGNING_BONUS', amount: -1 * M, fromTransferOnly: 0.4 * M });
    expect(r2.clubs[0]).toMatchObject({ transferOnly: 0, balance: 50 * M - 0.6 * M });
    expect(r2.deals[0]!.contract.bonusPerSeason).toBe(333_333);
  });
});

describe('잔액 부족 (D18)', () => {
  it('음수 첫날 잠금 → 3일째 처리 뒤 강제 매각, 시즌 경계 순환', () => {
    expect(negativeBalanceStatus(0, undefined, 5)).toEqual({ locked: false, forceSale: false });
    expect(negativeBalanceStatus(-1, undefined, 5)).toEqual({ negativeSinceDay: 5, locked: true, forceSale: false });
    expect(negativeBalanceStatus(-1, 5, 6).forceSale).toBe(false);
    expect(negativeBalanceStatus(-1, 5, 7).forceSale).toBe(true);
    expect(negativeBalanceStatus(-1, 27, 1).forceSale).toBe(true);
    expect(negativeBalanceStatus(5, 5, 7)).toEqual({ locked: false, forceSale: false });
  });

  it('연봉 높은 비주전부터 0.5V, 잔액 ≥ 0 이 되면 멈춤', () => {
    const starters = Array.from({ length: 11 }, (_, i) => mk(`st${i}`, 'A', 70));
    const bench = [mk('b1', 'A', 60, 25, { contract: { seasonsLeft: 3, salary: 5 * M } }), mk('b2', 'A', 60, 25, { contract: { seasonsLeft: 3, salary: 4 * M } }), mk('b3', 'A', 60, 25, { contract: { seasonsLeft: 3, salary: 3 * M } })];
    const r = forcedSales({ clubId: 'A', balance: -10 * M, players: [...starters, ...bench] });
    expect(r.sold).toEqual(['b1', 'b2']); // 0.5 × 15M = 7.5M 씩
    expect(r.balance).toBe(5 * M);
    expect(r.money.every((m) => m.kind === 'FORCED_SALE' && m.amount === 7.5 * M)).toBe(true);
  });
});

describe('AI 구단 (7장)', () => {
  it('성향 0.5~1.0 고정, 예산 F 공식', () => {
    const a = aiAggr(SEED, 'T3-01');
    expect(a).toBeGreaterThanOrEqual(0.5);
    expect(a).toBeLessThan(1);
    expect(aiAggr(SEED, 'T3-01')).toBe(a);
    // 정규: TO + aggr × max(0, B − TO − 0.05 cap)
    expect(aiTransferBudget('REGULAR', 0.8, { B: 30 * M, transferOnly: 2 * M, cap: 64 * M })).toBe(2 * M + Math.round((0.8 * (28 * M - 3.2 * M)) / 1000) * 1000);
    // 중간: aggr × 0.5 × max(0, B − 0.05 cap)
    expect(aiTransferBudget('MID', 1, { B: 13.2 * M, transferOnly: 0, cap: 64 * M })).toBe(5 * M);
    expect(aiTransferBudget('MID', 1, { B: 1 * M, transferOnly: 0, cap: 64 * M })).toBe(0);
    expect(aiTransferBudget('REGULAR', 1, { B: 100 * M, transferOnly: 0, cap: 64 * M, relegatedBudget: 39.5 * M })).toBe(9.875 * M);
  });

  it('매각 명단: 약체·대역 상한·23명 초과, GK 2명 유지', () => {
    const ps = [
      ...Array.from({ length: 11 }, (_, i) => mk(`s${i}`, 'A', 61)),
      mk('star', 'A', 70, 24), // ref 60 + 4 이상, 주전 평균 61.8 > ref + 1
      mk('weak', 'A', 44, 25), // < ref − 14
      mk('gk1', 'A', 50, 25, {}, 'GK'),
      mk('gk2', 'A', 49, 25, {}, 'GK'),
      ...Array.from({ length: 11 }, (_, i) => mk(`r${i}`, 'A', 52 + (i % 3))),
    ];
    const ls = aiSellListings({ window: MID, tier: 'T3', players: ps, capLimit: 1000 * M });
    const ids = ls.map((l) => l.playerId);
    expect(ids).toContain('weak');
    expect(ids).toContain('star');
    expect(ids).not.toContain('gk1');
    expect(ids).not.toContain('gk2');
    expect(ps.length - ids.length).toBeLessThanOrEqual(23);
    for (const l of ls) expect(l.minPrice).toBeGreaterThanOrEqual(Math.round((0.7 * l.value) / 1000) * 1000);
  });
});

describe('AI 구단 간 이적 (U4: 대역 상한 판매 → 상위 티어 영입)', () => {
  it('하위 티어 대역 초과 스타를 상위 티어 구단이 이적료로 사 간다', () => {
    const w = MID;
    const t4 = [...Array.from({ length: 11 }, (_, i) => mk(`a${i}`, 'A', 55, 25, {}, i < 2 ? 'GK' : 'CM')), mk('star', 'A', 64, 23, { contract: { seasonsLeft: 3, salary: 2 * M } }, 'ST'), ...Array.from({ length: 10 }, (_, i) => mk(`ar${i}`, 'A', 49))];
    const t3 = [...Array.from({ length: 10 }, (_, i) => mk(`b${i}`, 'B', 60, 25, {}, i < 2 ? 'GK' : i < 9 ? 'CB' : 'CM')), mk('bst', 'B', 58, 26, {}, 'ST'), ...Array.from({ length: 11 }, (_, i) => mk(`br${i}`, 'B', 54, 25, {}, i < 4 ? 'W' : 'DM'))];
    const sell = aiSellListings({ window: w, tier: 'T4', players: t4, capLimit: TIER_ECONOMY.T4.salaryCap });
    const L = sell.find((l) => l.playerId === 'star')!;
    expect(L).toBeDefined();
    const B = club('B', 'T3', { capLimit: TIER_ECONOMY.T3.salaryCap });
    const bids = aiBids({ gameSeed: SEED, window: w, club: B, aggr: 1, F: 30 * M, players: t3, listings: sell, listingPlayers: asMap(t4), placedDay: 11 });
    expect(bids.map((b) => b.listingId)).toContain(L.id);
    const r = settleWindow({ gameSeed: SEED, window: w, listings: sell, bids, clubs: [club('A', 'T4'), B], players: asMap([...t4, ...t3]) });
    const d = r.deals.find((x) => x.playerId === 'star')!;
    expect(d).toMatchObject({ kind: 'CLUB', fromClubId: 'A', toClubId: 'B' });
    expect(d.amount).toBeGreaterThanOrEqual(L.minPrice);
    expect(d.amount).toBeLessThanOrEqual(L.maxPrice);
  });
});

// ── 70구단 1 이적창 간이 시뮬 ──

const TIERS: Tier[] = ['T1', 'T2', 'T3', 'T4', 'T5'];

function buildWorld(seed: number) {
  const rng = mulberry32(seed);
  const players: Record<string, Player> = {};
  const clubs: { id: string; tier: Tier }[] = [];
  for (const tier of TIERS) {
    for (let i = 0; i < 14; i++) {
      const id = `${tier}-${String(i).padStart(2, '0')}`;
      clubs.push({ id, tier });
      for (const p of generateSquad(rng, { clubId: id, targetOvr: TIER_REFERENCE_OVR[tier], size: 22 + (i % 4), tier })) players[p.id] = p;
    }
  }
  for (let i = 0; i < 40; i++) {
    const tier = TIERS[i % 5]!;
    const pos = (['GK', 'CB', 'FB', 'CM', 'AM', 'W', 'ST', 'DM'] as const)[i % 8]!;
    const p = generatePlayer(rng, pos, TIER_REFERENCE_OVR[tier] - 2 + (i % 5), 22 + (i % 12));
    players[`fa${i}`] = { ...p, id: `fa${i}`, clubId: null, faSince: 1, contract: { seasonsLeft: 0, salary: 0 } };
  }
  return { players, clubs };
}

function runWindow(seed: number, shuffle = false) {
  const w = REG;
  const { players, clubs } = buildWorld(seed);
  // Day 20 AI 재계약 흉내(경제 7.5): OVR 순위 ≤ 18·31세 이하 → 3시즌, 나머지 만료자는 Day 28 에 FA (6.2)
  for (const { id } of clubs) {
    const ranked = Object.values(players).filter((p) => p.clubId === id).sort((a, b) => b.ovr - a.ovr);
    ranked.forEach((p, i) => {
      if (p.contract.seasonsLeft > 1) return;
      players[p.id] = i < 18 && p.age <= 31 ? { ...p, contract: { ...p.contract, seasonsLeft: 3 } } : { ...p, clubId: null, faSince: 1 };
    });
  }
  const squadOf = (id: string) => Object.values(players).filter((p) => p.clubId === id);
  const market: MarketClub[] = clubs.map(({ id, tier }) => {
    const econ = TIER_ECONOMY[tier];
    const sq = squadOf(id);
    const salary = sq.reduce((s, p) => s + p.contract.salary, 0);
    const nextSalary = salary;
    const balance = Math.round(econ.seasonBudget * 0.45);
    const B = budgetB({ balance, incoming: econ.seasonBudget, salaryDebt: Math.round((salary * 3) / 28) + nextSalary }); // 만료자 연봉은 위에서 빠졌으니 남은 3일분은 근사
    return { id, tier, balance, transferOnly: startingBalance(econ) >> 3, budget: B, capLimit: econ.salaryCap, signings: 0, signingLimit: 8 };
  });
  const npc = generateNpcListings(seed, w);
  const listings: TransferListing[] = [
    ...npc.listings,
    ...Object.values(players).filter((p) => p.clubId === null).map((p) => faListing(w, p)),
    ...market.flatMap((c) => aiSellListings({ window: w, tier: c.tier, players: squadOf(c.id), capLimit: c.capLimit })),
  ];
  const listingMap = asMap(listings);
  const all = { ...players, ...asMap(npc.players) };
  let bids: Bid[] = [];
  for (const c of market) {
    const aggr = aiAggr(seed, c.id);
    const F = aiTransferBudget('REGULAR', aggr, { B: c.budget, transferOnly: c.transferOnly, cap: c.capLimit });
    const mine = aiBids({ gameSeed: seed, window: w, club: c, aggr, F, players: squadOf(c.id), listings, listingPlayers: all, placedDay: 25 });
    // AI 입찰은 사람과 같은 검증을 통과해야 한다
    let placed: Bid[] = [];
    for (const b of mine) placed = upsertBid(placed, validateBid({ window: w, listing: listingMap[b.listingId]!, input: b, club: c, clubBids: placed, listings: listingMap, placedDay: 25 }));
    bids.push(...placed);
  }
  if (shuffle) bids = [...bids].sort((a, b) => (a.clubId + a.listingId < b.clubId + b.listingId ? 1 : -1));
  const r = settleWindow({ gameSeed: seed, window: w, listings, bids, clubs: market, players: all });
  return { r, market, players, all, listings, bids };
}

describe('70구단 정규 창 간이 시뮬', () => {
  const { r, market, players, all, listings, bids } = runWindow(SEED);

  it('이적 수·채널 분포가 합리적', () => {
    const by = (k: string) => r.deals.filter((d) => d.kind === k).length;
    // 진단 출력 (보고용)
    console.log(`listings=${listings.length} bids=${bids.length} deals=${r.deals.length} NPC=${by('NPC')} FA=${by('FA')} CLUB=${by('CLUB')}`);
    expect(r.deals.length).toBeGreaterThanOrEqual(30);
    expect(r.deals.length).toBeLessThanOrEqual(200);
    expect(by('NPC')).toBeGreaterThan(0);
    expect(by('FA')).toBeGreaterThan(0);
    // 새 게임 직후 세계엔 하위 티어의 ref + 6 이상 선수가 드물어 CLUB 채널은 거의 비어 있다(성장 후 시즌에 열린다) — 별도 시나리오로 검증
    console.log(`CLUB listings=${listings.filter((l) => l.kind === 'CLUB').length} bidsOnClub=${bids.filter((b) => b.listingId.startsWith('CLUB')).length}`);
    expect(new Set(r.deals.map((d) => d.playerId)).size).toBe(r.deals.length);
  });

  it('자금 보존: 총 감소 = NPC 이적료 + 이적세 + FA 계약금', () => {
    const before = market.reduce((s, c) => s + c.balance + c.transferOnly, 0);
    const after = r.clubs.reduce((s, c) => s + c.balance + c.transferOnly, 0);
    const burned = r.deals.reduce((s, d) => s + (d.kind === 'CLUB' ? d.tax : d.amount), 0);
    expect(before - after).toBe(burned);
    expect(r.money.reduce((s, m) => s + m.amount, 0)).toBe(-burned);
    const clubFees = r.deals.filter((d) => d.kind === 'CLUB').reduce((s, d) => s + d.amount, 0);
    console.log(`burned=${(burned / M).toFixed(2)}M clubFees=${(clubFees / M).toFixed(2)}M`);
  });

  it('구단 제약: 25명·캡·예산·영입 한도', () => {
    const after = { ...all, ...r.players };
    for (const c of r.clubs) {
      const sq = Object.values(after).filter((p) => p.clubId === c.id && !p.isTemporary);
      expect(sq.length).toBeLessThanOrEqual(25);
      expect(c.signings).toBeLessThanOrEqual(8);
      const bought = r.deals.filter((d) => d.toClubId === c.id);
      if (bought.length) expect(capUse(sq)).toBeLessThanOrEqual(c.capLimit);
      const m0 = market.find((x) => x.id === c.id)!;
      const spent = m0.balance + m0.transferOnly - (c.balance + c.transferOnly) + r.deals.filter((d) => d.fromClubId === c.id).reduce((s, d) => s + d.amount - d.tax, 0);
      expect(spent).toBeLessThanOrEqual(m0.budget);
    }
  });

  it('C3: 창 뒤 티어 평균 주전 전력 − ref ±3 이내', () => {
    const after = { ...players, ...r.players };
    for (const t of TIERS) {
      const ids = market.filter((c) => c.tier === t).map((c) => c.id);
      const avg = (ps: Record<string, Player>) => ids.reduce((s, id) => s + squadStrength(Object.values(ps).filter((p) => p.clubId === id)), 0) / ids.length;
      const d = avg(after) - avg(players);
      console.log(`${t} str ${avg(players).toFixed(2)} → ${avg(after).toFixed(2)} (ref ${TIER_REFERENCE_OVR[t]})`);
      expect(Math.abs(avg(after) - TIER_REFERENCE_OVR[t])).toBeLessThanOrEqual(3);
      expect(d).toBeGreaterThanOrEqual(-0.5); // 창이 전력을 깎지 않는다
    }
  });

  it('결정성: 같은 입력 같은 결과, 입찰 순서 무관', () => {
    expect(runWindow(SEED).r).toEqual(r);
    expect(runWindow(SEED, true).r).toEqual(r);
    expect(runWindow(SEED + 1).r).not.toEqual(r);
  });
});

