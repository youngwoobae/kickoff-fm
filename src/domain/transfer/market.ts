/**
 * 이적시장 (M4.3, 경제 6장): 매물 생성(NPC·FA·CLUB), 입찰 검증·예약, 창 정산(6.4·D17), 잔액 부족(D18).
 * 순수 함수. 입력을 바꾸지 않는다. 무작위 = 해시 시드 mulberry32 (Math.random 금지).
 */
import type {
  Bid,
  BidInput,
  ClubId,
  Contract,
  Day,
  Kc,
  Player,
  PlayerId,
  Position,
  Tier,
  TransferLedgerKind,
  TransferListing,
  TransferWindow,
} from '../../types';
import { hashString, mulberry32, pickWeighted, type Rng } from '../../engine';
import { DomainError } from '../errors';
import { baseSalary, SEASON_DAYS } from '../economy/economy';
import { TIER_REFERENCE_OVR, generatePlayer } from '../squad/generator';
import { LIFECYCLE, scoutRangeOf } from '../squad/lifecycle';
import { CONTRACT, capCharge, capUsage, maxContractSeasons, salaryFloor } from '../contract/contract';
import { TRANSFER, daysAfterSettle, fmtM, playerValue, round1k } from './value';

/** 정산·입찰에 필요한 구단 재정 요약 (M4.4 가 GameState 에서 만든다) */
export interface MarketClub {
  id: ClubId;
  tier: Tier;
  balance: Kc;
  /** 이적창 한정 예산 (정규 창 이적료·FA 계약금에만) */
  transferOnly: Kc;
  /** 지출 가능액 B (value.budgetB, 예약 차감 전) */
  budget: Kc;
  /** cap × (강등 시즌 1.10) */
  capLimit: Kc;
  /** 정산 시즌의 영입 수 (긴급 FA 제외) */
  signings: number;
  /** 8, 승격 시즌 12 */
  signingLimit: number;
}

/** 원장 후보. LedgerKind 에 합쳐지기 전(M4.6)이라 별도 형태. 부호: 수입 +, 지출 − */
export interface TransferMoney {
  clubId: ClubId;
  kind: TransferLedgerKind;
  amount: Kc;
  playerId: PlayerId;
  /** 지출 중 이적창 한정 예산에서 나간 몫 (나머지는 balance) */
  fromTransferOnly?: Kc;
}

export interface TransferDeal {
  listingId: string;
  kind: TransferListing['kind'];
  playerId: PlayerId;
  fromClubId: ClubId | null;
  toClubId: ClubId;
  /** NPC·CLUB 이적료, FA 계약금 */
  amount: Kc;
  /** CLUB 이적세 (판매 구단 부담) */
  tax: Kc;
  contract: Contract;
}

// ── 매물 ──

const POSITIONS = Object.keys(LIFECYCLE.squadTemplate) as Position[];
const kindTag = (w: TransferWindow) => `${w.season}${w.kind === 'MID' ? 'M' : 'R'}`;

export function listingId(w: TransferWindow, kind: TransferListing['kind'], playerId: PlayerId): string {
  return `${kind}-${kindTag(w)}-${playerId}`;
}

function windowRng(gameSeed: number, w: TransferWindow, tag: string): Rng {
  return mulberry32(hashString(`${gameSeed >>> 0}|transfer|${w.season}|${w.kind}|${tag}`));
}

/**
 * NPC 신규 매물 (6.2): 티어당 정규 6 / 중간 2. OVR = REF + 삼각분포 정수 −4~+4, 나이 19~30, 포지션 = 기준 스쿼드 비율.
 * 선수는 clubId null 로 만들지만 FA 풀이 아니다 — M4.4 는 창 동안 별도 보관하고 미판매분을 지운다.
 */
