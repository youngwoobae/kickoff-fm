/** 코드 리뷰 M4·M5 (docs/코드리뷰_M4M5.md) Critical·Major 회귀 테스트. 모두 수정 전 코드에서 실패한다 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createGameService, createMemoryStorage, isGameError, type GameService } from '../../src/services';
import { TIER_REFERENCE_OVR, benchIdsOf, clubPlayers, clubTierMap, playerValue, trainingFocusOf } from '../../src/domain';
import type { GameErrorCode, GameState, Player } from '../../src/types';

const clock = { nowIso: () => '2026-10-05T00:00:00.000Z' };
type Svc = Required<GameService>;
const fresh = () => createGameService({ storage: createMemoryStorage(), clock }) as Svc;
const mk = (seed = 7): Svc => {
  const s = fresh();
  s.newGame({ seed });
  return s;
};
const snap = (s: Svc) => s.getSnapshot()! as GameState;
const load = (x: unknown): Svc => {
  const t = fresh();
  t.importSave(JSON.stringify(x));
  return t;
};

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

const registered = (x: GameState, clubId: string) => clubPlayers(x, clubId).filter((p) => !p.isTemporary);
const clone = (x: GameState) => structuredClone(x) as GameState;

describe('C1·M5: 잔액 음수 — 강제 매각 하한·긴급 FA 순환 차단', () => {
  let s2: GameState; // 시즌 2 Day 3 (FA 풀이 있음)
  beforeAll(() => {
    const s = mk();
    goTo(s, 2, 3);
    s2 = clone(snap(s));
  }, 120_000);

  it('사용자 −60M·AI −500M 으로 28일: 등록 ≥ 18 유지, 매각 수입 ≤ 시작 시점 비주전 0.5V 합, 긴급 FA 는 팔리지 않음', () => {
    const x = clone(s2);
    const user = x.userClubId;
    const ai = Object.keys(x.clubs).sort().find((id) => !x.clubs[id]!.isHuman && id !== user)!;
    x.finances[user] = { ...x.finances[user]!, balance: -60_000_000 };
    x.finances[ai] = { ...x.finances[ai]!, balance: -500_000_000 };
    const own = registered(x, user);
    const top11 = new Set([...own].sort((a, b) => b.ovr - a.ovr).slice(0, 11).map((p) => p.id));
    const benchHalfV = own.filter((p) => !top11.has(p.id)).reduce((a, p) => a + 0.5 * playerValue(p), 0);
    const aiFloor = Math.min(18, registered(x, ai).length); // AI 는 경계 전까지 보충이 없어 18 미만에서 시작할 수 있다

    const t = load(x);
    let income = 0;
    const soldIds = new Set<string>();
    for (let d = 0; d < 28 && snap(t).phase !== 'SEASON_OVER'; d++) {
      const before = new Set(snap(t).clubs[user]!.playerIds);
      const aiBefore = snap(t).clubs[ai]!.playerIds;
      const r = t.advanceDay();
      for (const e of r.ledger) if (e.kind === 'FORCED_SALE') income += e.amount;
      const now = snap(t);
      for (const id of before) if (!now.players[id]) soldIds.add(id);
      expect(registered(now, user).length).toBeGreaterThanOrEqual(18);
      // AI 는 이적 창 판매로도 줄 수 있다 — 강제 매각(세계에서 삭제)이 있던 날만 하한을 본다
      if (aiBefore.some((id) => !now.players[id])) expect(registered(now, ai).length).toBeGreaterThanOrEqual(aiFloor);
    }
    expect(income).toBeGreaterThan(0);
    expect(income).toBeLessThanOrEqual(benchHalfV * 1.1); // OVR 성장 여유
    const emergency = new Set(snap(t).emergencySignedThisSeason?.[user] ?? []);
    expect([...soldIds].some((id) => emergency.has(id))).toBe(false);
    // 긴급 FA 는 시즌 중 상한(2명)을 넘지 않는다
    expect(emergency.size - (x.emergencySignedThisSeason?.[user]?.length ?? 0)).toBeLessThanOrEqual(2);
  }, 120_000);

  it('M5: 최근 5경기 기록이 있으면 benchIds(선발 ≤ 2)를 계산하고 강제 매각은 그 선수만 판다', () => {
    const s = mk(11);
    goTo(s, 1, 14);
    const x = clone(snap(s));
    const bench = benchIdsOf(x, x.userClubId);
    expect(bench).toBeDefined();
    x.finances[x.userClubId] = { ...x.finances[x.userClubId]!, balance: -30_000_000, negativeSinceDay: 12 };
    const t = load(x);
    const before = new Set(snap(t).clubs[x.userClubId]!.playerIds);
    t.advanceDay();
    const gone = [...before].filter((id) => !snap(t).players[id]);
    expect(gone.length).toBeGreaterThan(0);
    // 그날 경기 기록이 하나 더 생겨도 판 선수는 전날 기준 비주전이어야 한다
    expect(gone.every((id) => bench!.has(id))).toBe(true);
  }, 120_000);
});

describe('M3: 가져오기 검증 — 깨진 2.2.1~2.4.x 필드는 거부', () => {
  let base: GameState;
  beforeAll(() => {
    const s = mk();
    goTo(s, 1, 12); // 중간 창 열림
    base = clone(snap(s));
  }, 60_000);
  const rejects = (mut: (x: GameState & Record<string, unknown>) => void) => {
    const x = clone(base) as GameState & Record<string, unknown>;
    mut(x);
    return codeOf(() => load(x));
  };

  it('정상 세이브는 열린다', () => {
    expect(rejects(() => {})).toBeNull();
  });
  it('youthIntake 후보 없음', () => {
    expect(rejects((x) => (x.youthIntake = { season: 1, clubId: x.userClubId, deadlineDay: 7 } as never))).toBe('SAVE_INCOMPATIBLE');
  });
  it('training.focus 모르는 값 / 프로토타입 키', () => {
    expect(rejects((x) => (x.clubs[x.userClubId] = { ...x.clubs[x.userClubId]!, training: { focus: 'NOPE' as never } }))).toBe('SAVE_INCOMPATIBLE');
    expect(rejects((x) => (x.clubs[x.userClubId] = { ...x.clubs[x.userClubId]!, training: { focus: 'BALANCED', next: 'constructor' as never } }))).toBe('SAVE_INCOMPATIBLE');
  });
  it('transferMarket.window 빈 객체 / 입찰 금액 음수', () => {
    expect(rejects((x) => (x.transferMarket = { ...x.transferMarket!, window: {} as never }))).toBe('SAVE_INCOMPATIBLE');
    expect(
      rejects((x) => {
        const l = x.transferMarket!.listings[0]!;
        x.transferMarket = { ...x.transferMarket!, bids: [{ listingId: l.id, clubId: x.userClubId, placedDay: 12, fee: -5 }] };
      }),
    ).toBe('SAVE_INCOMPATIBLE');
  });
  it('pendingRenewals 연봉 음수 / freeReleasesLeft 999 / inbox 형식', () => {
    const pid = x0().clubs[x0().userClubId]!.playerIds[0]!;
    expect(rejects((x) => (x.pendingRenewals = [{ playerId: pid, salary: -50_000_000, seasons: 2, bonusPerSeason: 0 }]))).toBe('SAVE_INCOMPATIBLE');
    expect(rejects((x) => (x.freeReleasesLeft = 999))).toBe('SAVE_INCOMPATIBLE');
    expect(rejects((x) => (x.inbox = [{ id: 1 }] as never))).toBe('SAVE_INCOMPATIBLE');
    expect(rejects((x) => (x.releasedThisSeason = { [x.userClubId]: 'p1' } as never))).toBe('SAVE_INCOMPATIBLE');
  });
  it('FA 풀 선수·yellowAccum 범위', () => {
    expect(
      rejects((x) => {
        const p = Object.values(x.players)[0]!;
        x.players[p.id] = { ...p, availability: { ...p.availability, yellowAccum: 9 } };
      }),
    ).toBe('SAVE_INCOMPATIBLE');
  });
  const x0 = () => base;
});

describe('M4: setTrainingFocus 는 허용 목록만', () => {
  it('constructor·toString·__proto__ 는 INVALID_TACTIC, 이미 오염된 값은 BALANCED 로 읽힌다', () => {
    const s = mk();
    for (const f of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(codeOf(() => s.setTrainingFocus(f as never))).toBe('INVALID_TACTIC');
    expect(codeOf(() => s.setTrainingFocus('ATTACK'))).toBeNull();
    expect(trainingFocusOf({ training: { focus: 'constructor' as never } })).toBe('BALANCED');
  });
});

describe('M1: 성립한 재계약 재제안 금지 (보너스 이중 지급)', () => {
  it('두 번째 제안은 RENEWAL_NOT_OPEN(ALREADY_RENEWED), RENEWAL_BONUS 는 한 번', () => {
    const s = mk();
    goTo(s, 1, 20);
    const p = s.getSquad().find((x) => x.contract.seasonsLeft === 1 && !x.isTemporary && !x.retiring)!;
    const q = s.getRenewalQuote(p.id);
    expect(s.offerRenewal(p.id, q.askSalary, 1).accepted).toBe(true);
    let detail: readonly string[] = [];
    try {
      s.offerRenewal(p.id, q.askSalary, 1);
    } catch (e) {
      if (!isGameError(e)) throw e;
      expect(e.code).toBe('RENEWAL_NOT_OPEN');
      detail = e.details;
    }
    expect(detail).toContain('ALREADY_RENEWED');
    const bonuses = snap(s).finances[snap(s).userClubId]!.ledger.filter((e) => e.kind === 'RENEWAL_BONUS');
    expect(bonuses).toHaveLength(1);
  }, 60_000);
});

describe('M2: pendingRenewals 없는 이전 세이브', () => {
  it('불러온 뒤 사용자가 한 명을 재계약해도 AI 구단 재계약은 그대로 남는다', () => {
    const s = mk(11);
    goTo(s, 1, 21);
    const run = (renewOne: boolean) => {
      const old = clone(snap(s)) as Partial<GameState>;
      delete old.pendingRenewals;
      const t = load(old);
      if (renewOne) {
        const p = t.getSquad().find((x) => x.contract.seasonsLeft === 1 && !x.isTemporary && !x.retiring);
        // 이전 세이브 불러오기에서 사람 구단 몫도 AI 규칙으로 채워졌으면 재제안이 막힌다 — 남은 만료 예정자 중 아무나
        const free = t.getSquad().find((x) => x.contract.seasonsLeft === 1 && !x.isTemporary && !x.retiring && !(snap(t).pendingRenewals ?? []).some((r) => r.playerId === x.id)) ?? p;
        if (free && !(snap(t).pendingRenewals ?? []).some((r) => r.playerId === free.id)) t.offerRenewal(free.id, t.getRenewalQuote(free.id).askSalary, 1);
      }
      const x = snap(t);
      const aiExpiring = Object.values(x.players).filter((p): p is Player => p.clubId !== null && !x.clubs[p.clubId]!.isHuman && p.contract.seasonsLeft === 1 && !p.retiring).map((p) => p.id);
      t.advanceToSeasonEnd();
      t.startNewSeason();
      const y = snap(t);
      return aiExpiring.filter((id) => y.players[id]?.clubId === x.players[id]!.clubId).length;
    };
    const keptNoRenew = run(false);
    const keptRenew = run(true);
    expect(keptNoRenew).toBeGreaterThan(100);
    expect(keptRenew).toBe(keptNoRenew);
  }, 120_000);
});

describe('M6: 방출 이력은 상태로 — 편지함과 무관하게 긴급 FA·FA 입찰 모두 차단', () => {
  it('방출 선수의 FA 매물에 입찰할 수 없고, 편지함을 지워도 긴급 FA 로 돌아오지 않는다', () => {
    const s = mk();
    goTo(s, 1, 3);
    const victim = [...s.getSquad()].filter((p) => !p.isTemporary).sort((a, b) => b.ovr - a.ovr)[0]!;
    s.releasePlayer(victim.id);
    goTo(s, 1, 11); // 중간 창: 방출 선수는 FA 매물
    const l = s.listTransferListings({ kind: 'FA' }).find((x) => x.playerId === victim.id)!;
    expect(l).toBeDefined();
    expect(codeOf(() => s.placeBid({ listingId: l.id, bonus: 0, salary: l.salaryFloor!, seasons: l.seasonsRange![0] }))).toBe('BID_OUT_OF_RANGE');
    goTo(s, 1, 16); // 창 밖
    // 편지함을 비운 세이브 + 선수단을 17명으로: 긴급 FA 는 방출 선수를 고르지 않는다(그가 풀에서 가장 강해도)
    const x = clone(snap(s));
    delete x.inbox;
    const user = x.userClubId;
    const keep = [...registered(x, user)].sort((a, b) => Number(b.primary === 'GK') - Number(a.primary === 'GK')).slice(0, 17).map((p) => p.id);
    for (const id of x.clubs[user]!.playerIds) if (!keep.includes(id)) delete x.players[id];
    x.clubs[user] = { ...x.clubs[user]!, playerIds: keep };
    const v = x.players[victim.id];
    const ref = TIER_REFERENCE_OVR[clubTierMap(x).get(user)!];
    x.players[victim.id] = { ...v!, ovr: ref + 6 }; // 풀 조건(티어 기준 +6)의 맨 위 = 수정 전이면 가장 먼저 뽑힌다
    const t = load(x);
    t.releasePlayer(keep[16]!); // 17 → 16 → 긴급 FA
    const after = snap(t);
    expect(after.clubs[user]!.playerIds).not.toContain(victim.id);
    expect(registered(after, user).length).toBeGreaterThanOrEqual(16);
  }, 120_000);
});

describe('m5: 돈이 걸린 이적·계약 행동은 행동 로그에 남는다', () => {
  it('입찰·입찰 취소·방출 → BID_PLACED·BID_WITHDRAWN·PLAYER_RELEASED', () => {
    const s = mk();
    goTo(s, 1, 11);
    const l = s.listTransferListings({ kind: 'NPC' }).sort((a, b) => a.minPrice - b.minPrice)[0]!;
    s.placeBid({ listingId: l.id, fee: l.minPrice });
    s.withdrawBid(l.id);
    const p = s.getSquad().find((x) => !x.isTemporary)!;
    s.releasePlayer(p.id);
    const kinds = snap(s).actionLog.map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['BID_PLACED', 'BID_WITHDRAWN', 'PLAYER_RELEASED']));
    expect(snap(s).actionLog.find((e) => e.kind === 'PLAYER_RELEASED')!.data).toMatchObject({ playerId: p.id });
  }, 60_000);
});
