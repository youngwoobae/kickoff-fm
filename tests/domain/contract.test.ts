/** M4.2 계약 도메인 (경제 설계 5장 예시 수치) */
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/engine';
import { generatePlayer } from '../../src/domain';
import { DomainError } from '../../src/domain/errors';
import { baseSalary } from '../../src/domain/economy/economy';
import {
  aiRenewals,
  capCharge,
  capLimit,
  contractBoundary,
  emergencyFaAllowed,
  emergencyFaSign,
  offerRenewal,
  releasePlayer,
  releaseQuote,
  remainingSalary,
  renewalAsk,
  renewalBonus,
  salaryFloor,
  seasonsRange,
} from '../../src/domain/contract/contract';
import type { Player } from '../../src/types';

const M = 1_000_000;
const mk = (o: Partial<Player> & { ovr: number }, id = 'p1'): Player => {
  const base = generatePlayer(mulberry32(1), 'CM', o.ovr, o.age ?? 25);
  return { ...base, id, clubId: 'c1', isTemporary: false, ...o, contract: { seasonsLeft: 1, salary: 3 * M, ...o.contract } };
};
const starts = (n: number) => ({ apps: n, starts: n, minutes: 0, goals: 0, shots: 0, keyPasses: 0, tackles: 0, redCards: 0 });

describe('5.1 공식', () => {
  it('캡 산입액 = max(연봉, 0.8S) + 시즌당 보너스', () => {
    expect(capCharge(mk({ ovr: 60, contract: { seasonsLeft: 2, salary: 1 * M } }))).toBe(2.4 * M);
    expect(capCharge(mk({ ovr: 60, contract: { seasonsLeft: 2, salary: 5 * M, bonusPerSeason: 0.5 * M } }))).toBe(5.5 * M);
  });
  it('캡 한도: 강등 시즌 110%', () => {
    expect(capLimit('T3')).toBe(64 * M);
    expect(capLimit('T3', true)).toBe(70.4 * M);
  });
  it('연봉 하한 = max(0.2M, 0.9S)', () => {
    expect(salaryFloor(60)).toBe(2.7 * M);
    expect(salaryFloor(1)).toBe(200_000);
  });
  it('허용 기간 경계: 23/24/29/30/32/33', () => {
    expect([23, 24, 29, 30, 32, 33].map(seasonsRange)).toEqual([[1, 3], [1, 4], [1, 4], [1, 2], [1, 2], [1, 1]]);
  });
});