export function generateNpcListings(gameSeed: number, w: TransferWindow): { players: Player[]; listings: TransferListing[] } {
  const players: Player[] = [];
  const listings: TransferListing[] = [];
  const n = TRANSFER.window[w.kind].npcPerTier;
  const half = TRANSFER.npcOvrHalf / 2;
  for (const tier of Object.keys(TIER_REFERENCE_OVR) as Tier[]) {
    for (let i = 0; i < n; i++) {
      const rng = windowRng(gameSeed, w, `npc-${tier}-${i}`);
      const tri = Math.floor(rng() * (2 * half + 1)) - half + (Math.floor(rng() * (2 * half + 1)) - half);
      const age = TRANSFER.npcAge[0] + Math.floor(rng() * (TRANSFER.npcAge[1] - TRANSFER.npcAge[0] + 1));
      const pos = POSITIONS[pickWeighted(rng, POSITIONS.map((p) => LIFECYCLE.squadTemplate[p]))]!;
      const base = generatePlayer(rng, pos, TIER_REFERENCE_OVR[tier] + tri, age);
      const p: Player = {
        ...base,
        id: `n${kindTag(w)}-${tier}-${i}`,
        clubId: null,
        scoutRange: scoutRangeOf(base),
        contract: { seasonsLeft: 0, salary: 0 },
        dev: { bank: 0, minutesMark: 0 },
      };
      const value = playerValue(p, true);
      players.push(p);
      listings.push({ id: listingId(w, 'NPC', p.id), kind: 'NPC', playerId: p.id, sellerClubId: null, value, minPrice: value, maxPrice: round1k(TRANSFER.maxMult * value) });
    }
  }
  return { players, listings };
}

/** FA 매물 (6.2): 이적료 0, 계약금 0~1.0S, 연봉 ≥ 하한, 기간 1~허용 최대 */
export function faListing(w: TransferWindow, p: Player): TransferListing {
  const s = baseSalary(p.ovr);
  return {
    id: listingId(w, 'FA', p.id),
    kind: 'FA',
    playerId: p.id,
    sellerClubId: null,
    value: playerValue(p, true),
    minPrice: 0,
    maxPrice: 0,
    bonusMax: round1k(TRANSFER.faBonusMaxRate * s),
    salaryFloor: salaryFloor(p.ovr),
    seasonsRange: [1, maxContractSeasons(p.age)],
  };
}

/** 구단 이적 명단 (6.2): 최저가 0.7V~1.3V. 정규 창은 잔여 1시즌 선수 불가(정산 전에 FA 가 된다) */
export function clubListing(w: TransferWindow, p: Player, minPrice: Kc): TransferListing {
  if (!p.clubId) throw new DomainError('NOT_FOUND', '소속 구단이 있는 선수만 올릴 수 있어요', ['NO_CLUB']);
  if (w.kind === 'REGULAR' && p.contract.seasonsLeft <= 1) throw new DomainError('BID_OUT_OF_RANGE', '계약이 이번 시즌에 끝나는 선수는 정규 창에 올릴 수 없어요', ['EXPIRING']);
  const value = playerValue(p);
  const maxPrice = round1k(TRANSFER.maxMult * value);
  const lo = round1k(TRANSFER.clubMinMult * value);
  if (!Number.isInteger(minPrice) || minPrice < lo || minPrice > maxPrice) {
    throw new DomainError('BID_OUT_OF_RANGE', `최저가는 ${fmtM(lo)}~${fmtM(maxPrice)} 사이로 정해 주세요`, ['MIN_PRICE']);
  }
  return { id: listingId(w, 'CLUB', p.id), kind: 'CLUB', playerId: p.id, sellerClubId: p.clubId, value, minPrice, maxPrice };
}

// ── 입찰 (6.3) ──

/** 예약액: 이적료 / FA = 계약금 + 연봉 × 남은 일수/28 */
export function reservationOf(w: TransferWindow, l: TransferListing, b: Pick<Bid, 'fee' | 'bonus' | 'salary'>): Kc {
  if (l.kind !== 'FA') return b.fee ?? 0;
  return (b.bonus ?? 0) + Math.round(((b.salary ?? 0) * daysAfterSettle(w)) / SEASON_DAYS);
}

/** 비교값: 이적료 / FA = 계약금 + 연봉 × 시즌 × 0.5 */
export function compareValue(l: TransferListing, b: Pick<Bid, 'fee' | 'bonus' | 'salary' | 'seasons'>): Kc {
  if (l.kind !== 'FA') return b.fee ?? 0;
  return (b.bonus ?? 0) + (b.salary ?? 0) * (b.seasons ?? 0) * TRANSFER.faCompareSalaryRate;
}

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);

