/**
 * 사람 구단 유스 (M5.1, 수명주기 7장, 계약 2.3.0). 새 시즌 Day 1 후보 생성 → Day 7 까지 decideYouth → Day 8 00:00 미결정분 자동 처리.
 * AI 구단 유스는 시즌 경계 aiSquadMaintenance 가 한 번에 처리한다(저장하지 않음). state 는 호출자가 복사한 것(컨테이너 교체만).
 */
import type { GameState, LifecycleEvent, PlayerId } from '../../types';
import { youthSalary } from '../economy/economy';
import { DomainError } from '../errors';
import { clubTierMap } from '../league/pyramid';
import { TIER_REFERENCE_OVR } from '../squad/generator';
import { LIFECYCLE, generateYouthCandidates, lifeRng, pickYouthAi } from '../squad/lifecycle';
import { mailLifecycle } from '../transfer/flow';
import { clubPlayers } from '../day/advanceDay';

/** 새 시즌 Day 1: 사용자 구단 후보 생성 → youthIntake, 편지 YOUTH_OFFERED */
export function offerYouthIntake(state: GameState): void {
  const clubId = state.userClubId;
  const tier = clubTierMap(state).get(clubId) ?? state.settings.tier;
  const season = state.time.season;
  const candidates = generateYouthCandidates(lifeRng(state.gameSeed, season, 'youth', clubId), clubId, tier, season);
  state.youthIntake = { season, clubId, tier, candidates, deadlineDay: LIFECYCLE.youth.deadlineDay };
  mailLifecycle(state, [{ kind: 'YOUTH_OFFERED', clubId, count: candidates.length }]);
}

/**
 * 승격 0~2명, 나머지는 세계에서 사라진다(후보 목록은 결과 표시용으로 Day 8 까지 decided 로 남음). 계약 3시즌·유스 연봉(K14). 스쿼드(임시 제외) 25명 초과면 SQUAD_FULL.
 * auto = Day 8 자동 처리(편지 YOUTH_AUTO_DECIDED). 사건을 돌려준다.
 */
export function decideYouthState(state: GameState, promoteIds: readonly PlayerId[], auto: boolean): LifecycleEvent[] {
  const intake = state.youthIntake;
  if (!intake) throw new DomainError('INVALID_PHASE', '결정할 유스 후보가 없어요');
  if (intake.decided) throw new DomainError('INVALID_PHASE', '이번 시즌 유스는 이미 결정했어요');
  const ids = [...new Set(promoteIds)];
  if (ids.length > LIFECYCLE.youth.maxPromote) throw new DomainError('SQUAD_FULL', `유스는 한 시즌에 ${LIFECYCLE.youth.maxPromote}명까지 올릴 수 있어요`);
  const picked = ids.map((id) => {
    const c = intake.candidates.find((x) => x.id === id);
    if (!c) throw new DomainError('NOT_FOUND', `유스 후보가 아니에요: ${id}`);
    return c;
  });
  const size = clubPlayers(state, intake.clubId).filter((p) => !p.isTemporary).length;
  if (size + picked.length > LIFECYCLE.ai.maxSquad) throw new DomainError('SQUAD_FULL', `선수단이 ${LIFECYCLE.ai.maxSquad}명을 넘어요. 먼저 방출해 주세요`);
  for (const { tierRange: _t, ...c } of picked) {
    state.players[c.id] = { ...c, clubId: intake.clubId, contract: { ...c.contract, salary: youthSalary(c.ovr), seasonsLeft: LIFECYCLE.youth.contractSeasons } };
  }
  const club = state.clubs[intake.clubId]!;
  state.clubs[intake.clubId] = { ...club, playerIds: [...club.playerIds, ...ids] };
  // 결과 표시용으로 Day 8 까지 남긴다 (youthDeadline 이 지운다)
  state.youthIntake = { ...intake, decided: true, promotedIds: ids };
  const events: LifecycleEvent[] = ids.map((playerId) => ({ kind: 'YOUTH_PROMOTED', playerId, clubId: intake.clubId, auto }));
  if (auto && ids.length === 0) events.push({ kind: 'YOUTH_AUTO_NONE', clubId: intake.clubId, count: intake.candidates.length });
  mailLifecycle(state, events);
  return events;
}

/**
 * AI 규칙(7.4)으로 승격 대상 고르기. fillToMin = false: 사람 미결정 자동 처리(유망주 1명까지),
 * true: 자동 운영 구단(CAREER_SIM, 경제 7.7 — AI 와 같은 규칙)
 */
export function pickYouthFor(state: GameState, fillToMin: boolean): PlayerId[] {
  const intake = state.youthIntake;
  if (!intake || intake.decided) return [];
  const size = clubPlayers(state, intake.clubId).filter((p) => !p.isTemporary).length;
  return pickYouthAi(intake.candidates, size, TIER_REFERENCE_OVR[intake.tier ?? state.settings.tier], fillToMin);
}

/** Day 8 00:00 (deadlineDay + 1 이후): 미결정이면 자동 결정, 그리고 youthIntake 삭제 */
export function youthDeadline(state: GameState): void {
  if (!state.youthIntake || state.time.day <= state.youthIntake.deadlineDay) return;
  if (!state.youthIntake.decided) decideYouthState(state, pickYouthFor(state, false), true);
  delete state.youthIntake;
}
