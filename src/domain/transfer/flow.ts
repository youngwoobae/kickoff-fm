/**
 * 이적·계약·편지함을 게임 상태에 연결 (M4.4). advanceDay(하루 처리)·시즌 경계·서비스가 호출한다.
 * 순수 도메인(market·ai·value, contract, inbox) 위의 얇은 접착층. 상태 변경 규칙: 인자로 받은 state 의
 * 컨테이너(players·clubs·finances)는 호출자가 이미 복사한 것이고, 그 안의 값과 transferMarket·inbox·pendingRenewals·signingsThisSeason
 * 은 항상 새 값으로 교체한다(제자리 수정 금지, 6.3).
 */
import type { ClubId, GameState, Kc, LedgerEntry, PendingRenewal, Player, PlayerId, Tier, TransferListing, TransferMarketState, WindowKind } from '../../types';
import { TIER_ECONOMY, SEASON_DAYS, promotionBonus } from '../economy/economy';
import { clubTierMap } from '../league/pyramid';
import { TIER_REFERENCE_OVR } from '../squad/generator';
import { CONTRACT, aiRenewals, capLimit, contractBoundary, emergencyFaSign, releaseQuote, type ContractEvent } from '../contract/contract';
import { appendInbox, contractDraft, lifecycleDraft, type InboxContext, type InboxDraft, type InboxLifecycleEvent } from '../inbox/inbox';
import { clubPlayers, post } from '../day/advanceDay';
import { aiAggr, aiBids, aiSellListings, aiTransferBudget } from './ai';
import { faListing, forcedSales, generateNpcListings, negativeBalanceStatus, settleWindow, upsertBid, type MarketClub, type TransferMoney } from './market';
import { TRANSFER, budgetB, fmtM, isSettleDay, windowOf } from './value';

// ── 편지함 ──

export function inboxContext(state: GameState): InboxContext {
  return { userClubId: state.userClubId, nameOf: (id) => state.players[id]?.name ?? state.transferMarket?.npcPlayers[id]?.name };
}

/** 오늘 날짜로 편지 붙이기 (null 은 건너뜀) */
export function mail(state: GameState, drafts: readonly (InboxDraft | null)[]): void {
  if (!drafts.some(Boolean)) return;
  state.inbox = appendInbox(state.inbox ?? [], drafts, state.time.season, state.time.day);
}

export function mailLifecycle(state: GameState, events: readonly InboxLifecycleEvent[]): void {
  const ctx = inboxContext(state);
  mail(state, events.map((e) => lifecycleDraft(e, ctx)));
}

export function mailContract(state: GameState, events: readonly ContractEvent[]): void {
  const ctx = inboxContext(state);
  mail(state, events.map((e) => contractDraft(e, ctx)));
}

// ── 구단 시장 요약 ──

const isHuman = (state: GameState, id: ClubId) => state.clubs[id]?.isHuman === true;
const sortedIds = (state: GameState) => Object.keys(state.clubs).sort();

/** 정규 창의 시즌 경계 전(Day 25~28)이면 true: 판단 기준은 다음 시즌(티어·캡·영입 한도) */
function preBoundary(state: GameState): boolean {
  const w = state.transferMarket?.window;
  return !!w && w.settleSeason > state.time.season;
}

interface Outlook {
  tier: Tier;
  relegated: boolean;
  promoted: boolean;
}

/** 시장 판단 시즌의 티어·승강 여부. 경계 전이면 Day 26 판정(pendingOutcome)의 이동, 아니면 직전 경계의 이동 */
function outlooks(state: GameState): Map<ClubId, Outlook> {
  const tiers = clubTierMap(state);
  const pre = preBoundary(state);
  const last = state.seasonHistory[state.seasonHistory.length - 1];
  const moves = pre ? state.pendingOutcome?.movements : last?.season === state.time.season - 1 ? last.movements : undefined;
  const byClub = new Map((moves ?? []).map((m) => [m.clubId, m]));
  return new Map(
    sortedIds(state).map((id) => {
      const m = byClub.get(id);
      const cur = tiers.get(id) ?? state.settings.tier;
      return [id, { tier: pre && m ? m.to : cur, relegated: m?.kind === 'RELEGATED', promoted: m?.kind === 'PROMOTED' }];
    }),
  );
}

