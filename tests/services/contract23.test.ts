/** 계약 2.3.0 (M5.1): setTrainingFocus / getYouthIntake / decideYouth 서비스 연결 */
import { describe, expect, it } from 'vitest';
import { createGameService, type GameService } from '../../src/services';
import { youthSalary } from '../../src/domain';

const clock = { nowIso: () => '2026-10-05T00:00:00.000Z' };
type Svc = Required<Pick<GameService, 'setTrainingFocus' | 'getYouthIntake' | 'decideYouth' | 'getInbox'>> & GameService;
const svc = () => createGameService({ clock }) as Svc;

describe('훈련 포커스 (2.3.0)', () => {
  it('예약 → 다음 주 시작(Day 8)에 적용, 같은 값이면 예약 취소, 코치·잘못된 값 거부, 행동 로그', () => {
    const s = svc();
    s.newGame({ seed: 3 });
    const club = () => s.getSnapshot()!.clubs[s.getSnapshot()!.userClubId]!;
    expect(club().training).toBeUndefined();
    s.setTrainingFocus('RECOVERY');
    expect(club().training).toEqual({ focus: 'BALANCED', next: 'RECOVERY' });
    expect(s.getSnapshot()!.actionLog.at(-1)!.kind).toBe('TRAINING_FOCUS_SET');
    s.setTrainingFocus('BALANCED');
    expect(club().training).toEqual({ focus: 'BALANCED' });
    expect(() => s.setTrainingFocus('NOPE' as never)).toThrow(expect.objectContaining({ code: 'INVALID_TACTIC' }));
    s.setTrainingFocus('TACTICAL');
    s.advanceDays(6); // Day 7
    expect(club().training?.focus).toBe('BALANCED');
    s.advanceDay(); // Day 8
    expect(club().training).toEqual({ focus: 'TACTICAL' });
    s.switchRole('COACH');
    expect(() => s.setTrainingFocus('ATTACK')).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
  });
});

describe('유스 (2.3.0)', () => {
  it('시즌 경계 → Day 1 후보·편지, potential 가림, decideYouth 승격·결정 표시, Day 8 에 사라짐', () => {
    const s = svc();
    s.newGame({ seed: 4 });
    expect(s.getYouthIntake()).toBeNull();
    s.advanceToSeasonEnd();
    s.startNewSeason();
    const yi = s.getYouthIntake()!;
    expect(yi.deadlineDay).toBe(7);
    for (const c of yi.candidates) {
      expect(c.potential).toBe(c.ovr); // 숨김 값 가림
      expect(c.tierRange).toHaveLength(2);
    }
    // 원본 상태의 potential 은 그대로
    expect(s.getSnapshot()!.youthIntake!.candidates.some((c) => c.potential !== c.ovr)).toBe(true);
    expect(s.getInbox().some((m) => m.kind === 'YOUTH_INTAKE')).toBe(true);
    expect(() => s.decideYouth(yi.candidates.slice(0, 3).map((c) => c.id))).toThrow(expect.objectContaining({ code: 'SQUAD_FULL' }));
    const pick = yi.candidates[0]!;
    s.decideYouth([pick.id]);
    const p = s.getPlayer(pick.id);
    expect(p.clubId).toBe(s.getSnapshot()!.userClubId);
    expect(p.contract.salary).toBe(youthSalary(p.ovr));
    expect(s.getSquad().some((x) => x.id === pick.id)).toBe(true);
    expect(s.getYouthIntake()).toMatchObject({ decided: true, promotedIds: [pick.id] });
    expect(s.getSnapshot()!.actionLog.at(-1)).toMatchObject({ kind: 'YOUTH_DECIDED', data: { promoted: [pick.id] } });
    expect(() => s.decideYouth([])).toThrow(expect.objectContaining({ code: 'INVALID_PHASE' }));
    s.advanceDays(7); // Day 8
    expect(s.getYouthIntake()).toBeNull();
    expect(s.getInbox().some((m) => m.kind === 'YOUTH_AUTO_DECIDED')).toBe(false);
  });

  it('미결정이면 Day 8 자동 처리 편지 YOUTH_AUTO_DECIDED. 코치는 결정 불가', () => {
    const s = svc();
    s.newGame({ seed: 4 });
    s.advanceToSeasonEnd();
    s.startNewSeason();
    s.switchRole('COACH');
    expect(() => s.decideYouth([])).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
    s.switchRole('OWNER');
    s.advanceDays(7);
    expect(s.getYouthIntake()).toBeNull();
    expect(s.getInbox().some((m) => m.kind === 'YOUTH_AUTO_DECIDED')).toBe(true);
  });

  it('경고 누적: 시즌 경계에서 누적 0, 남은 정지 경기 유지 (D4)', () => {
    const s = svc();
    s.newGame({ seed: 5 });
    s.advanceToSeasonEnd();
    const st = s.getSnapshot()!;
    const imported = structuredClone(st);
    const id = st.clubs[st.userClubId]!.playerIds[0]!;
    imported.players[id] = { ...imported.players[id]!, availability: { ...imported.players[id]!.availability, yellowAccum: 3, suspendedMatches: 1 } };
    s.importSave(JSON.stringify(imported));
    s.startNewSeason();
    expect(s.getPlayer(id).availability).toMatchObject({ yellowAccum: 0, suspendedMatches: 1 });
    // 사용자 리그 경기 처리 뒤 시즌 경고 통계가 쌓인다
    s.advanceDays(10);
    expect(s.getSquad().some((p) => (p.season.yellowCards ?? 0) > 0)).toBe(true);
  });
});