/**
 * 입찰 검증 → Bid. 창 열림 여부(WINDOW_CLOSED)·권한은 호출자.
 * clubBids = 이 구단의 현재 입찰(같은 매물 기존 입찰은 수정으로 보고 예약에서 뺀다).
 */
export function validateBid(args: {
  window: TransferWindow;
  listing: TransferListing;
  input: BidInput;
  club: MarketClub;
  clubBids: readonly Bid[];
  listings: Readonly<Record<string, TransferListing>>;
  placedDay: Day;
  /** 매물 선수의 지금 소속. 만료 예정 FA 매물(Day 28)이 우리 선수면 입찰 금지 (M4.8) */
  playerClubId?: ClubId | null;
  /** 이 구단 선수단(임시 포함). 주면 중간 창은 정산과 같은 캡·25명 기준을 입찰 때 미리 본다 (M4.8) */
  squad?: readonly Player[];
  /** 매물 선수 (캡 산입 계산용, squad 와 함께) */
  player?: Player;
  /** 이 구단이 이번 시즌 방출한 선수(GameState.releasedThisSeason). FA 매물이면 입찰 금지 (M6: 방출 → 싼 연봉 재영입 우회) */
  releasedIds?: ReadonlySet<PlayerId>;
}): Bid {
  const { window: w, listing: l, input, club } = args;
  if (l.sellerClubId === club.id) throw new DomainError('BID_OUT_OF_RANGE', '우리 구단 매물에는 입찰할 수 없어요', ['OWN_LISTING']);
  if (l.kind === 'FA' && args.releasedIds?.has(l.playerId)) throw new DomainError('BID_OUT_OF_RANGE', '이번 시즌에 우리가 방출한 선수는 FA 로 다시 데려올 수 없어요', ['RELEASED']);
  if (args.playerClubId === club.id) throw new DomainError('BID_OUT_OF_RANGE', '우리 구단 선수예요. 계약이 끝나기 전에 재계약(Day 20~27)으로 붙잡아 주세요', ['OWN_PLAYER']);
  if (club.balance < 0) throw new DomainError('NEGATIVE_BALANCE_LOCK', '잔액이 0 아래인 동안에는 입찰할 수 없어요');
  let bid: Bid;
  if (l.kind === 'FA') {
    const { bonus, salary, seasons } = input;
    const [lo, hi] = l.seasonsRange ?? [1, 1];
    if (!isInt(bonus) || !isInt(salary) || !isInt(seasons) || bonus < 0 || bonus > (l.bonusMax ?? 0) || salary < (l.salaryFloor ?? 0) || seasons < lo || seasons > hi) {
      throw new DomainError(
        'BID_OUT_OF_RANGE',
        `FA 조건을 확인해 주세요: 계약금 0~${fmtM(l.bonusMax ?? 0)}, 연봉 ${fmtM(l.salaryFloor ?? 0)} 이상, 기간 ${lo === hi ? `${lo}시즌` : `${lo}~${hi}시즌`}`,
        ['FA_TERMS'],
      );
    }
    bid = { listingId: l.id, clubId: club.id, placedDay: args.placedDay, bonus, salary, seasons };
  } else {
    const fee = input.fee;
    if (!isInt(fee) || fee < l.minPrice || fee > l.maxPrice) throw new DomainError('BID_OUT_OF_RANGE', `입찰가는 ${fmtM(l.minPrice)}~${fmtM(l.maxPrice)} 사이여야 해요`, ['FEE']);
    bid = { listingId: l.id, clubId: club.id, placedDay: args.placedDay, fee };
  }
  const reservedOther = args.clubBids
    .filter((b) => b.clubId === club.id && b.listingId !== l.id)
    .reduce((s, b) => s + (args.listings[b.listingId] ? reservationOf(w, args.listings[b.listingId]!, b) : 0), 0);
  const room = club.budget - reservedOther;
  if (reservationOf(w, l, bid) > room) throw new DomainError('INSUFFICIENT_FUNDS', `지출 가능액이 모자라요. 이 입찰에 쓸 수 있는 돈은 ${fmtM(Math.max(0, room))}까지예요`);
  if (club.signings >= club.signingLimit) throw new DomainError('BID_OUT_OF_RANGE', `이번 시즌 영입 한도 ${club.signingLimit}명을 다 썼어요`, ['SIGNING_LIMIT']);
  // 정규 창은 경계(만료·은퇴)를 지나 정산하므로 선수단 기준은 정산 때만 본다
  if (w.kind === 'MID' && args.squad && args.player) {
    if (args.squad.filter((x) => !x.isTemporary).length + 1 > TRANSFER.maxSquad) throw new DomainError('BID_OUT_OF_RANGE', `선수단이 ${TRANSFER.maxSquad}명이라 더 영입할 수 없어요`, ['SQUAD_FULL']);
    const after = capUsage(args.squad) + capCharge({ ovr: args.player.ovr, contract: newContract(l, args.player, bid) });
    if (after > club.capLimit) throw new DomainError('CAP_EXCEEDED', `영입하면 연봉 캡을 넘어요 (${fmtM(after)} / ${fmtM(club.capLimit)})`);
  }
  return bid;
}