/**
 * 지출 가능액 B (경제 7.2, 예약 차감 전). 시즌 중 = 잔액 + 한정 예산 − 남은 연봉.
 * 정규 창 경계 전(B_off) = 잔액 + 한정 예산 + 다음 배정금(+ 승격 보너스) − 남은 연봉 − 다음 시즌 연봉 부채(잔여 2시즌 이상 + 성립 재계약).
 */
function budgetOf(state: GameState, id: ClubId, o: Outlook, pre: boolean, renewals: ReadonlyMap<PlayerId, PendingRenewal>): Kc {
  const f = state.finances[id]!;
  const squad = clubPlayers(state, id);
  const total = squad.reduce((s, p) => s + p.contract.salary, 0);
  const remaining = Math.round((total * Math.max(0, SEASON_DAYS - state.time.day)) / SEASON_DAYS);
  if (!pre) return budgetB({ balance: f.balance, transferOnly: f.transferOnlyBudget, salaryDebt: remaining });
  const next = squad.reduce((s, p) => s + (p.retiring ? 0 : p.contract.seasonsLeft > 1 ? p.contract.salary : (renewals.get(p.id)?.salary ?? 0)), 0);
  const incoming = TIER_ECONOMY[o.tier].seasonBudget + (o.promoted ? promotionBonus(o.tier) : 0);
  return budgetB({ balance: f.balance, transferOnly: f.transferOnlyBudget, incoming, salaryDebt: remaining + next });
}

export function marketClubs(state: GameState): Map<ClubId, MarketClub & { outlook: Outlook }> {
  const pre = preBoundary(state);
  const renewals = new Map((state.pendingRenewals ?? []).map((r) => [r.playerId, r]));
  const out = new Map<ClubId, MarketClub & { outlook: Outlook }>();
  for (const [id, o] of outlooks(state)) {
    const f = state.finances[id];
    if (!f) continue;
    out.set(id, {
      id,
      tier: o.tier,
      balance: f.balance,
      transferOnly: f.transferOnlyBudget,
      budget: budgetOf(state, id, o, pre, renewals),
      capLimit: capLimit(o.tier, o.relegated),
      signings: pre ? 0 : (state.signingsThisSeason?.[id] ?? 0),
      signingLimit: o.promoted ? TRANSFER.promotedSigningLimit : TRANSFER.signingLimit,
      outlook: o,
    });
  }
  return out;
}

/**
 * AI 판단용 선수단: 정규 창 경계 전이면 성립 재계약을 새 계약으로 본다(잔여 = 시즌 수 + 1, 경계에서 −1).
 * 안 그러면 ai.ts 의 staying(잔여 1시즌 = 떠남)이 재계약자까지 빼서 결원을 부풀린다.
 */
function aiView(state: GameState, clubId: ClubId): Player[] {
  const squad = clubPlayers(state, clubId);
  if (!preBoundary(state) || !state.pendingRenewals?.length) return squad;
  const ren = new Map(state.pendingRenewals.map((r) => [r.playerId, r]));
  return squad.map((p) => {
    const r = ren.get(p.id);
    return r ? { ...p, contract: { seasonsLeft: r.seasons + 1, salary: r.salary, bonusPerSeason: r.bonusPerSeason } } : p;
  });
}

export function listingRecord(m: TransferMarketState): Record<string, TransferListing> {
  return Object.fromEntries(m.listings.map((l) => [l.id, l]));
}

/** 매물 선수 (소속·FA 는 players, NPC 는 시장 보관) */
export function marketPlayer(state: GameState, id: PlayerId): Player | undefined {
  return state.players[id] ?? state.transferMarket?.npcPlayers[id];
}

// ── 창 열림 (D16) ──

