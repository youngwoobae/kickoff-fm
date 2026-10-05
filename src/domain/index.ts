/** 도메인 공개 API. services 는 이 파일만 import 한다. 소유: A. */
export { josa } from './josa';
export { generateDoubleRoundRobin } from './league/schedule';
export { computeStandings } from './league/standings';
export {
  TIERS,
  DEFAULT_START_TIER,
  leagueIdOf,
  buildCareer,
  leaguesOf,
  userLeagueOf,
  findLeague,
  clubTierMap,
  buildPyramid,
  leagueTable,
} from './league/pyramid';
export { QUICK_SIM, quickSimScore } from './league/quickSim';
export { judgeSeason } from './league/promotion';
export { buildOpponentScout, lastTacticOf, botStyleOf } from './league/scout';
export {
  generatePlayer,
  generateSquad,
  TIER_REFERENCE_OVR,
} from './squad/generator';
export { OVR_WEIGHTS } from './squad/ovr';
export { applyDailyRecovery, applyMatchLine, staminaRecoveryBonus } from './squad/condition';
export { resolvePlan, validatePlan, remapLineup, stripOpponentOrders } from './plan/resolvePlan';
export { toEngineTeamInput, toEnginePlayer } from './plan/engineInput';
export { TIER_ECONOMY, PROMOTION_BONUS_RATE, parachuteOf, baseSalary, startingBalance, dailySalary, matchBonus, prizeFor, carryOver, spendable } from './economy/economy';
export { checkAction, isNewCoach, checkProposeKind, PROPOSAL_AREAS } from './coach/permissions';
export { toClubMember, cleanName, cleanEmoji, checkRoles, nextMemberId, hashPin, PIN_RE, MAX_COACHES, MAX_NAME_LENGTH, ROLE_LABELS, ROLE_NAMES, MEMBER_EMOJIS } from './coach/members';
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
  pickLineup,
  isAvailable,
} from './ai/managerAi';
export { staticView, matchupPreview, styleFitOf } from './ai/matchup';
export { migrateSave } from './save/migrate';
export { buildReport, computeLeagueAverages } from './report/buildReport';
export { buildReplay } from './report/commentary';
export {
  runCalibration,
  runCalibrationDetailed,
  buildValueTable,
  PACKAGES,
  SPREAD_PACKAGES,
  styleShort,
  styleMatrixMatch,
  type PackageId,
} from './calibration/runCalibration';
export { startNewSeasonState } from './career/seasonTransition';
export {
  advanceDayState,
  createInitialState,
  clubPlayers,
  post,
  salaryTotal,
  starterOvr,
  SCHEMA_VERSION,
  OWNER_ID,
  COACH_ID,
  SYSTEM_ACTOR,
} from './day/advanceDay';
export { DomainError, isDomainError } from './errors';
export { runCareerSim } from './calibration/careerSim';
// ── 2.2.1 (M4.4): 계약·편지함·이적 (M4.2·M4.3 순수 도메인 + 게임 상태 연결)
export {
  CONTRACT,
  capCharge,
  capUsage,
  capLimit,
  salaryFloor,
  seasonsRange,
  renewalAsk,
  renewalBonus,
  renewalOpen,
  renewalQuote,
  offerRenewal,
  aiRenewals,
  remainingSalary,
  releaseQuote,
  releasePlayer,
  emergencyFaAllowed,
  emergencyFaSign,
  contractBoundary,
  type CapChargeInput,
} from './contract/contract';
export { INBOX, lifecycleDraft, contractDraft, inboxId, pruneInbox, appendInbox, type InboxDraft } from './inbox/inbox';
export { TRANSFER, round1k, fmtM, windowOf, isSettleDay, potentialEstimate, valueOf, playerValue, budgetB } from './transfer/value';
export {
  listingId,
  generateNpcListings,
  faListing,
  clubListing,
  reservationOf,
  validateBid,
  reservedTotal,
  upsertBid,
  settleWindow,
  negativeBalanceStatus,
  forcedSales,
  type MarketClub,
} from './transfer/market';
export { aiAggr, aiTransferBudget, aiSellListings, aiBids } from './transfer/ai';
export {
  mail,
  mailContract,
  marketClubs,
  marketPlayer,
  listingRecord,
  openWindow,
  registerExpiringFa,
  dropFromMarket,
  clubMatches,
  upsertRenewal,
  fillHumanSquads,
  fillLegacyRenewals,
  benchIdsOf,
  transferDaily,
  withPendingRenewal,
} from './transfer/flow';
// 2.3.0 (M5.1): 훈련 포커스·유스·징계
export { LIFECYCLE, TRAINING_FOCI, applyDiscipline, trainingFocusOf } from './squad/lifecycle';
export { offerYouthIntake, decideYouthState, youthDeadline } from './career/youth';
export { youthSalary } from './economy/economy';
