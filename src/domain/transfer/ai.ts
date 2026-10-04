/**
 * AI 구단 이적 행동 (M4.3, 경제 7.1~7.4 + 수명주기 U4). 모든 결정은 해시 균등값 h(...) — 입찰 순서와 무관.
 * C3(티어 평균 str − ref ±3) 보호: 영입 뒤 주전 전력이 대역 상한(ref + bandHi)을 넘으면 필요 포지션 외 영입 안 함
 * (넘는 영입은 다음 경계에서 수명주기 대역 상한 판매 대상이 되므로).
 */
import type { Bid, ClubId, Kc, Player, Position, Tier, TransferListing, TransferWindow } from '../../types';
import { baseSalary } from '../economy/economy';
import { TIER_REFERENCE_OVR } from '../squad/generator';
import { LIFECYCLE, squadStrength } from '../squad/lifecycle';
import { clubListing, reservationOf, type MarketClub } from './market';
import { TRANSFER, capChargeOf, capUse, h, maxContractSeasons, playerValue, round1k } from './value';

/** [PH] 경제 7.2~7.4 */
export const AI_TRANSFER = {
  reserveCapRate: 0.05,
  midBudgetRate: 0.5,
  relegatedBudgetRate: 0.25,
  groupMin: { GK: 2, DF: 7, MF: 7, FW: 4 } as Record<Group, number>,
  upgradeMin: 2,
  needBonus: 10,
  maxAge: 30,
  capUseRate: 0.97,
  baseBids: { MID: 2, REGULAR: 3 },
  bidAggrSpread: 0.25,
  faSalary: [0.95, 0.1] as const,
  faBonusRate: 0.3,
  scoreFloor: 100_000,
  sell: { keepSize: 23, overPrice: 0.8, capPrice: 0.7, agedAge: 31, agedPrice: 0.8, weakPrice: 0.7, bandPrice: 0.8 },
} as const;

type Group = 'GK' | 'DF' | 'MF' | 'FW';
const GROUP: Record<Position, Group> = { GK: 'GK', CB: 'DF', FB: 'DF', DM: 'MF', CM: 'MF', AM: 'MF', W: 'FW', ST: 'FW' };

const byOvrDesc = (a: Player, b: Player) => b.ovr - a.ovr || (a.id < b.id ? -1 : 1);
/** 다음 시즌에도 남는 선수: 정규 창(정산 = 다음 시즌 Day 2)은 잔여 1시즌(재계약 안 된 만료자)을 뺀다 */
const staying = (w: TransferWindow, ps: readonly Player[]) => ps.filter((p) => !p.isTemporary && !(w.kind === 'REGULAR' && p.contract.seasonsLeft <= 1));
const starterIds = (ps: readonly Player[]) => new Set(ps.filter((p) => !p.isTemporary).sort(byOvrDesc).slice(0, 11).map((p) => p.id));

/** 7.1 성향 0.5~1.0, 커리어 고정 (자동 운영 사용자 구단은 0.75 고정을 호출자가 넘긴다) */
export function aiAggr(gameSeed: number, clubId: ClubId): number {
  return 0.5 + 0.5 * h(gameSeed >>> 0, clubId, 'aggr');
}

/**
 * 7.2 이적료 예산 F. B = value.budgetB (정규 창은 오프시즌 B_off). cap = 정산 시즌 티어 캡.
 * relegatedBudget = 강등 시즌이면 새 배정금 (F ≤ 25%).
 */
export function aiTransferBudget(kind: TransferWindow['kind'], aggr: number, x: { B: Kc; transferOnly: Kc; cap: Kc; relegatedBudget?: Kc }): Kc {
  const reserve = AI_TRANSFER.reserveCapRate * x.cap;
  let f = kind === 'REGULAR'
    ? x.transferOnly + aggr * Math.max(0, x.B - x.transferOnly - reserve)
    : aggr * AI_TRANSFER.midBudgetRate * Math.max(0, x.B - reserve);
  if (x.relegatedBudget !== undefined) f = Math.min(f, AI_TRANSFER.relegatedBudgetRate * x.relegatedBudget);
  return Math.max(0, round1k(f));
}