export function openWindow(state: GameState, kind: WindowKind): void {
  const w = windowOf(state.time.season, kind);
  const npc = generateNpcListings(state.gameSeed, w);
  const fa = Object.values(state.players)
    .filter((p) => p.clubId === null)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((p) => faListing(w, p));
  state.transferMarket = { window: w, listings: [...npc.listings, ...fa], bids: [], npcPlayers: Object.fromEntries(npc.players.map((p) => [p.id, p])) };
  // 7.4 + U4: AI 이적 명단
  const mcs = marketClubs(state);
  const sells = sortedIds(state)
    .filter((id) => !isHuman(state, id))
    .flatMap((id) => aiSellListings({ window: w, tier: mcs.get(id)!.tier, players: aiView(state, id), capLimit: mcs.get(id)!.capLimit }));
  state.transferMarket = { ...state.transferMarket, listings: [...state.transferMarket.listings, ...sells] };
  const when = kind === 'MID' ? `Day ${w.settleDay}` : `다음 시즌 Day ${w.settleDay}`;
  mail(state, [
    {
      kind: 'WINDOW_OPENED',
      title: kind === 'MID' ? '중간 이적 창 열림' : '정규 이적 창 열림',
      body: `${kind === 'MID' ? '중간' : '정규'} 이적 창이 열렸어요. 매물 ${state.transferMarket.listings.length}건, 정산은 ${when}이에요. 입찰은 비공개로 겨뤄요.`,
    },
  ]);
}

/** 정규 창 Day 28: 재계약 안 된 만료 예정자(재계약 창 Day 27 종료 뒤)를 FA 매물로 등록 (6.2) */
export function registerExpiringFa(state: GameState): void {
  const m = state.transferMarket;
  if (!m || m.window.kind !== 'REGULAR') return;
  const renewed = new Set((state.pendingRenewals ?? []).map((r) => r.playerId));
  const listed = new Set(m.listings.map((l) => l.playerId));
  const add = sortedIds(state)
    .flatMap((id) => clubPlayers(state, id))
    .filter((p) => p.contract.seasonsLeft <= 1 && !p.isTemporary && !p.retiring && !renewed.has(p.id) && !listed.has(p.id))
    .map((p) => faListing(m.window, p));
  if (add.length) state.transferMarket = { ...m, listings: [...m.listings, ...add] };
}

/** 7.3 AI 입찰. clubIds 생략 = 모든 AI 구단. aggr 생략 = 구단 성향(7.1) */
export function placeAiBids(state: GameState, clubIds?: readonly ClubId[], aggr?: number): void {
  const m = state.transferMarket;
  if (!m) return;
  const mcs = marketClubs(state);
  const listingPlayers: Record<PlayerId, Player> = {};
  for (const l of m.listings) {
    const p = marketPlayer(state, l.playerId);
    if (p) listingPlayers[l.playerId] = p;
  }
  let bids = m.bids;
  for (const id of clubIds ?? sortedIds(state).filter((x) => !isHuman(state, x))) {
    const club = mcs.get(id);
    if (!club) continue;
    const a = aggr ?? aiAggr(state.gameSeed, id);
    const o = club.outlook;
    const F = aiTransferBudget(m.window.kind, a, {
      B: club.budget,
      transferOnly: club.transferOnly,
      cap: TIER_ECONOMY[o.tier].salaryCap,
      ...(o.relegated ? { relegatedBudget: TIER_ECONOMY[o.tier].seasonBudget } : {}),
    });
    const mine = aiBids({ gameSeed: state.gameSeed, window: m.window, club, aggr: a, F, players: aiView(state, id), listings: m.listings, listingPlayers, placedDay: state.time.day });
    for (const b of mine) bids = upsertBid(bids, b);
  }
  state.transferMarket = { ...m, bids };
}

// ── 정산 (6.4) ──

