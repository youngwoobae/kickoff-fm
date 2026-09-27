/** 도메인 공개 API. services 는 이 파일만 import 한다. 소유: A. */
export { makeMatchId, parseMatchId, generateDoubleRoundRobin } from './league/schedule';
export { computeStandings } from './league/standings';
export { judgeSeason } from './league/promotion';
export { expectedPoints } from './league/xpts';
export { buildOpponentScout, summarizeInstructions, lastTacticOf } from './league/scout';
export {
  generatePlayer,
  generateSquad,
  createBotClub,
  computeOvr,
  assignSalaries,
  scoutGrade,
  TIER_REFERENCE_OVR,
  type GenerateSquadOptions,
} from './squad/generator';
export { ovrAt, OVR_WEIGHTS } from './squad/ovr';
export { applyDailyRecovery, applyMatchLine, applyMoraleResult, staminaRecoveryBonus } from './squad/condition';
export { resolvePlan, validatePlan, remapLineup, pickCandidate, stripOpponentOrders, type ResolvePlanContext } from './plan/resolvePlan';
export { toEngineTeamInput, toEnginePlayer } from './plan/engineInput';
export { TIER_ECONOMY, SEASON_DAYS, dailySalary, matchBonus, prizeFor, prizeRate, carryOver, spendable, postLedger } from './economy/economy';
export { checkAction, isNewCoach, type PermissionContext } from './coach/permissions';
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
export {
  styleTactics,
  humanDefaultTactics,
  pickLineup,
  buildPlan,
  isAvailable,
  slotScore,
  botConditionals,
  type ManagerAiContext,
  type ManagerAiMode,
} from './ai/managerAi';
export { tacticEdge, tacticEdgeTotal, type TacticShape } from './ai/matchup';
export { buildReport, computeLeagueAverages, chanceLabel, DEFAULT_LEAGUE_AVERAGES, type LeagueAverages } from './report/buildReport';
export { buildReplay, type ReplayNames } from './report/commentary';
export {
  runCalibration,
  runCalibrationDetailed,
  buildValueTable,
  PACKAGES,
  SPREAD_PACKAGES,
  type CalibrationDetails,
  type PackageId,
  type TacticPackage,
} from './calibration/runCalibration';
export {
  advanceDayState,
  startNewSeasonState,
  createInitialState,
  matchSeed,
  fixtureFor,
  clubPlayers,
  salaryTotal,
  starterOvr,
  SCHEMA_VERSION,
  MATCH_DAYS,
  USER_CLUB_ID,
  OWNER_ID,
  COACH_ID,
  SYSTEM_ACTOR,
  type AdvanceOutcome,
} from './day/advanceDay';
export { DomainError, isDomainError } from './errors';
