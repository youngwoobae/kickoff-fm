/** 엔진 공개 API. domain 은 이 파일만 import 한다. */
export { simulateMatch, usedSlotsOf } from './simulate';
export { explainMatch, decomposeBinary, valueOf } from './explain';
export { computeUnits, computeUnitsFromOccupants, conditionEfficiency, fitOf, type Occupant } from './units';
export { mulberry32, seedFrom, hashString, pickWeighted, type Rng } from './rng';
export { clamp, sigmoid, logit } from './math';
export { evalBinaryRules, evalChoiceRules, ruleEnabled, OPEN_CHANCES, type TeamView, type RawMap } from './rules';
export * as EngineConstants from './data/constants';
export { ENGINE_VERSION } from './data/constants';
export { FORMATIONS, FORMATION_IDS, ALLOWED_ROLES, DEFAULT_ROLE, defaultRoles } from './data/formations';
export { ROLES, ROLE_IDS, ROLE_UNIT_WEIGHTS } from './data/roleWeights';
export { PRESETS, PRESET_IDS, RULE_DEFS, RULE_IDS, NEUTRAL_INSTRUCTIONS } from './data/presets';
export { VALUE_TABLE } from './data/valueTable';