/** 선수 id 들의 매물·입찰·재계약을 뺀다 (매각·방출·은퇴·긴급 FA 로 상태가 바뀐 선수) */
export function dropFromMarket(state: GameState, ids: ReadonlySet<PlayerId>): void {
  const m = state.transferMarket;
  if (m) {
    const gone = new Set(m.listings.filter((l) => ids.has(l.playerId)).map((l) => l.id));
    if (gone.size) state.transferMarket = { ...m, listings: m.listings.filter((l) => !gone.has(l.id)), bids: m.bids.filter((b) => !gone.has(b.listingId)) };
  }
  if (state.pendingRenewals?.some((r) => ids.has(r.playerId))) state.pendingRenewals = state.pendingRenewals.filter((r) => !ids.has(r.playerId));
}

/** 이적 돈 → 원장. 정규 창 한정 예산에서 나간 몫은 잔액이 아니라 한정 예산을 줄인다(원장 금액 = 잔액 변화) */
function postMoney(state: GameState, money: readonly TransferMoney[], sink?: LedgerEntry[]): void {
  for (const x of money) {
    const to = x.fromTransferOnly ?? 0;
    const name = marketPlayer(state, x.playerId)?.name ?? x.playerId;
    post(state, x.clubId, { kind: x.kind, amount: x.amount + to, memo: `${name}${to ? ` (이적 한정 예산 ${fmtM(to)} 사용)` : ''}` }, sink);
    if (to) {
      const f = state.finances[x.clubId]!;
      state.finances[x.clubId] = { ...f, transferOnlyBudget: f.transferOnlyBudget - to };
    }
  }
}

function moveToClub(state: GameState, p: Player, from: ClubId | null): void {
  if (from && state.clubs[from]) state.clubs[from] = { ...state.clubs[from]!, playerIds: state.clubs[from]!.playerIds.filter((x) => x !== p.id) };
  const to = p.clubId!;
  state.clubs[to] = { ...state.clubs[to]!, playerIds: [...state.clubs[to]!.playerIds.filter((x) => x !== p.id), p.id] };
  state.players[p.id] = p;
}

export function settleMarket(state: GameState, sink: LedgerEntry[], notices: string[]): void {
  const m = state.transferMarket;
  if (!m) return;
  const mcs = marketClubs(state);
  const r = settleWindow({
    gameSeed: state.gameSeed,
    window: m.window,
    listings: m.listings,
    bids: m.bids,
    clubs: [...mcs.values()],
    players: { ...state.players, ...m.npcPlayers },
  });
  for (const d of r.deals) {
    const prev = marketPlayer(state, d.playerId);
    moveToClub(state, r.players[d.playerId]!, prev?.clubId ?? null);
  }
  postMoney(state, r.money, sink);
  const signings = { ...(state.signingsThisSeason ?? {}) };
  for (const c of r.clubs) if (c.signings > 0) signings[c.id] = c.signings;
  state.signingsThisSeason = signings;

  // 사람 구단 편지
  const user = state.userClubId;
  const nameOf = (id: PlayerId) => marketPlayer(state, id)?.name ?? m.npcPlayers[id]?.name ?? id;
  const byListing = new Map(r.deals.map((d) => [d.listingId, d]));
  const drafts: InboxDraft[] = [];
  let won = 0;
  let sold = 0;
  for (const b of m.bids.filter((x) => x.clubId === user)) {
    const l = m.listings.find((x) => x.id === b.listingId);
    if (!l) continue;
    const d = byListing.get(l.id);
    const name = nameOf(l.playerId);
    if (d?.toClubId === user) {
      won++;
      drafts.push({ kind: 'BID_WON', title: `${name} 영입`, body: l.kind === 'FA' ? `${name} 선수와 FA 계약을 맺었어요. 계약금 ${fmtM(d.amount)}, 연봉 ${fmtM(d.contract.salary)}, ${d.contract.seasonsLeft}시즌이에요.` : `${name} 선수를 ${fmtM(d.amount)}에 영입했어요.`, playerId: l.playerId, clubId: user, listingId: l.id });
    } else {
      drafts.push({ kind: 'BID_LOST', title: `${name} 영입 실패`, body: d ? `${name} 선수는 다른 구단으로 갔어요.` : `${name} 선수 영입이 성사되지 않았어요. 예산·연봉 캡·선수단 인원·시즌 영입 한도를 확인해 주세요.`, playerId: l.playerId, clubId: user, listingId: l.id });
    }
  }
  for (const l of m.listings.filter((x) => x.sellerClubId === user)) {
    const d = byListing.get(l.id);
    const name = nameOf(l.playerId);
    if (d) {
      sold++;
      drafts.push({ kind: 'PLAYER_SOLD', title: `${name} 이적`, body: `${name} 선수가 ${state.clubs[d.toClubId]?.name ?? d.toClubId}로 ${fmtM(d.amount)}에 이적했어요. 이적세 ${fmtM(d.tax)}를 빼고 ${fmtM(d.amount - d.tax)}가 들어왔어요.`, playerId: l.playerId, clubId: user, listingId: l.id });
    } else {
      drafts.push({ kind: 'LISTING_UNSOLD', title: `${name} 미판매`, body: `${name} 선수를 사겠다는 구단이 없어 그대로 남았어요.`, playerId: l.playerId, clubId: user, listingId: l.id });
    }
  }
  mail(state, drafts);
  if (won || sold) notices.push(`이적 정산: 영입 ${won}명, 판매 ${sold}명`);
  delete state.transferMarket;
  fillHumanSquads(state);
}

