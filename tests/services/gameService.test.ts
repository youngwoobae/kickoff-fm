/** 서비스 통합 테스트: 공개 API(services/index)만 사용 */
import { describe, expect, it } from 'vitest';
import { createGameService, createMemoryStorage, isGameError, type GameService } from '../../src/services';
import type { MatchPlan } from '../../src/types';

const clock = { nowIso: () => '2026-09-27T00:00:00.000Z' };

function svc(storage = createMemoryStorage()): GameService {
  return createGameService({ storage, clock });
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return isGameError(e) ? e.code : `non-game:${String(e)}`;
  }
  return 'no-error';
}

describe('GameService', () => {
  it('게임이 없으면 NO_GAME, 새 게임 → 저장소에 영속화 → loadGame 복원', () => {
    const storage = createMemoryStorage();
    const s = svc(storage);
    expect(s.getSnapshot()).toBeNull();
    expect(code(() => s.getStandings())).toBe('NO_GAME');
    const snap = s.newGame({ seed: 7, clubName: '테스트 FC' });
    expect(snap.clubs[snap.userClubId]!.name).toBe('테스트 FC');
    expect(s.getSnapshot()).toBe(s.getSnapshot()); // 같은 상태 = 같은 참조
    const s2 = svc(storage);
    expect(s2.loadGame()?.gameSeed).toBe(7);
    expect(s2.getStandings()).toHaveLength(14);
  });

  it('subscribe 는 변경 시 호출되고, logEvent 는 스냅샷을 바꾸지 않는다', () => {
    const s = svc();
    s.newGame({ seed: 1 });
    let calls = 0;
    const off = s.subscribe(() => (calls += 1));
    const before = s.getSnapshot();
    s.logEvent('SESSION_START');
    expect(calls).toBe(0);
    expect(s.getSnapshot()).toBe(before);
    expect(JSON.parse(s.exportActionLog()).some((e: { kind: string }) => e.kind === 'SESSION_START')).toBe(true);
    s.advanceDay();
    expect(calls).toBe(1);
    off();
    s.advanceDay();
    expect(calls).toBe(1);
  });

  it('같은 시드로 두 번 시즌을 돌리면 같은 순위표 (결정성), 저장 크기 < 2MB', () => {
    const a = svc();
    const b = svc();
    a.newGame({ seed: 99 });
    b.newGame({ seed: 99 });
    const ra = a.advanceToSeasonEnd();
    b.advanceToSeasonEnd();
    expect(ra).toHaveLength(28);
    expect(a.getSnapshot()!.phase).toBe('SEASON_OVER');
    expect(JSON.stringify(a.getStandings())).toBe(JSON.stringify(b.getStandings()));
    expect(a.exportSave().length).toBeLessThan(2 * 1024 * 1024);
    expect(a.getSeasonOutcome()?.season).toBe(1);
    expect(code(() => a.advanceDay())).toBe('INVALID_PHASE');
    const next = a.startNewSeason();
    expect(next.time).toEqual({ season: 2, day: 1 });
    expect(a.getSeasonOutcome(1)?.finalTable).toHaveLength(14);
  });

  it('플랜: 미리보기 → 추천대로 제출 → 적용 플랜 반영, 초안은 적용되지 않음', () => {
    const s = svc();
    s.newGame({ seed: 3 });
    const ps = s.getPlanState();
    expect(ps.preview?.source).toBe('SYSTEM');
    const rec = s.recommendPlan();
    const draft: MatchPlan = { ...rec, startSlot: 'B' };
    s.saveDraft(draft);
    expect(s.previewResolvedPlan()?.plan.startSlot).toBe('A'); // 초안 무시
    const record = s.submitPlan(rec, { origin: 'RECOMMENDED' });
    expect(record.status).toBe('CONFIRMED');
    expect(s.previewResolvedPlan()?.source).toBe('CONFIRMED');
    const log = JSON.parse(s.exportActionLog()) as { kind: string }[];
    expect(log.map((e) => e.kind)).toContain('PLAN_RECOMMENDED_SUBMITTED');
    const r = s.advanceDay();
    expect(r.userResolvedPlan?.source).toBe('CONFIRMED');
    const report = s.getReport(r.userMatchId!);
    expect(report.clubId).toBe(s.getSnapshot()!.userClubId);
    const replay = s.getMatchReplay(r.userMatchId!);
    expect(replay.lines.length).toBeGreaterThan(10);
    expect(replay.momentum).toHaveLength(18);
    const re = s.resimulate(r.userMatchId!, { tacticsEnabled: false });
    expect(re.factorBars.tactics).toBe(0);
  });

  it('잘못된 플랜은 INVALID_PLAN, remapLineup 은 새 포메이션에 11명을 재배치', () => {
    const s = svc();
    s.newGame({ seed: 4 });
    const rec = s.recommendPlan();
    expect(code(() => s.submitPlan({ ...rec, lineup: { starters: rec.lineup.starters.slice(0, 9), bench: [] } }))).toBe('INVALID_PLAN');
    const re = s.remapLineup!(rec, 'B');
    expect(re.startSlot).toBe('B');
    expect(re.lineup.starters).toHaveLength(11);
    expect(s.validatePlan(re).filter((i) => i.severity === 'ERROR')).toEqual([]);
  });

  it('전술 변경: 포메이션 변경 시 숙련도 절반, 오프사이드 트랩은 라인 +1 이상', () => {
    const s = svc();
    s.newGame({ seed: 5 });
    const A = s.getSnapshot()!.clubs[s.getSnapshot()!.userClubId]!.tactics.A;
    const cat = s.getCatalog();
    const f433 = cat.formations.find((f) => f.id === '4-3-3')!;
    const r = s.updateTacticSlot('A', { formation: '4-3-3', roles: f433.slots.map((x) => x.defaultRole), instructions: A.instructions });
    expect(r.familiarityHalved).toBe(true);
    expect(r.slot.familiarity).toBe(Math.round(A.familiarity * 0.5));
    const r2 = s.updateTacticSlot('A', { formation: '4-3-3', roles: r.slot.roles, instructions: { ...A.instructions, press: 2 } });
    expect(r2.familiarityHalved).toBe(false);
    expect(code(() => s.updateTacticSlot('A', { formation: '4-3-3', roles: r.slot.roles, instructions: { ...A.instructions, line: 0, offsideTrap: true } }))).toBe('INVALID_TACTIC');
  });

  it('코치 제안 → 권한 체크 → 승인 → 확정 플랜·팀 지시 반영, 충돌 제안 SUPERSEDED', () => {
    const s = svc();
    s.newGame({ seed: 6 });
    const matchId = s.getNextMatch()!.id;
    expect(code(() => s.propose({ payload: { kind: 'PLAN_CHANGE', matchId, patch: { startSlot: 'B' } }, reason: 'x' }))).toBe('PERMISSION_DENIED');
    s.switchRole('COACH');
    expect(s.getActor().seat).toBe('COACH');
    expect(code(() => s.submitPlan(s.recommendPlan()))).toBe('PERMISSION_DENIED');
    const p1 = s.propose({ payload: { kind: 'PLAN_CHANGE', matchId, patch: { instructions: { slot: 'A', patch: { press: 2 } } } }, reason: '상대 빌드업이 약함' });
    const p2 = s.propose({ payload: { kind: 'PLAN_CHANGE', matchId, patch: { instructions: { slot: 'A', patch: { press: -1, width: 1 } } } }, reason: '체력 관리' });
    expect(code(() => s.propose({ payload: { kind: 'PLAN_CHANGE', matchId, patch: { instructions: { slot: 'A', patch: { press: 1 } } } }, reason: '중복' }))).toBe('PROPOSAL_DUPLICATE');
    s.react(p1.id, 'FOR', '동의');
    expect(code(() => s.approve(p1.id))).toBe('PERMISSION_DENIED');
    s.switchRole('OWNER');
    const res = s.approve(p1.id);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.superseded).toEqual([p2.id]);
    const snap = s.getSnapshot()!;
    expect(snap.clubs[snap.userClubId]!.tactics.A.instructions.press).toBe(2);
    expect(s.getPlanState().confirmed?.sourceProposalId).toBe(p1.id);
    expect(s.listProposals({ status: 'SUPERSEDED' }).map((p) => p.id)).toEqual([p2.id]);
    expect(code(() => s.reject(p1.id))).toBe('PROPOSAL_NOT_OPEN');
  });

  it('승인 시 대상 선수가 부상이면 STALE, 마감되면 EXPIRED', () => {
    const s = svc();
    s.newGame({ seed: 8 });
    const snap = s.getSnapshot()!;
    const matchId = s.getNextMatch()!.id;
    const rec = s.recommendPlan();
    const benchGuy = snap.clubs[snap.userClubId]!.playerIds.find((id) => !rec.lineup.starters.includes(id) && snap.players[id]!.primary === snap.players[rec.lineup.starters[5]!]!.primary) ?? rec.lineup.bench[0]!;
    const starters = [...rec.lineup.starters];
    starters[5] = benchGuy;
    s.switchRole('COACH');
    const p = s.propose({ payload: { kind: 'PLAN_CHANGE', matchId, patch: { lineup: { starters, bench: rec.lineup.bench.filter((x) => x !== benchGuy) } } }, reason: '로테이션' });
    const p2 = s.propose({ payload: { kind: 'PLAN_CHANGE', matchId, patch: { startSlot: 'B' } }, reason: '수비적으로' });
    s.switchRole('OWNER');
    // 가져오기로 부상 상태를 만든다 (서비스 공개 API)
    const save = JSON.parse(s.exportSave());
    save.players[benchGuy].availability.injuryDays = 3;
    s.importSave(JSON.stringify(save));
    const res = s.approve(p.id);
    expect(res.ok).toBe(false);
    expect(res.proposal.status).toBe('STALE');
    const day = s.advanceDay();
    expect(day.expiredProposals).toContain(p2.id);
  });

  it('importSave 는 호환 불가 데이터를 거부, resetGame 은 저장소를 비운다', () => {
    const storage = createMemoryStorage();
    const s = svc(storage);
    s.newGame({ seed: 2 });
    expect(code(() => s.importSave('{bad'))).toBe('SAVE_INCOMPATIBLE');
    expect(code(() => s.importSave(JSON.stringify({ schemaVersion: 999 })))).toBe('SAVE_INCOMPATIBLE');
    s.resetGame();
    expect(s.getSnapshot()).toBeNull();
    expect(storage.load()).toBeNull();
  });

  it('[리뷰 R1] 구조가 깨진 세이브는 가져오기 거부 + 기존 저장 유지, 불러오기는 null', () => {
    const storage = createMemoryStorage();
    const s = svc(storage);
    s.newGame({ seed: 3 });
    const good = s.exportSave();
    const before = s.getSnapshot();
    const broken = (mut: (x: Record<string, any>) => void) => {
      const x = JSON.parse(good);
      mut(x);
      return JSON.stringify(x);
    };
    const cases = [
      broken((x) => delete x.fixtures),
      broken((x) => delete x.players[x.clubs[x.userClubId].playerIds[0]]),
      broken((x) => (x.clubs[x.userClubId].tactics.A.formation = 'NOPE')),
      broken((x) => delete x.finances[x.userClubId]),
      broken((x) => (x.actorUserId = 'intruder')),
      broken((x) => (x.time.day = 99)),
    ];
    for (const json of cases) expect(code(() => s.importSave(json))).toBe('SAVE_INCOMPATIBLE');
    expect(s.getSnapshot()).toBe(before);
    expect(storage.load()).toBe(good);
    expect(svc(createMemoryStorage(cases[1]!)).loadGame()).toBeNull();
    expect(code(() => s.importSave(good))).toBe('no-error');
  });

  it('[리뷰 R2] 제안 diff 는 선수 id 가 아니라 이름을 보여주고, 잘못된 슬롯 패치는 PROPOSAL_INVALID', () => {
    const s = svc();
    s.newGame({ seed: 4 });
    const snap = s.getSnapshot()!;
    const matchId = s.getNextMatch()!.id;
    const rec = s.recommendPlan();
    const sub = rec.lineup.bench.find((id) => snap.players[id]!.primary !== 'GK')!;
    const starters = [...rec.lineup.starters];
    starters[6] = sub;
    s.switchRole('COACH');
    const p = s.propose({ payload: { kind: 'PLAN_CHANGE', matchId, patch: { lineup: { starters, bench: rec.lineup.bench.filter((x) => x !== sub) } } }, reason: '로테이션' });
    const d = p.diff.find((x) => x.path === 'lineup.starters[6]')!;
    expect(d.after).toBe(snap.players[sub]!.name);
    expect(d.before).toBe(snap.players[rec.lineup.starters[6]!]!.name);
    const bad = { instructions: { slot: 'C', patch: { press: 1 } } } as never;
    expect(code(() => s.propose({ payload: { kind: 'PLAN_CHANGE', matchId, patch: bad }, reason: 'x' }))).toBe('PROPOSAL_INVALID');
  });

  it('저장 실패 시 이전 상태를 유지하고 STORAGE_FULL', () => {
    let fail = false;
    const base = createMemoryStorage();
    const storage = { ...base, save: (d: string) => (fail ? (() => { throw new Error('QuotaExceeded'); })() : base.save(d)) };
    const s = createGameService({ storage, clock });
    s.newGame({ seed: 11 });
    const before = s.getSnapshot();
    fail = true;
    expect(code(() => s.advanceDay())).toBe('STORAGE_FULL');
    expect(s.getSnapshot()).toBe(before);
  });

  it('재정 요약, 상대 분석, 카탈로그', () => {
    const s = svc();
    s.newGame({ seed: 12, startTier: 'T3' });
    s.advanceDays(3);
    const f = s.getFinance();
    expect(f.salaryCap).toBe(64_000_000);
    expect(f.capUsage).toBeGreaterThan(0.8);
    expect(f.capUsage).toBeLessThanOrEqual(1);
    expect(f.seasonIncome).toBeGreaterThanOrEqual(61_000_000);
    const opp = s.getNextMatch()!;
    const oppId = opp.homeId === s.getSnapshot()!.userClubId ? opp.awayId : opp.homeId;
    const scout = s.getOpponentScout(oppId);
    expect(scout.last5).toHaveLength(3);
    expect(scout.weakness.length).toBeGreaterThan(0);
    const cat = s.getCatalog();
    expect(cat.formations).toHaveLength(9);
    expect(cat.roles).toHaveLength(28);
    expect(cat.presets).toHaveLength(5);
    expect(cat.attributes).toHaveLength(15);
  });

  it('runCalibration (워커 없는 환경은 동기 대체)', async () => {
    const s = svc();
    const rep = await s.runCalibration({ matchesPerScenario: 40, tacCap: 0.35, seed: 1, scenarios: ['BASELINE'] });
    expect(rep.targets.length).toBeGreaterThan(0);
  });
});
