/**
 * 계약·재계약·방출 순수 함수 (M4.2, 경제 설계 docs/설계/오프라인_경제.md 5장, 7.5, D19).
 * 협상 난수 없음: 같은 입력이면 같은 결과. 게임 상태 연결은 M4.4.
 * 모든 함수는 입력을 바꾸지 않는다. 금액은 KC 정수, 1,000 KC 반올림.
 */
import type { ClubId, Contract, Day, Kc, LedgerEntry, PendingRenewal, Player, PlayerId, RenewalQuote, ReleaseQuote, SeasonNo, Tier } from '../../types';
import { DomainError } from '../errors';
import { SEASON_DAYS, TIER_ECONOMY, baseSalary } from '../economy/economy';
import { TIER_REFERENCE_OVR } from '../squad/generator';
import { LIFECYCLE } from '../squad/lifecycle';

/** 경제 13장 K5~K7, K4 일부 [PH] */
export const CONTRACT = {
  minSalary: 200_000,
  capChargeFloorRate: 0.8,
  salaryFloorRate: 0.9,
  ask: { min: 0.9, max: 1.3, starter: 0.1, starterShare: 0.5, aboveTier: 0.15, aboveTierGap: 6, age31: -0.1, age33: -0.2 },
  renewalBonusRate: 0.1,
  renewalOpenDay: 20,
  renewalCloseDay: 27,
  penaltyRate: 0.5,
  relegationCapGrace: 1.1,
  freeReleasesOnRelegation: 2,
  emergency: { minRegistered: 18, minAvailable: 16, perSeason: 2 },
  /** 7.5 AI 재계약 */
  ai: { keepRank: 20, keepMaxAge: 31, vetRank: 20, vetMinAge: 32, capUseMax: 0.97, maxSeasons: 3, youngMaxAge: 23, youngPriority: [[21, 4], [23, 2]] as const },
} as const;

export interface RenewalOffer {
  salary: Kc;
  seasons: number;
}

/** 재계약 성립분. 시즌 경계(contractBoundary)에서 새 계약으로 바뀐다 (2.2.1: 타입은 types/transfer.ts) */
export type { PendingRenewal };

export type ContractEvent =
  | { kind: 'RENEWAL_OPEN'; clubId: ClubId; playerIds: PlayerId[] }
  | { kind: 'RENEWED'; playerId: PlayerId; clubId: ClubId; salary: Kc; seasons: number }
  | { kind: 'CONTRACT_EXPIRED'; playerId: PlayerId; clubId: ClubId }
  | { kind: 'PLAYER_RELEASED'; playerId: PlayerId; clubId: ClubId; penalty: Kc; exempt: boolean }
  | { kind: 'NEGATIVE_BALANCE'; clubId: ClubId; balance: Kc }
  | { kind: 'FORCED_SALE'; playerId: PlayerId; clubId: ClubId; amount: Kc };

const r1000 = (v: number): Kc => Math.round(v / 1000) * 1000;
/** 결정 경로 ID 정렬: 코드 포인트 순(localeCompare 는 런타임 ICU 로캘에 따라 달라질 수 있다, 리뷰 m8) */
export const cmpId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ── 5.1 ──

/** 캡 산입액 계산에 필요한 최소 형태 (이적 도메인도 이 함수를 쓴다 — 2.2.1 에서 transfer/value 의 capChargeOf 를 합침) */
export interface CapChargeInput {
  ovr: number;
  contract: Pick<Contract, 'salary'> & Partial<Contract>;
}

/** 캡 산입액 = max(연봉, 0.8 × S(ovr)) + 시즌당 보너스 */
export function capCharge(p: CapChargeInput): Kc {
  return Math.max(p.contract.salary, r1000(CONTRACT.capChargeFloorRate * baseSalary(p.ovr))) + (p.contract.bonusPerSeason ?? 0);
}

/** 구단 캡 사용 = Σ 캡 산입액 (임시 계약 포함) */
export function capUsage(squad: readonly CapChargeInput[]): Kc {
  return squad.reduce((s, p) => s + capCharge(p), 0);
}