// ── 잔액 부족 (D18) ──

export function negativeBalances(state: GameState, sink: LedgerEntry[], notices: string[]): void {
  const day = state.time.day;
  for (const id of sortedIds(state)) {
    const f = state.finances[id];
    if (!f) continue;
    const st = negativeBalanceStatus(f.balance, f.negativeSinceDay, day);
    if (!st.locked) {
      if (f.negativeSinceDay !== undefined) {
        const { negativeSinceDay: _gone, ...rest } = f;
        state.finances[id] = rest;
      }
      continue;
    }
    if (f.negativeSinceDay === undefined) {
      state.finances[id] = { ...f, negativeSinceDay: st.negativeSinceDay! };
      if (id === state.userClubId) mailContract(state, [{ kind: 'NEGATIVE_BALANCE', clubId: id, balance: f.balance }]);
    }
    if (!st.forceSale) continue;
    const fs = forcedSales({ clubId: id, balance: f.balance, players: clubPlayers(state, id) });
    if (!fs.sold.length) continue;
    postMoney(state, fs.money, sink);
    if (id === state.userClubId) {
      mailContract(state, fs.money.map((x) => ({ kind: 'FORCED_SALE' as const, playerId: x.playerId, clubId: id, amount: x.amount })));
      notices.push(`잔액 부족으로 ${fs.sold.length}명이 강제 매각됐어요`);
    }
    removePlayers(state, new Set(fs.sold));
  }
  fillHumanSquads(state);
}

/** 매물 정리: 선수가 사라졌거나 소속이 매물과 달라진 것(경계의 은퇴·방출·풀 영입 등)과 그 입찰을 뺀다 */
export function pruneMarket(state: GameState): void {
  const m = state.transferMarket;
  if (!m) return;
  const keep = m.listings.filter((l) => {
    const p = marketPlayer(state, l.playerId);
    return !!p && p.clubId === l.sellerClubId;
  });
  if (keep.length === m.listings.length) return;
  const ids = new Set(keep.map((l) => l.id));
  state.transferMarket = { ...m, listings: keep, bids: m.bids.filter((b) => ids.has(b.listingId)) };
}

/** 세계에서 선수 제거 (강제 매각 = 해외, 풀 세탁 방지) */
export function removePlayers(state: GameState, ids: ReadonlySet<PlayerId>): void {
  for (const c of Object.values(state.clubs)) if (c.playerIds.some((x) => ids.has(x))) state.clubs[c.id] = { ...c, playerIds: c.playerIds.filter((x) => !ids.has(x)) };
  for (const id of ids) delete state.players[id];
  dropFromMarket(state, ids);
}

