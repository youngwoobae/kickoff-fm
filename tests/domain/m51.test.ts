/** M5.1 (계약 2.3.0): 경고 누적 징계(수명주기 10.1 D1~D4), 훈련 포커스 일일 효과(8.4 T3~T5), 유스 결정(7.6 Y6) */
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/engine';
import type { GameState, LifecycleEvent, Player, PlayerMatchLine } from '../../src/types';
import {
  LIFECYCLE,
  TIER_REFERENCE_OVR,
  advanceDayState,
  applyDailyRecovery,
  applyDiscipline,
  applyMatchLine,
  createInitialState,
  decideYouthState,
  generatePlayer,
  lifecycleDraft,
  offerYouthIntake,
  staminaRecoveryBonus,
  youthDeadline,
  youthSalary,
} from '../../src/domain';

const base = (accum = 0, suspended = 0): Player => {
  const p = generatePlayer(mulberry32(3), 'CM', 60, 26);
  return { ...p, id: 'p1', clubId: 'c01', availability: { injuryDays: 0, suspendedMatches: suspended, yellowAccum: accum } };
};
const line = (extra: Partial<PlayerMatchLine> = {}): PlayerMatchLine => ({
  playerId: 'p1', clubId: 'c01', started: true, minutes: 90, goals: 0, shots: 0, keyPasses: 0, tackles: 0, conditionAfter: 70, injuredDays: 0, redCard: false, ...extra,
});

describe('경고 누적 징계 (10.1)', () => {
  it('D1 누적 4 + 경고 1 → 정지 1, 누적 0, SUSPENDED_ACCUM', () => {
    const r = applyDiscipline(base(4), { redCard: false, yellowCards: 1 });
    expect(r.player.availability).toMatchObject({ suspendedMatches: 1, yellowAccum: 0 });
    expect(r.events).toEqual([{ kind: 'SUSPENDED_ACCUM', playerId: 'p1' }]);
  });
  it('D2 누적 4 + 경고 2(퇴장) → 정지 1(퇴장분만), 누적 4 유지, 표시 경고 2', () => {
    const r = applyDiscipline(base(4), { redCard: true, yellowCards: 2 });
    expect(r.player.availability).toMatchObject({ suspendedMatches: 1, yellowAccum: 4 });
    expect(r.player.season.yellowCards).toBe(2);
    expect(r.events).toEqual([]);
  });
  it('D3 누적 3 + 경고 2(퇴장 없음) → 정지 1, 누적 0', () => {
    expect(applyDiscipline(base(3), { redCard: false, yellowCards: 2 }).player.availability).toMatchObject({ suspendedMatches: 1, yellowAccum: 0 });
  });
  it('가산식: 남은 정지 1 + 퇴장 → 2. 누적 3 + 1 → 4 이면 YELLOW_WARNING', () => {
    expect(applyDiscipline(base(0, 1), { redCard: true, yellowCards: 0 }).player.availability.suspendedMatches).toBe(2);
    expect(applyDiscipline(base(3), { redCard: false, yellowCards: 1 }).events).toEqual([{ kind: 'YELLOW_WARNING', playerId: 'p1' }]);
  });
  it('applyMatchLine 이 징계를 적용하고 사건을 sink 로 넘긴다. 결장 경기에서 정지 소화', () => {
    const ev: LifecycleEvent[] = [];
    let p = applyMatchLine(base(4), line({ yellowCards: 1 }), true, ev);
    expect(p.availability.suspendedMatches).toBe(1);
    expect(p.season.apps).toBe(1);
    expect(ev.map((e) => e.kind)).toEqual(['SUSPENDED_ACCUM']);
    p = applyMatchLine(p, undefined, true);
    expect(p.availability.suspendedMatches).toBe(0);
  });
  it('편지: 경고 4장 DISCIPLINE_WARNING, 누적 정지 SUSPENDED', () => {
    const ctx = { userClubId: 'c01', nameOf: () => '김선수' };
    expect(lifecycleDraft({ kind: 'YELLOW_WARNING', playerId: 'p1' }, ctx)?.kind).toBe('DISCIPLINE_WARNING');
    expect(lifecycleDraft({ kind: 'SUSPENDED_ACCUM', playerId: 'p1' }, ctx)?.kind).toBe('SUSPENDED');
  });
});

/** 하루씩 진행 */
function advance(s: GameState, n: number): GameState {
  for (let i = 0; i < n; i++) s = advanceDayState(s, 'now').state;
  return s;
}
function withUserClub(s: GameState, patch: Partial<GameState['clubs'][string]>): GameState {
  const c = s.clubs[s.userClubId]!;
  return { ...s, clubs: { ...s.clubs, [c.id]: { ...c, ...patch } } };
}

