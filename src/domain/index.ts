/** 도메인 공개 API. services 는 이 파일만 import 한다. 소유: A. */
export { makeMatchId, generateDoubleRoundRobin } from './league/schedule';
export { computeStandings } from './league/standings';
export { judgeSeason } from './league/promotion';
export { generatePlayer, generateSquad, createBotClub, computeOvr, type GenerateSquadOptions } from './squad/generator';
export { applyDailyRecovery, applyMatchLine } from './squad/condition';
export { resolvePlan, validatePlan, type ResolvePlanContext } from './plan/resolvePlan';
export { toEngineTeamInput } from './plan/engineInput';
export { TIER_ECONOMY, dailySalary, matchBonus, prizeFor, carryOver, spendable } from './economy/economy';
export { checkAction, type PermissionContext } from './coach/permissions';
export {
  createProposal,
  applyPatch,
  diffBundles,
  type PlanBundle,
  findConflicting,
  pickBasePlan,
  MAX_OPEN_PER_COACH,
  MAX_REASON_LENGTH,
} from './coach/proposals';
export { styleTactics, pickLineup, buildPlan, type ManagerAiContext, type ManagerAiMode } from './ai/managerAi';
export { buildReport, computeLeagueAverages, type LeagueAverages } from './report/buildReport';
export { buildReplay } from './report/commentary';
export { runCalibration } from './calibration/runCalibration';
export { advanceDayState, startNewSeasonState, createInitialState, type AdvanceOutcome } from './day/advanceDay';