// ── 재계약 (D19) ──

function clubMatchesMap(state: GameState): Map<ClubId, number> {
  const n = new Map<ClubId, number>();
  for (const f of state.fixtures) {
    if (f.season !== state.time.season || !f.played) continue;
    n.set(f.homeId, (n.get(f.homeId) ?? 0) + 1);
    n.set(f.awayId, (n.get(f.awayId) ?? 0) + 1);
  }
  return n;
}

export function clubMatches(state: GameState, clubId: ClubId): number {
  return clubMatchesMap(state).get(clubId) ?? 0;
}

/** 7.5 AI 재계약 (은퇴 예정자 제외). 이번 시즌 티어·캡 기준 */
export function aiRenewalsFor(state: GameState, clubIds: readonly ClubId[]): PendingRenewal[] {
  const mcs = marketClubs(state);
  const matches = clubMatchesMap(state);
  return clubIds.flatMap((id) => {
    const c = mcs.get(id);
    if (!c) return [];
    return aiRenewals(clubPlayers(state, id).filter((p) => !p.retiring), { tier: c.tier, clubMatches: matches.get(id) ?? 0, capLimit: c.capLimit });
  });
}

/** Day 20: AI 재계약 결정, 사람 구단에 재계약 창 편지 */
export function openRenewals(state: GameState): void {
  const ai = aiRenewalsFor(state, sortedIds(state).filter((id) => !isHuman(state, id)));
  state.pendingRenewals = [...(state.pendingRenewals ?? []), ...ai];
  const user = state.userClubId;
  const expiring = clubPlayers(state, user).filter((p) => p.contract.seasonsLeft === 1 && !p.isTemporary && !p.retiring).map((p) => p.id);
  mailContract(state, [{ kind: 'RENEWAL_OPEN', clubId: user, playerIds: expiring }]);
}

export function upsertRenewal(state: GameState, r: PendingRenewal): void {
  state.pendingRenewals = [...(state.pendingRenewals ?? []).filter((x) => x.playerId !== r.playerId), r];
}

// ── 시즌 경계 ──

/**
 * 계약 −1, 만료 → 재계약(pendingRenewals) 또는 FA. 나이·OVR 변화 뒤, AI 선수단 관리 전에 호출.
 * pendingRenewals 가 없는 이전 세이브(Day 20 을 이 코드 없이 지남)는 모든 구단을 AI 규칙으로 재계약한다.
 */
export function boundaryContracts(state: GameState, ending: number): ContractEvent[] {
  const renewals = state.pendingRenewals ?? aiRenewalsFor(state, sortedIds(state));
  const r = contractBoundary(Object.values(state.players).filter((p) => p.clubId !== null), renewals, ending);
  for (const p of r.players) state.players[p.id] = p;
  const expired = new Set(r.events.flatMap((e) => (e.kind === 'CONTRACT_EXPIRED' ? [e.playerId] : [])));
  for (const c of Object.values(state.clubs)) if (c.playerIds.some((x) => expired.has(x))) state.clubs[c.id] = { ...c, playerIds: c.playerIds.filter((x) => !expired.has(x)) };
  state.pendingRenewals = [];
  state.signingsThisSeason = {};
  return r.events;
}

/** U4: AI 선수단 관리의 방출(약체·인원 초과)에 위약금 (경계 = Day 1 기준, 잔여 = 새 시즌 계약). 원장은 호출자가 Day 1 처리 뒤 쓴다 */
export function aiReleasePenalties(before: Readonly<Record<PlayerId, Player>>, released: readonly { playerId: PlayerId; clubId: ClubId }[]): { clubId: ClubId; amount: Kc; memo: string }[] {
  return released.flatMap((e) => {
    const p = before[e.playerId];
    if (!p) return [];
    const q = releaseQuote(p, { day: 1, freeReleasesLeft: 0 });
    return q.penalty > 0 ? [{ clubId: e.clubId, amount: -q.penalty, memo: `${p.name} 방출 위약금` }] : [];
  });
}