describe('5.2 재계약 (스크립트 E)', () => {
  const ask = (o: Partial<Player> & { ovr: number }, tier: 'T2' | 'T3' | 'T5', starter: boolean) =>
    renewalAsk(mk({ ...o, season: starts(starter ? 13 : 12) }), { tier, clubMatches: 26 });
  it('표 4행', () => {
    expect(ask({ ovr: 61, age: 26 }, 'T3', true)).toBe(3_550_000); // 3.23 × 1.10
    expect(ask({ ovr: 55, age: 24 }, 'T3', false)).toBe(baseSalary(55)); // 2.08
    expect(ask({ ovr: 55, age: 23 }, 'T5', true)).toBe(2_603_000); // 2.08 × 1.25 = 2.60 (상위 티어급)
    expect(ask({ ovr: 64, age: 33 }, 'T2', true)).toBe(3_616_000); // 4.02 × 0.90 = 3.62
  });
  it('clamp 0.9~1.3', () => {
    expect(ask({ ovr: 60, age: 34 }, 'T3', false)).toBe(2.7 * M); // 0.8 → 0.9
    expect(ask({ ovr: 60, age: 25 }, 'T5', true)).toBe(3.75 * M); // 1.25
    expect(ask({ ovr: 61, age: 31 }, 'T3', false)).toBe(Math.round((baseSalary(61) * 0.9) / 1000) * 1000);
  });
  it('갱신 보너스·시즌당 캡 산입 (T3 주전 3.55 × 3 → 1.07, 3.91)', () => {
    expect(renewalBonus(3_550_000, 3)).toBe(1_065_000);
    const p = mk({ ovr: 61, age: 26, season: starts(20) });
    const d = offerRenewal(p, { salary: 3_550_000, seasons: 3 }, { tier: 'T3', clubMatches: 26, season: 2, day: 20, usageWithoutPlayer: 0, capLimit: 64 * M });
    expect(d.accepted).toBe(true);
    expect(d.pending).toEqual({ playerId: 'p1', salary: 3_550_000, seasons: 3, bonusPerSeason: 355_000 });
    expect(d.ledger).toMatchObject({ kind: 'RENEWAL_BONUS', amount: -1_065_000 });
    expect(capCharge({ ovr: 61, contract: { seasonsLeft: 3, salary: 3_550_000, bonusPerSeason: 355_000 } })).toBe(3_905_000);
  });
  it('거절: 연봉 부족·기간 밖. 창 밖·캡 초과는 오류', () => {
    const p = mk({ ovr: 61, age: 31, season: starts(0) });
    const ctx = { tier: 'T3' as const, clubMatches: 26, season: 2, day: 27, usageWithoutPlayer: 0, capLimit: 64 * M };
    const a = renewalAsk(p, ctx);
    expect(offerRenewal(p, { salary: a - 1000, seasons: 1 }, ctx).accepted).toBe(false);
    expect(offerRenewal(p, { salary: a, seasons: 3 }, ctx).accepted).toBe(false);
    expect(offerRenewal(p, { salary: a, seasons: 2 }, ctx).accepted).toBe(true);
    const code = (f: () => unknown) => { try { f(); return null; } catch (e) { return (e as DomainError).code; } };
    expect(code(() => offerRenewal(p, { salary: a, seasons: 1 }, { ...ctx, day: 19 }))).toBe('RENEWAL_NOT_OPEN');
    expect(code(() => offerRenewal(p, { salary: a, seasons: 1 }, { ...ctx, day: 28 }))).toBe('RENEWAL_NOT_OPEN');
    expect(code(() => offerRenewal(mk({ ovr: 61, contract: { seasonsLeft: 2, salary: M } }), { salary: a, seasons: 1 }, ctx))).toBe('RENEWAL_NOT_OPEN');
    expect(code(() => offerRenewal(p, { salary: a, seasons: 1 }, { ...ctx, usageWithoutPlayer: 63 * M }))).toBe('CAP_EXCEEDED');
  });
});

describe('5.3 방출 (스크립트 E)', () => {
  it('잔여 연봉·위약금 표 3행', () => {
    const rows: [number, number, number, number, number][] = [
      [3 * M, 10, 2, 5_036_000, 2_518_000],
      [3 * M, 26, 1, 321_000, 161_000],
      [7.2 * M, 1, 3, 21_600_000, 10_800_000],
    ];
    for (const [salary, day, left, rem, pen] of rows) {
      expect(Math.round(remainingSalary({ salary, seasonsLeft: left }, day) / 1000) * 1000).toBe(rem);
      expect(releaseQuote(mk({ ovr: 60, contract: { salary, seasonsLeft: left } }), { day, freeReleasesLeft: 0 }).penalty).toBe(pen);
    }
  });
  it('면제: 임시 > 방출권 순, 방출권 소모, FA 풀로', () => {
    const tmp = releasePlayer(mk({ ovr: 60, isTemporary: true }), { season: 3, day: 5, freeReleasesLeft: 2 });
    expect([tmp.penalty, tmp.freeReleasesLeft, tmp.ledger]).toEqual([0, 2, undefined]);
    const free = releasePlayer(mk({ ovr: 60 }), { season: 3, day: 5, freeReleasesLeft: 1 });
    expect([free.penalty, free.freeReleasesLeft]).toEqual([0, 0]);
    expect(free.player).toMatchObject({ clubId: null, faSince: 3 });
    const paid = releasePlayer(mk({ ovr: 60 }), { season: 3, day: 5, freeReleasesLeft: 0 });
    expect(paid.ledger).toMatchObject({ kind: 'RELEASE_PENALTY', amount: -paid.penalty });
    expect(paid.event).toMatchObject({ kind: 'PLAYER_RELEASED', clubId: 'c1', exempt: false });
  });
  it('유스 후보는 무위약·풀에 안 넣음', () => {
    const y = releasePlayer(mk({ ovr: 30, clubId: null, academyClubId: 'c1' }), { season: 1, day: 3, freeReleasesLeft: 0 });
    expect([y.player, y.penalty, y.event.clubId]).toEqual([null, 0, 'c1']);
  });
});

