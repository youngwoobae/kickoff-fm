/** 도메인 공개 API. services 는 이 파일만 import 한다. 소유: A. */
export { makeMatchId, parseMatchId, generateDoubleRoundRobin } from './league/schedule';
export { computeStandings, resultsOfFixtures, type ResultLike } from './league/standings';
export {
  TIERS,
  TIER_NAMES,
  BOUNDARY_MOVES,
  DEFAULT_START_TIER,
  leagueIdOf,
  movesOf,
  leagueInfo,
  buildCareer,
  leaguesOf,
  userLeagueOf,
  findLeague,
  clubTierMap,
  clubLeagueMap,
  buildPyramid,
  leagueTable,
  seasonMovements,
  applyMovements,
} from './league/pyramid';
export { QUICK_SIM, teamStrength, quickSimScore } from './league/quickSim';
export { judgeSeason } from './league/promotion';
export { expectedPoints } from './league/xpts';
export { buildOpponentScout, summarizeInstructions, lastTacticOf, botStyleOf } from './league/scout';
export {
  generatePlayer,
  generateSquad,
  createBotClub,
  computeOvr,
  assignSalaries,
  scoutGrade,
  salaryFor,
  botName,
  TIER_REFERENCE_OVR,
  type GenerateSquadOptions,
} from './squad/generator';
export { ovrAt, OVR_WEIGHTS } from './squad/ovr';
export { applyDailyRecovery, applyMatchLine, applyMoraleResult, staminaRecoveryBonus } from './squad/condition';
export { resolvePlan, validatePlan, remapLineup, pickCandidate, stripOpponentOrders, type ResolvePlanContext } from './plan/resolvePlan';
export { toEngineTeamInput, toEnginePlayer } from './plan/engineInput';
export { TIER_ECONOMY, SEASON_DAYS, S_REF, TIER_GAP, PROMOTION_BONUS_RATE, PARACHUTE_RATE, promotionBonus, parachuteOf, baseSalary, startingBalance, dailySalary, matchBonus, prizeFor, prizeRate, carryOver, spendable, postLedger } from './economy/economy';
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
export { tacticEdge, tacticEdgeTotal, staticView, matchupPreview, styleFitOf, type TacticShape } from './ai/matchup';
export { migrateSave } from './save/migrate';
export { buildReport, computeLeagueAverages, chanceLabel, DEFAULT_LEAGUE_AVERAGES, type LeagueAverages } from './report/buildReport';
export { buildReplay, type ReplayNames } from './report/commentary';
export {
  runCalibration,
  runCalibrationDetailed,
  buildValueTable,
  PACKAGES,
  SPREAD_PACKAGES,
  styleShort,
  styleMatrixMatch,
  STYLE_FIT_MODS,
  type RealismSummary,
  type RoleSignatureRow,
  TARGETS as CALIBRATION_TARGETS,
  type CalibrationDetails,
  type PackageId,
  type TacticPackage,
} from './calibration/runCalibration';
export { startNewSeasonState, toPyramid, LEGACY_LEAGUE_TIER } from './career/seasonTransition';
export {
  advanceDayState,
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
  TIER_BAND,
  type AdvanceOutcome,
} from './day/advanceDay';
export { DomainError, isDomainError } from './errors';
export { runCareerSim, runCareerSeed, judgeCareer, type CareerSimOptions, type CareerSimReport, type CareerGate, type SeedRun } from './calibration/careerSim';
