/** 엔진 공개 API. domain 은 이 파일만 import 한다. */
export { simulateMatch } from './simulate';
export { explainMatch } from './explain';
export { computeUnits, conditionEfficiency } from './units';
export { mulberry32, seedFrom, hashString, pickWeighted, type Rng } from './rng';
export { clamp, sigmoid, logit } from './math';
export * as EngineConstants from './data/constants';
export { ENGINE_VERSION } from './data/constants';