describe('5.4 긴급 FA', () => {
  it('조건·계약', () => {
    expect(emergencyFaAllowed({ windowOpen: false, registered: 17, available: 17, signedThisSeason: 1 })).toBe(true);
    expect(emergencyFaAllowed({ windowOpen: false, registered: 18, available: 16, signedThisSeason: 0 })).toBe(false);
    expect(emergencyFaAllowed({ windowOpen: false, registered: 20, available: 15, signedThisSeason: 2 })).toBe(false);
    expect(emergencyFaAllowed({ windowOpen: true, registered: 10, available: 10, signedThisSeason: 0 })).toBe(false);
    const p = emergencyFaSign(mk({ ovr: 60, clubId: null }), 'c9', 'T3');
    expect(p).toMatchObject({ clubId: 'c9', contract: { seasonsLeft: 1, salary: 3 * M, bonusPerSeason: 0 } });
  });
});

describe('시즌 경계·AI 재계약', () => {
  it('계약 −1, 재계약 성립분 적용, 미처리 → FA', () => {
    const a = mk({ ovr: 60, contract: { seasonsLeft: 3, salary: 3 * M } }, 'a');
    const b = mk({ ovr: 60, contract: { seasonsLeft: 1, salary: 3 * M } }, 'b');
    const c = mk({ ovr: 60, contract: { seasonsLeft: 1, salary: 3 * M } }, 'c');
    const fa = mk({ ovr: 60, clubId: null }, 'f');
    const r = contractBoundary([a, b, c, fa], [{ playerId: 'b', salary: 4 * M, seasons: 2, bonusPerSeason: 0.4 * M }], 4);
    expect(r.players[0]!.contract).toEqual({ seasonsLeft: 2, salary: 3 * M, capCharge: 3 * M });
    expect(r.players[1]!.contract).toEqual({ seasonsLeft: 2, salary: 4 * M, bonusPerSeason: 0.4 * M, capCharge: 4.4 * M });
    expect(r.players[2]).toMatchObject({ clubId: null, faSince: 4 });
    expect(r.players[3]).toBe(fa);
    expect(r.events).toEqual([{ kind: 'CONTRACT_EXPIRED', playerId: 'c', clubId: 'c1' }]);
  });
  it('7.5: 순위·나이 규칙, 캡 97% 초과 시 낮은 OVR 부터 제외', () => {
    const squad = Array.from({ length: 20 }, (_, i) =>
      mk({ ovr: 70 - i, age: i === 0 ? 33 : i === 1 ? 32 : 25, contract: { seasonsLeft: i % 2 === 0 || i >= 17 ? 1 : 2, salary: 2 * M } }, `p${String(i).padStart(2, '0')}`),
    );
    const picks = aiRenewals(squad, { tier: 'T3', clubMatches: 0, capLimit: 1000 * M });
    // 0(33세, 1위)·순위≤18 짝수·17(18위) 포함, 19(20위) 제외, 1은 2시즌 남음
    expect(picks.map((p) => p.playerId)).toEqual(['p00', 'p02', 'p04', 'p06', 'p08', 'p10', 'p12', 'p14', 'p16', 'p17']);
    expect(picks[0]!.seasons).toBe(1);
    expect(picks[1]!.seasons).toBe(3);
    const tight = aiRenewals(squad, { tier: 'T3', clubMatches: 0, capLimit: 60 * M });
    expect(tight.length).toBeLessThan(picks.length);
    expect(tight.map((p) => p.playerId)).toEqual(picks.slice(0, tight.length).map((p) => p.playerId));
  });
});