/** 구단 예약액 합계 (Finance.reserved) */
export function reservedTotal(w: TransferWindow, clubId: ClubId, bids: readonly Bid[], listings: Readonly<Record<string, TransferListing>>): Kc {
  return bids.filter((b) => b.clubId === clubId && listings[b.listingId]).reduce((s, b) => s + reservationOf(w, listings[b.listingId]!, b), 0);
}

/** 입찰 추가·수정 (매물당 구단당 1건) */
export function upsertBid(bids: readonly Bid[], bid: Bid): Bid[] {
  return [...bids.filter((b) => !(b.listingId === bid.listingId && b.clubId === bid.clubId)), bid];
}

// ── 정산 (6.4) ──

export interface SettleInput {
  gameSeed: number;
  window: TransferWindow;
  listings: readonly TransferListing[];
  bids: readonly Bid[];
  /** 입찰 구단과 판매 구단 모두 */
  clubs: readonly MarketClub[];
  /** 모든 구단 소속 선수 + 매물 선수(NPC·FA) */
  players: Readonly<Record<PlayerId, Player>>;
}

export interface SettleResult {
  deals: TransferDeal[];
  money: TransferMoney[];
  /** 바뀐 선수만 (이동 후). NPC 낙찰 선수는 여기서 처음 세계에 들어온다 */
  players: Record<PlayerId, Player>;
  /** 정산 뒤 구단 재정 요약 (balance·transferOnly·signings 갱신) */
  clubs: MarketClub[];
  /** 낙찰 없는 매물. NPC 는 지우고, FA 는 풀에 남고, CLUB 은 구단에 남는다 */
  unsold: string[];
  /** 최고 순위였지만 정산 조건을 못 맞춘 입찰과 그 사유 (편지용, M4.8) */
  failures: { listingId: string; clubId: ClubId; reason: string }[];
}

function newContract(l: TransferListing, p: Player, b: Bid): Contract {
  if (l.kind === 'CLUB') return p.contract;
  if (l.kind === 'NPC') return { seasonsLeft: Math.min(TRANSFER.newContractMaxSeasons, maxContractSeasons(p.age)), salary: baseSalary(p.ovr) };
  const seasons = b.seasons!;
  return { seasonsLeft: seasons, salary: b.salary!, bonusPerSeason: Math.round(b.bonus! / seasons) };
}

/**
 * 창 정산. 매물 = 최고가 내림차순·ID 오름차순, 입찰 = 비교값 내림차순.
 * 1,000 KC 단위 동률이면 최상위 티어보다 낮은 티어 구단 가중 2배로 추첨(D17, 시드 = hash(gameSeed, season, kind, listingId)).
 * 낙찰자가 정산 시점 조건(자금·캡·25명·영입 한도·선수 소속)을 못 맞추면 다음 순위로.
 */