/** 캡 한도. 강등 시즌이면 110% */
export function capLimit(tier: Tier, relegatedThisSeason = false): Kc {
  const cap = TIER_ECONOMY[tier].salaryCap;
  return relegatedThisSeason ? Math.round(cap * CONTRACT.relegationCapGrace) : cap;
}

/** 계약 후 캡 사용 ≤ 한도일 때만 허용 (영입·재계약·FA 계약 공통) */
export function fitsCap(usageAfter: Kc, limit: Kc): boolean {
  return usageAfter <= limit;
}

/** 연봉 하한 = max(0.2M, 0.9 × S(ovr)) */
export function salaryFloor(ovr: number): Kc {
  return Math.max(CONTRACT.minSalary, r1000(CONTRACT.salaryFloorRate * baseSalary(ovr)));
}

/** 허용 계약 기간 (계약 시점 나이): ≤23: 1~3 / 24~29: 1~4 / 30~32: 1~2 / ≥33: 1 */
export function seasonsRange(age: number): [number, number] {
  return [1, maxContractSeasons(age)];
}

/** 허용 계약 기간의 최대 시즌 수 (2.2.1: transfer/value 에서 옮김) */
export function maxContractSeasons(age: number): number {
  return age <= 23 ? 3 : age <= 29 ? 4 : age <= 32 ? 2 : 1;
}

// ── 5.2 재계약 ──

export interface AskContext {
  /** 소속 구단 티어 */
  tier: Tier;
  /** 이번 시즌 소속 구단이 치른 경기 수 (주전 판정 분모). 0 이면 주전 아님 */
  clubMatches: number;
}

/** 요구 연봉 = S × clamp(m, 0.9, 1.3), 하한 적용 */
export function renewalAsk(p: Pick<Player, 'ovr' | 'age' | 'season'>, ctx: AskContext): Kc {
  const A = CONTRACT.ask;
  let m = 1;
  if (ctx.clubMatches > 0 && p.season.starts >= A.starterShare * ctx.clubMatches) m += A.starter;
  if (p.ovr >= TIER_REFERENCE_OVR[ctx.tier] + A.aboveTierGap) m += A.aboveTier;
  if (p.age >= 33) m += A.age33;
  else if (p.age >= 31) m += A.age31;
  m = Math.min(A.max, Math.max(A.min, m));
  return Math.max(salaryFloor(p.ovr), r1000(baseSalary(p.ovr) * m));
}

/** 갱신 보너스 = 0.10 × 새 연봉 × 시즌 수 (즉시 지급, 캡에는 시즌당 1/시즌수) */
export function renewalBonus(salary: Kc, seasons: number): Kc {
  return r1000(CONTRACT.renewalBonusRate * salary * seasons);
}

/** 재계약 창: 잔여 1시즌, Day 20~27 */
export function renewalOpen(p: Pick<Player, 'contract' | 'clubId' | 'isTemporary'>, day: Day): boolean {
  return p.clubId !== null && !p.isTemporary && p.contract.seasonsLeft === 1 && day >= CONTRACT.renewalOpenDay && day <= CONTRACT.renewalCloseDay;
}

export function renewalQuote(p: Player, ctx: AskContext): RenewalQuote {
  return { playerId: p.id, askSalary: renewalAsk(p, ctx), seasonsRange: seasonsRange(p.age), bonusPerSeasonRate: CONTRACT.renewalBonusRate };
}

export interface RenewalDecision {
  accepted: boolean;
  ask: Kc;
  /** accepted 일 때만 */
  pending?: PendingRenewal;
  ledger?: LedgerEntry;
  event?: ContractEvent;
}

export interface RenewalContext extends AskContext {
  season: SeasonNo;
  day: Day;
  /** 이 선수를 뺀 구단 캡 사용 (다른 선수의 성립된 재계약 반영은 호출자 몫) */
  usageWithoutPlayer: Kc;
  capLimit: Kc;
}

