/** 엔진 공개 API. domain 은 이 파일만 import 한다. */
export { simulateMatch, simulateMatchSteps, usedSlotsOf } from './simulate';
export { explainMatch, decomposeBinary, valueOf } from './explain';
export { computeUnits, computeUnitsFromOccupants, computeShape, conditionEfficiency, eff, fitOf, type Occupant } from './units';
export { mulberry32, seedFrom, hashString, pickWeighted, type Rng } from './rng';
export { clamp, logit } from './math';
export { evalBinaryRules, evalChoiceRules, paceMult, centralDiff, sideOverload, OPEN_CHANCES, type TeamView } from './rules';
export * as EngineConstants from './data/constants';
export { ENGINE_VERSION } from './data/constants';
export { FORMATIONS, FORMATION_IDS, defaultRoles } from './data/formations';
export { ROLES, ROLE_IDS, ROLE_SHAPE } from './data/roleWeights';
export {
  PRESETS,
  PRESET_IDS,
  STYLES,
  STYLE_IDS,
  STYLE_MATRIX_EXPECTED,
  nearestStyle,
  RULE_DEFS,
  RULE_IDS,
  NEUTRAL_INSTRUCTIONS,
} from './data/presets';
export { VALUE_TABLE } from './data/valueTable';