export function settleWindow(input: SettleInput): SettleResult {
  const w = input.window;
  const clubs = new Map(input.clubs.map((c) => [c.id, { ...c }]));
  const committed = new Map<ClubId, Kc>();
  const players: Record<PlayerId, Player> = {};
  const cur = (id: PlayerId) => players[id] ?? input.players[id];
  const squads = new Map<ClubId, Player[]>();
  for (const p of Object.values(input.players)) if (p.clubId) (squads.get(p.clubId) ?? squads.set(p.clubId, []).get(p.clubId)!).push(p);
  const squad = (id: ClubId) => squads.get(id) ?? [];
  const deals: TransferDeal[] = [];
  const money: TransferMoney[] = [];
  const unsold: string[] = [];
  const failures: SettleResult['failures'] = [];

  const listings = [...input.listings].sort((a, b) => b.maxPrice - a.maxPrice || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const l of listings) {
    const p0 = cur(l.playerId);
    const key = (b: Bid) => Math.round(compareValue(l, b) / TRANSFER.tieUnit);
    let bids = input.bids.filter((b) => b.listingId === l.id && clubs.has(b.clubId)).sort((a, b) => key(b) - key(a) || (a.clubId < b.clubId ? -1 : 1));
    const rng = windowRng(input.gameSeed, w, `settle-${l.id}`);
    let sold = false;
    while (bids.length && p0) {
      const top = bids.filter((b) => key(b) === key(bids[0]!));
      const tierNo = (b: Bid) => Number(clubs.get(b.clubId)!.tier.slice(1));
      const hi = Math.min(...top.map(tierNo));
      const win = top[top.length === 1 ? 0 : pickWeighted(rng, top.map((b) => (tierNo(b) > hi ? TRANSFER.lowerTierWeight : 1)))]!;
      const c = clubs.get(win.clubId)!;
      const contract = newContract(l, p0, win);
      const res = reservationOf(w, l, win);
      const room = c.budget - (committed.get(c.id) ?? 0);
      const capAfter = capUsage(squad(c.id)) + capCharge({ ovr: p0.ovr, contract });
      const reason =
        p0.clubId !== l.sellerClubId ? '선수가 이미 다른 거래로 이동했어요'
        : c.id === l.sellerClubId ? '우리 구단 매물이에요'
        : c.balance < 0 ? '잔액이 0 아래예요'
        : room < res ? `정산 때 지출 가능액 ${fmtM(Math.max(0, room))}가 필요한 ${fmtM(res)}보다 모자랐어요`
        : capAfter > c.capLimit ? `영입하면 연봉 캡을 넘어요 (${fmtM(capAfter)} / ${fmtM(c.capLimit)})`
        : squad(c.id).filter((x) => !x.isTemporary).length + 1 > TRANSFER.maxSquad ? `선수단이 ${TRANSFER.maxSquad}명이에요`
        : c.signings >= c.signingLimit ? `시즌 영입 한도 ${c.signingLimit}명을 다 썼어요`
        : null;
      if (reason) {
        failures.push({ listingId: l.id, clubId: c.id, reason });
        bids = bids.filter((b) => b !== win);
        continue;
      }
      // 지불: 정규 창은 한정 예산 먼저
      const amount = l.kind === 'FA' ? win.bonus! : win.fee!;
      const fromTO = w.kind === 'REGULAR' ? Math.min(c.transferOnly, amount) : 0;
      c.transferOnly -= fromTO;
      c.balance -= amount - fromTO;
      c.signings += 1;
      committed.set(c.id, (committed.get(c.id) ?? 0) + res);
      if (amount > 0) money.push({ clubId: c.id, kind: l.kind === 'FA' ? 'SIGNING_BONUS' : 'TRANSFER_FEE_PAID', amount: -amount, playerId: p0.id, fromTransferOnly: fromTO });
      let tax = 0;
      if (l.kind === 'CLUB') {
        tax = Math.round(amount * TRANSFER.taxRate);
        const seller = clubs.get(l.sellerClubId!);
        if (seller) seller.balance += amount - tax;
        money.push({ clubId: l.sellerClubId!, kind: 'TRANSFER_FEE_RECEIVED', amount, playerId: p0.id });
        if (tax > 0) money.push({ clubId: l.sellerClubId!, kind: 'TRANSFER_TAX', amount: -tax, playerId: p0.id });
        squads.set(l.sellerClubId!, squad(l.sellerClubId!).filter((x) => x.id !== p0.id));
      }
      const moved: Player = { ...p0, clubId: c.id, faSince: undefined, retiring: false, contract };
      players[p0.id] = moved;
      squads.set(c.id, [...squad(c.id), moved]);
      deals.push({ listingId: l.id, kind: l.kind, playerId: p0.id, fromClubId: l.sellerClubId, toClubId: c.id, amount, tax, contract });
      sold = true;
      break;
    }
    if (!sold) unsold.push(l.id);
  }
  return { deals, money, players, clubs: input.clubs.map((c) => clubs.get(c.id)!), unsold, failures };
}