/**
 * 사람 구단 등록 18명 미만 → FA 풀에서 긴급 FA 자동 계약(5.4: ask, 1시즌, 계약금 0).
 * ponytail: 시즌당 2명 상한·캡 검사 없이 안전망으로만 채운다(사람 구단 이적·유스 UI 가 정상 경로). 포지션은 GK 2명만 보장, 나머지는 OVR 순
 */
export function fillHumanSquads(state: GameState): void {
  const tiers = clubTierMap(state);
  for (const id of sortedIds(state).filter((x) => isHuman(state, x))) {
    const squad = () => clubPlayers(state, id).filter((p) => !p.isTemporary);
    if (squad().length >= CONTRACT.emergency.minRegistered) continue;
    const tier = tiers.get(id) ?? state.settings.tier;
    const ref = TIER_REFERENCE_OVR[tier];
    const signed: string[] = [];
    while (squad().length < CONTRACT.emergency.minRegistered) {
      const needGk = squad().filter((p) => p.primary === 'GK').length < 2;
      const pool = Object.values(state.players)
        .filter((p) => p.clubId === null && p.ovr <= ref + 6 && (!needGk || p.primary === 'GK'))
        .sort((a, b) => b.ovr - a.ovr || (a.id < b.id ? -1 : 1));
      const x = pool[0];
      if (!x) break;
      const p = emergencyFaSign(x, id, tier);
      state.players[p.id] = p;
      state.clubs[id] = { ...state.clubs[id]!, playerIds: [...state.clubs[id]!.playerIds, p.id] };
      dropFromMarket(state, new Set([p.id]));
      signed.push(p.name);
    }
    if (signed.length && id === state.userClubId) {
      mail(state, [{ kind: 'GENERAL', title: '긴급 FA 계약', body: `선수단이 ${CONTRACT.emergency.minRegistered}명 아래로 줄어 FA ${signed.length}명(${signed.join(', ')})과 1시즌 계약했어요.`, clubId: id }]);
    }
  }
}

// ── 하루 처리 훅 ──

/**
 * advanceDay DAILY_PROCESSING 끝(연봉·수명주기·이월 뒤)에 호출. 날짜 = 처리 중인 새 날.
 * Day 11 중간 창 열림 + AI 입찰 / Day 15 정산 / Day 20 재계약 창 / Day 25 정규 창 열림 / Day 28 만료 FA 등록 + AI 입찰 / 다음 시즌 Day 2 정산 / 매일 D18.
 */
export function transferDaily(state: GameState, sink: LedgerEntry[], notices: string[]): void {
  const d = state.time.day;
  const W = TRANSFER.window;
  if (d === CONTRACT.renewalOpenDay) openRenewals(state);
  if (d === W.MID.openDay) {
    openWindow(state, 'MID');
    placeAiBids(state);
  }
  if (d === W.REGULAR.openDay) openWindow(state, 'REGULAR');
  if (d === SEASON_DAYS) {
    registerExpiringFa(state);
    placeAiBids(state);
  }
  if (state.transferMarket && isSettleDay(state.time, state.transferMarket.window)) settleMarket(state, sink, notices);
  negativeBalances(state, sink, notices);
}

/**
 * 자동 운영 구단(CAREER_SIM 의 사람 구단, 7.7): 그날 AI 와 같은 규칙으로 재계약(Day 20)·입찰(Day 11·28), aggr 고정.
 * 새 상태를 돌려준다(입력 불변).
 */
export function autoManageDay(input: GameState, clubId: ClubId, aggr = 0.75): GameState {
  const d = input.time.day;
  if (d !== CONTRACT.renewalOpenDay && d !== TRANSFER.window.MID.openDay && d !== SEASON_DAYS) return input;
  const state: GameState = { ...input };
  if (d === CONTRACT.renewalOpenDay) state.pendingRenewals = [...(state.pendingRenewals ?? []), ...aiRenewalsFor(state, [clubId])];
  else placeAiBids(state, [clubId], aggr);
  return state;
}