/**
 * 재계약 제안 판정. 창 밖 → RENEWAL_NOT_OPEN, 성립 시 캡 초과 → CAP_EXCEEDED.
 * 수락 = 제안 연봉 ≥ ask 이고 기간이 허용 범위 안. 거절은 오류가 아니다(accepted false).
 * 캡 판정은 새 계약 기준 산입액(다음 시즌부터의 값)으로 한다.
 */
export function offerRenewal(p: Player, offer: RenewalOffer, ctx: RenewalContext): RenewalDecision {
  if (!renewalOpen(p, ctx.day)) throw new DomainError('RENEWAL_NOT_OPEN', '재계약 기간이 아니에요', [p.id]);
  const ask = renewalAsk(p, ctx);
  const [lo, hi] = seasonsRange(p.age);
  const ok = Number.isInteger(offer.seasons) && offer.seasons >= lo && offer.seasons <= hi && offer.salary >= ask;
  if (!ok || p.clubId === null) return { accepted: false, ask };
  const bonus = renewalBonus(offer.salary, offer.seasons);
  const bonusPerSeason = Math.round(bonus / offer.seasons);
  const charge = capCharge({ ovr: p.ovr, contract: { seasonsLeft: offer.seasons, salary: offer.salary, bonusPerSeason } });
  if (!fitsCap(ctx.usageWithoutPlayer + charge, ctx.capLimit)) throw new DomainError('CAP_EXCEEDED', '재계약하면 연봉 캡을 넘어요', [p.id]);
  return {
    accepted: true,
    ask,
    pending: { playerId: p.id, salary: offer.salary, seasons: offer.seasons, bonusPerSeason },
    ledger: { season: ctx.season, day: ctx.day, kind: 'RENEWAL_BONUS', amount: -bonus, memo: p.id },
    event: { kind: 'RENEWED', playerId: p.id, clubId: p.clubId, salary: offer.salary, seasons: offer.seasons },
  };
}

/**
 * 7.5 AI 재계약 (Day 20): 만료 예정자 중 OVR 순위 ≤ 18 & 나이 ≤ 31 → ask, min(허용 최대, 3)시즌 /
 * 순위 ≤ 18 & 나이 ≥ 32 → ask, 1시즌 (M4.8: 순위 18 → 20, 베테랑 11 → 18).
 * 23세 이하이면서 OVR ≥ 티어 기준이면 순위와 관계없이 재계약(M4.8: 어리고 강한 선수를 FA 로 놓치지 않음).
 * 캡: 우선순위(OVR + 21세 이하 4·23세 이하 2) 높은 대상부터 "계약 후 캡 사용 ≤ max(캡 × 0.97, 지금 캡 사용)" 이면 넣고 아니면 건너뛴다(M4.8).
 * 성장 재계산으로 이미 캡을 넘은 구단도 만료자가 비우는 몫 안에서는 주전을 붙잡는다(5.1 "재계산 초과는 늘리는 계약만 막는다" — 총 사용은 늘지 않음).
 * 갱신 보너스는 사람과 같다(M4.8, 경제 1장 "AI 전용 보정 없음"): bonusPerSeason 을 캡에 산입하고, 지급은 호출자(flow.payAiRenewalBonuses).
 */