// ── 잔액 부족 (D18, 6.5) ──

export interface NegativeBalanceStatus {
  negativeSinceDay?: Day;
  /** 입찰·FA·재계약 인상 금지 */
  locked: boolean;
  /** 이번 처리에서 강제 매각 실행 */
  forceSale: boolean;
}

/**
 * 일일 처리 뒤 호출(매일). since = Finance.negativeSinceDay (시즌 경계를 넘으면 28일 순환으로 센다).
 * 강제 매각 단계에 들어가면 돌려주는 negativeSinceDay 를 "오늘 − 2일"로 당긴다(m1): 저장값이 Day 하나뿐이라
 * 음수가 28일 넘게 이어지면 경과일이 0 으로 돌아가 이틀씩 매각이 멈추던 문제를 막는다. 호출자는 매일 이 값을 저장한다.
 */
export function negativeBalanceStatus(balance: Kc, since: Day | undefined, day: Day): NegativeBalanceStatus {
  if (balance >= 0) return { locked: false, forceSale: false };
  const start = since ?? day;
  const after = TRANSFER.forcedSaleAfterDays;
  const forceSale = (day - start + SEASON_DAYS) % SEASON_DAYS >= after;
  return { negativeSinceDay: forceSale ? ((day - after - 1 + SEASON_DAYS) % SEASON_DAYS) + 1 : start, locked: true, forceSale };
}

/**
 * 시스템 강제 매각 0.5V: 연봉 높은 비주전부터 잔액 ≥ 0 이 될 때까지. 매각 선수는 세계에서 사라진다(해외, 풀 세탁 방지).
 * benchIds = "최근 5경기 선발 ≤ 2" 선수 (호출자가 경기 기록으로 계산). 없으면 OVR 상위 11명 밖 선수.
 * 하한(C1·M5, 경제 5.4): 등록(임시 제외) 18명 아래로는 팔지 않고, 출전 가능 선수는 16명 아래로 내리지 않는다.
 * exclude = 팔 수 없는 선수(이번 시즌 긴급 FA 로 공짜 영입한 선수 — 무상 영입 → 0.5V 매각 순환 차단).
 */
export function forcedSales(args: {
  clubId: ClubId;
  balance: Kc;
  players: readonly Player[];
  benchIds?: ReadonlySet<PlayerId>;
  exclude?: ReadonlySet<PlayerId>;
}): { sold: PlayerId[]; money: TransferMoney[]; balance: Kc } {
  const E = CONTRACT.emergency;
  const own = args.players.filter((p) => p.clubId === args.clubId && !p.isTemporary);
  const starters = new Set([...own].sort((a, b) => b.ovr - a.ovr || (a.id < b.id ? -1 : 1)).slice(0, 11).map((p) => p.id));
  const bench = own
    .filter((p) => (args.benchIds ? args.benchIds.has(p.id) : !starters.has(p.id)) && !args.exclude?.has(p.id))
    .sort((a, b) => b.contract.salary - a.contract.salary || (a.id < b.id ? -1 : 1));
  const canPlay = (p: Player) => p.availability.injuryDays === 0 && p.availability.suspendedMatches === 0;
  let registered = own.length;
  let available = own.filter(canPlay).length;
  let balance = args.balance;
  const sold: PlayerId[] = [];
  const money: TransferMoney[] = [];
  for (const p of bench) {
    if (balance >= 0 || registered <= E.minRegistered) break;
    if (canPlay(p) && available <= E.minAvailable) continue;
    const amount = round1k(TRANSFER.forcedSaleRate * playerValue(p));
    balance += amount;
    registered--;
    if (canPlay(p)) available--;
    sold.push(p.id);
    money.push({ clubId: args.clubId, kind: 'FORCED_SALE', amount, playerId: p.id });
  }
  return { sold, money, balance };
}