describe('훈련 포커스 (8.4)', () => {
  it('T3 회복 포커스: 일일 회복 = 기본 + 4 (상한 100)', () => {
    const p = { ...base(), condition: 50 };
    const plain = applyDailyRecovery(p).condition;
    expect(applyDailyRecovery(p, LIFECYCLE.focus.RECOVERY.recoveryBonus).condition).toBe(plain + 4);
    expect(plain).toBe(50 + 14 + staminaRecoveryBonus(p.attrs.stamina));
    expect(applyDailyRecovery({ ...p, condition: 99 }, 4).condition).toBe(100);
  });

  it('T4 전술 숙련 주: 미사용 슬롯 숙련 50 → 7일 뒤 71', () => {
    let s = createInitialState(7, { clubName: 'T', tier: 'T5', devMode: false }, 'now');
    const c = s.clubs[s.userClubId]!;
    s = withUserClub(s, { training: { focus: 'TACTICAL' }, tactics: { ...c.tactics, B: { ...c.tactics.B, familiarity: 50 } } });
    s = advance(s, 7);
    expect(s.clubs[s.userClubId]!.tactics.B.familiarity).toBe(71);
  });

  it('T5 주 중간 예약: Day 8 성장 틱은 이전 포커스, 그 뒤 새 포커스로 바뀜. 회복 포커스는 Day 8 회복부터', () => {
    const s0 = advance(createInitialState(11, { clubName: 'T', tier: 'T5', devMode: false }, 'now'), 6); // Day 7
    expect(s0.time.day).toBe(7);
    const a = advance(withUserClub(s0, { training: { focus: 'ATTACK' } }), 1);
    const b = advance(withUserClub(s0, { training: { focus: 'ATTACK', next: 'RECOVERY' } }), 1);
    expect(b.time.day).toBe(8);
    expect(b.clubs[b.userClubId]!.training).toEqual({ focus: 'RECOVERY' });
    const ids = b.clubs[b.userClubId]!.playerIds;
    for (const id of ids) expect(b.players[id]!.attrs).toEqual(a.players[id]!.attrs);
    // 회복 +4 는 이미 적용 (Day 7 경기 뒤 컨디션이 100 미만인 선수)
    expect(ids.some((id) => b.players[id]!.condition === Math.min(100, a.players[id]!.condition + 4) && a.players[id]!.condition < 96)).toBe(true);
  });
});

describe('유스 (7장)', () => {
  const fresh = () => {
    const s = structuredClone(createInitialState(5, { clubName: 'T', tier: 'T5', devMode: false }, 'now'));
    offerYouthIntake(s);
    return s;
  };

  it('Day 1 후보: youthIntake·편지 YOUTH_INTAKE, tierRange 는 티어 기준 상대 척도', () => {
    const s = fresh();
    const yi = s.youthIntake!;
    expect(yi.candidates.length).toBeGreaterThanOrEqual(3);
    expect(yi.candidates.length).toBeLessThanOrEqual(5);
    expect(yi.tier).toBe('T5');
    for (const c of yi.candidates) {
      expect(s.players[c.id]).toBeUndefined();
      expect(c.tierRange).toBeDefined();
    }
    expect(s.inbox!.at(-1)!.kind).toBe('YOUTH_INTAKE');
  });

  it('decideYouth: 승격(유스 연봉·3시즌), 결과 표시용 decided, 다시 결정 불가, 3명·없는 ID 거부', () => {
    const s = fresh();
    const [c1, c2, c3] = s.youthIntake!.candidates;
    expect(() => decideYouthState(structuredClone(s), [c1!.id, c2!.id, c3!.id], false)).toThrow(/2명/);
    expect(() => decideYouthState(structuredClone(s), ['nope'], false)).toThrow(/후보가 아니에요/);
    const before = s.clubs[s.userClubId]!.playerIds.length;
    decideYouthState(s, [c1!.id], false);
    const p = s.players[c1!.id]!;
    expect(p.clubId).toBe(s.userClubId);
    expect(p.contract).toMatchObject({ salary: youthSalary(p.ovr), seasonsLeft: 3 });
    expect('tierRange' in p).toBe(false);
    expect(s.clubs[s.userClubId]!.playerIds).toHaveLength(before + 1);
    expect(s.youthIntake).toMatchObject({ decided: true, promotedIds: [c1!.id] });
    expect(() => decideYouthState(s, [], false)).toThrow(/이미 결정/);
    // 수동 결정은 편지 없음
    expect(s.inbox!.some((m) => m.kind === 'YOUTH_AUTO_DECIDED')).toBe(false);
    s.time = { ...s.time, day: 8 };
    youthDeadline(s);
    expect(s.youthIntake).toBeUndefined();
  });

  it('Y6 미결정 Day 8: 유망주 조건 충족 후보만 최대 1명 자동 승격, 편지 YOUTH_AUTO_DECIDED, youthIntake 삭제', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = structuredClone(createInitialState(seed, { clubName: 'T', tier: 'T5', devMode: false }, 'now'));
      offerYouthIntake(s);
      const cands = s.youthIntake!.candidates;
      const prospects = cands.filter((c) => c.potential >= TIER_REFERENCE_OVR.T5 + LIFECYCLE.youth.prospectOver);
      const n = s.clubs[s.userClubId]!.playerIds.length;
      s.time = { ...s.time, day: 7 };
      youthDeadline(s); // 아직 마감 전
      expect(s.youthIntake).toBeDefined();
      s.time = { ...s.time, day: 8 };
      youthDeadline(s);
      expect(s.youthIntake).toBeUndefined();
      const added = s.clubs[s.userClubId]!.playerIds.length - n;
      expect(added).toBe(prospects.length ? 1 : 0);
      expect(s.inbox!.at(-1)!.kind).toBe('YOUTH_AUTO_DECIDED');
    }
  });

  it('advanceDay Day 7 → 8 처리에서 자동 결정이 일어난다', () => {
    let s = fresh();
    s = advance(s, 7);
    expect(s.time.day).toBe(8);
    expect(s.youthIntake).toBeUndefined();
    expect(s.inbox!.some((m) => m.kind === 'YOUTH_AUTO_DECIDED')).toBe(true);
  });
});