export function aiRenewals(squad: readonly Player[], ctx: AskContext & { capLimit: Kc }): PendingRenewal[] {
  const A = CONTRACT.ai;
  const ranked = [...squad].filter((p) => !p.isTemporary).sort((a, b) => b.ovr - a.ovr || cmpId(a.id, b.id));
  const picks: PendingRenewal[] = [];
  ranked.forEach((p, i) => {
    if (p.contract.seasonsLeft !== 1) return;
    const rank = i + 1;
    const salary = renewalAsk(p, ctx);
    const pick = (seasons: number) => picks.push({ playerId: p.id, salary, seasons, bonusPerSeason: Math.round(renewalBonus(salary, seasons) / seasons) });
    if ((rank <= A.keepRank && p.age <= A.keepMaxAge) || (p.age <= A.youngMaxAge && p.ovr >= TIER_REFERENCE_OVR[ctx.tier])) pick(Math.min(seasonsRange(p.age)[1], A.maxSeasons));
    else if (rank <= A.vetRank && p.age >= A.vetMinAge) pick(1);
  });
  // 계약 후 캡 사용 = 비만료자 + 재계약자 새 산입액. 우선순위 = OVR + 어린 나이 가산 (V 나이계수와 같은 방향)
  const byId = new Map(squad.map((p) => [p.id, p]));
  const prio = (id: PlayerId) => {
    const p = byId.get(id)!;
    return p.ovr + (A.youngPriority.find(([age]) => p.age <= age)?.[1] ?? 0);
  };
  picks.sort((a, b) => prio(b.playerId) - prio(a.playerId) || cmpId(a.playerId, b.playerId));
  const limit = Math.max(ctx.capLimit * A.capUseMax, capUsage(squad));
  let used = capUsage(squad.filter((p) => p.contract.seasonsLeft > 1 || p.isTemporary));
  return picks.filter((r) => {
    const charge = capCharge({ ovr: byId.get(r.playerId)!.ovr, contract: { seasonsLeft: r.seasons, salary: r.salary, bonusPerSeason: r.bonusPerSeason } });
    if (used + charge > limit) return false;
    used += charge;
    return true;
  });
}

// ── 5.3 방출 ──

/**
 * 잔여 연봉 = salary × (29 − day) / 28 + salary × (seasonsLeft − 1).
 * 설계 본문은 (28 − day) 지만 표 예시(5.04·0.32·21.60)는 그날 연봉이 아직 안 나간 (29 − day) 와 맞다 → 예시를 따름.
 */
export function remainingSalary(c: Pick<Contract, 'salary' | 'seasonsLeft'>, day: Day): Kc {
  return Math.round((c.salary * (SEASON_DAYS + 1 - day)) / SEASON_DAYS + c.salary * Math.max(0, c.seasonsLeft - 1));
}

export type ReleaseExemption = 'TEMPORARY' | 'YOUTH' | 'FREE_RELEASE';

export interface ReleaseContext {
  season: SeasonNo;
  day: Day;
  /** 강등 시즌 무위약 방출권 남은 장수 (아니면 0) */
  freeReleasesLeft: number;
}

function exemptionOf(p: Player, freeReleasesLeft: number): ReleaseExemption | null {
  if (p.isTemporary) return 'TEMPORARY';
  if (p.clubId === null && p.academyClubId !== undefined) return 'YOUTH';
  if (freeReleasesLeft > 0) return 'FREE_RELEASE';
  return null;
}

/** 위약금 = 0.5 × 잔여 연봉 (면제면 0). 방출권은 다른 면제가 없을 때만 쓴다 */
export function releaseQuote(p: Player, ctx: Pick<ReleaseContext, 'day' | 'freeReleasesLeft'>): ReleaseQuote & { exemption: ReleaseExemption | null } {
  const exemption = exemptionOf(p, ctx.freeReleasesLeft);
  const penalty = exemption ? 0 : r1000(CONTRACT.penaltyRate * remainingSalary(p.contract, ctx.day));
  return { playerId: p.id, penalty, exempt: exemption !== null, exemption };
}

export interface ReleaseResult {
  /** FA 풀로 간 선수. 유스 후보면 null (풀에 넣지 않고 삭제, 경제 8장) */
  player: Player | null;
  penalty: Kc;
  freeReleasesLeft: number;
  /** penalty > 0 일 때만. 강등 시즌 연봉 전용 계정 우선 차감은 호출자(M4.4) 몫 */
  ledger?: LedgerEntry;
  event: ContractEvent;
}