/**
 * 7.4 + U4 창 열림 시 AI 이적 명단. 우선순위(먼저 걸린 규칙의 가격):
 * 약체(age ≥ 21, ovr < ref − 14) 0.7V → 대역 상한(str > ref + 1, ≤ 30세, ovr ≥ ref + 4, 최대 2) 0.8V →
 * 인원 > 23 비주전 OVR 낮은 순 0.8V → 캡 초과 비주전 연봉 높은 순 0.7V → 31세 이상 비주전 잔여 ≥ 2 0.8V.
 * GK 는 2명 아래로 내놓지 않는다. 정규 창은 잔여 1시즌 선수 제외(clubListing 규칙).
 */
export function aiSellListings(args: { window: TransferWindow; tier: Tier; players: readonly Player[]; capLimit: Kc }): TransferListing[] {
  const A = LIFECYCLE.ai;
  const S = AI_TRANSFER.sell;
  const ref = TIER_REFERENCE_OVR[args.tier];
  const own = staying(args.window, args.players);
  const starters = starterIds(own);
  const picked = new Map<string, number>();
  const gkLeft = () => own.filter((p) => p.primary === 'GK' && !picked.has(p.id)).length;
  const take = (p: Player, rate: number) => {
    if (picked.has(p.id) || (p.primary === 'GK' && gkLeft() <= A.minGk)) return false;
    picked.set(p.id, rate);
    return true;
  };

  for (const p of own) if (p.age >= A.weakMinAge && p.ovr < ref - A.weakBelow) take(p, S.weakPrice);

  let rest = own.filter((p) => !picked.has(p.id));
  for (let n = 0; n < A.sellMaxPerSeason && squadStrength(rest) > ref + A.bandHi; n++) {
    const x = rest.filter((p) => p.age <= A.sellMaxAge && p.ovr >= ref + A.sellOver && !picked.has(p.id)).sort(byOvrDesc).find((p) => take(p, S.bandPrice));
    if (!x) break;
    rest = rest.filter((p) => p !== x);
  }

  const bench = own.filter((p) => !starters.has(p.id));
  for (const p of [...bench].sort((a, b) => a.ovr - b.ovr || (a.id < b.id ? -1 : 1))) {
    if (own.length - picked.size <= S.keepSize) break;
    take(p, S.overPrice);
  }
  for (const p of [...bench].sort((a, b) => b.contract.salary - a.contract.salary || (a.id < b.id ? -1 : 1))) {
    if (capUse(own.filter((x) => !picked.has(x.id))) <= args.capLimit) break;
    take(p, S.capPrice);
  }
  for (const p of bench) if (p.age >= S.agedAge && p.contract.seasonsLeft >= 2) take(p, S.agedPrice);

  return own
    .filter((p) => picked.has(p.id))
    .map((p) => clubListing(args.window, p, Math.max(round1k(TRANSFER.clubMinMult * playerValue(p)), round1k(picked.get(p.id)! * playerValue(p)))));
}

/**
 * 7.3 AI 입찰. players = 이 구단 소속, listingPlayers = 매물 선수(NPC 포함). 반환 입찰은 validateBid 를 통과한다.
 * 그룹당 입찰 수 = max(1, 최소 인원 부족분). 모두 낙찰된다고 가정하고 예산·캡·25명·영입 한도를 지킨다.
 */
export function aiBids(args: {
  gameSeed: number;
  window: TransferWindow;
  club: MarketClub;
  aggr: number;
  /** aiTransferBudget */
  F: Kc;
  players: readonly Player[];
  listings: readonly TransferListing[];
  listingPlayers: Readonly<Record<string, Player>>;
  placedDay: number;
}): Bid[] {
  const { window: w, club, aggr } = args;
  if (club.balance < 0) return [];
  const A = LIFECYCLE.ai;
  const ref = TIER_REFERENCE_OVR[club.tier];
  const own = staying(w, args.players);
  const ids = starterIds(own);
  const starters = own.filter((p) => ids.has(p.id));
  const count = (g: Group) => own.filter((p) => GROUP[p.primary] === g).length;
  const deficit = (g: Group) => Math.max(0, AI_TRANSFER.groupMin[g] - count(g));
  const weakest = (g: Group) => {
    const xs = (starters.some((p) => GROUP[p.primary] === g) ? starters : own).filter((p) => GROUP[p.primary] === g);
    return xs.length ? Math.min(...xs.map((p) => p.ovr)) : 0;
  };
  const capMax = club.capLimit * AI_TRANSFER.capUseRate;

  type Cand = { bid: Bid; g: Group; res: Kc; cap: Kc; score: number };
  const cands: Cand[] = [];
  for (const l of args.listings) {
    const p = args.listingPlayers[l.playerId];
    if (!p || l.sellerClubId === club.id || p.age > AI_TRANSFER.maxAge) continue;
    const g = GROUP[p.primary];
    const need = deficit(g) > 0;
    const gain = p.ovr - weakest(g);
    if (!need && (gain < AI_TRANSFER.upgradeMin || squadStrength([...own, p]) > ref + A.bandHi)) continue;
    const u = h(args.gameSeed >>> 0, w.season, w.kind, club.id, l.id);
    const s = baseSalary(p.ovr);
    let bid: Bid;
    let cap: Kc;
    if (l.kind === 'FA') {
      const salary = Math.max(l.salaryFloor ?? 0, round1k(s * (AI_TRANSFER.faSalary[0] + AI_TRANSFER.faSalary[1] * u)));
      const bonus = Math.min(l.bonusMax ?? 0, round1k(s * AI_TRANSFER.faBonusRate * aggr * u));
      const seasons = Math.min(TRANSFER.newContractMaxSeasons, l.seasonsRange?.[1] ?? maxContractSeasons(p.age));
      bid = { listingId: l.id, clubId: club.id, placedDay: args.placedDay, bonus, salary, seasons };
      cap = capChargeOf(p.ovr, { salary, bonusPerSeason: Math.round(bonus / seasons) });
    } else {
      const fee = Math.min(l.maxPrice, Math.max(l.minPrice, round1k(l.value * (1 + AI_TRANSFER.bidAggrSpread * aggr * u))));
      bid = { listingId: l.id, clubId: club.id, placedDay: args.placedDay, fee };
      cap = l.kind === 'NPC' ? capChargeOf(p.ovr, { salary: s }) : capChargeOf(p.ovr, p.contract);
    }
    const res = reservationOf(w, l, bid);
    cands.push({ bid, g, res, cap, score: (gain + (need ? AI_TRANSFER.needBonus : 0)) / Math.max(res, AI_TRANSFER.scoreFloor) });
  }
  cands.sort((a, b) => b.score - a.score || (a.bid.listingId < b.bid.listingId ? -1 : 1));

  const maxBids = AI_TRANSFER.baseBids[w.kind] + Math.round(2 * aggr);
  const budget = Math.min(args.F, club.budget);
  const perGroup = new Map<Group, number>();
  let reserved = 0;
  let capNow = capUse(own);
  const out: Bid[] = [];
  for (const c of cands) {
    if (out.length >= maxBids || own.length + out.length >= TRANSFER.maxSquad || club.signings + out.length >= club.signingLimit) break;
    if ((perGroup.get(c.g) ?? 0) >= Math.max(1, deficit(c.g))) continue;
    if (reserved + c.res > budget || capNow + c.cap > capMax) continue;
    reserved += c.res;
    capNow += c.cap;
    perGroup.set(c.g, (perGroup.get(c.g) ?? 0) + 1);
    out.push(c.bid);
  }
  return out;
}