/** 방출 실행: 캡 산입 즉시 해제(소속 없음), 선수는 FA 풀(faSince = 이번 시즌) */
export function releasePlayer(p: Player, ctx: ReleaseContext): ReleaseResult {
  const clubId = p.clubId ?? p.academyClubId;
  if (!clubId) throw new DomainError('NOT_FOUND', '소속 구단이 없는 선수예요', [p.id]);
  const q = releaseQuote(p, ctx);
  const freeReleasesLeft = ctx.freeReleasesLeft - (q.exemption === 'FREE_RELEASE' ? 1 : 0);
  const player =
    q.exemption === 'YOUTH'
      ? null
      : { ...p, clubId: null, faSince: ctx.season, isTemporary: false, retiring: false, contract: { ...p.contract, bonusPerSeason: 0, capCharge: 0 } };
  return {
    player,
    penalty: q.penalty,
    freeReleasesLeft,
    ...(q.penalty > 0 ? { ledger: { season: ctx.season, day: ctx.day, kind: 'RELEASE_PENALTY' as const, amount: -q.penalty, memo: p.id } } : {}),
    event: { kind: 'PLAYER_RELEASED', playerId: p.id, clubId, penalty: q.penalty, exempt: q.exempt },
  };
}

// ── 5.4 긴급 FA ──

export interface EmergencyContext {
  windowOpen: boolean;
  registered: number;
  available: number;
  /** 이번 시즌 긴급 FA 계약 수 */
  signedThisSeason: number;
  /** 등록 GK 수: AI 와 같은 하한(LIFECYCLE.ai.minGk) 미만도 긴급 FA 사유. 없으면 보지 않는다 */
  gk?: number;
}

/** 창 밖에서 등록 18 미만 또는 출전 가능 16 미만, 시즌당 2명 */
export function emergencyFaAllowed(c: EmergencyContext): boolean {
  const E = CONTRACT.emergency;
  return !c.windowOpen && (c.registered < E.minRegistered || c.available < E.minAvailable || (c.gk ?? Infinity) < LIFECYCLE.ai.minGk) && c.signedThisSeason < E.perSeason;
}

/** 긴급 FA 계약: 연봉 = ask(주전 가산 없음), 계약금 0, 1시즌. 캡 검사는 호출자(fitsCap) */
export function emergencyFaSign(p: Player, clubId: ClubId, tier: Tier): Player {
  const salary = renewalAsk(p, { tier, clubMatches: 0 });
  return { ...p, clubId, faSince: undefined, isTemporary: false, contract: { seasonsLeft: 1, salary, bonusPerSeason: 0, capCharge: capCharge({ ovr: p.ovr, contract: { seasonsLeft: 1, salary } }) } };
}

// ── 시즌 경계: 계약 −1, 만료 → 재계약 또는 FA ──

/**
 * 경계(끝난 시즌 endingSeason)에서 소속 선수 전원 계약 −1.
 * 만료(0) 선수: renewals 에 있으면 새 계약(seasonsLeft = 시즌 수), 없으면 FA 풀(clubId null, faSince = endingSeason).
 * 모든 소속 선수의 capCharge 를 다시 계산한다(나이·OVR 변화 뒤에 호출). FA·무소속은 그대로.
 * seasonTransition ⑤의 "자동 1시즌 재계약"을 대체한다 — AI 구단은 aiRenewals 결과를 renewals 에 넣어야 한다.
 */
export function contractBoundary(
  players: readonly Player[],
  renewals: readonly PendingRenewal[],
  endingSeason: SeasonNo,
): { players: Player[]; events: ContractEvent[] } {
  const ren = new Map(renewals.map((r) => [r.playerId, r]));
  const events: ContractEvent[] = [];
  const out = players.map((p) => {
    if (p.clubId === null) return p;
    const left = p.contract.seasonsLeft - 1;
    let contract: Contract;
    if (left > 0) contract = { ...p.contract, seasonsLeft: left };
    else {
      const r = ren.get(p.id);
      if (!r) {
        events.push({ kind: 'CONTRACT_EXPIRED', playerId: p.id, clubId: p.clubId });
        return { ...p, clubId: null, faSince: endingSeason, isTemporary: false, contract: { ...p.contract, bonusPerSeason: 0, capCharge: 0 } };
      }
      contract = { seasonsLeft: r.seasons, salary: r.salary, bonusPerSeason: r.bonusPerSeason };
    }
    return { ...p, contract: { ...contract, capCharge: capCharge({ ovr: p.ovr, contract }) } };
  });
  return { players: out, events };
}
