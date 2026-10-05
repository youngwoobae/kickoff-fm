/**
 * Q05 이적시장 (소유: B, M4.5). 계약 2.2.1 선택 메서드만으로 그린다:
 * getTransferWindow · listTransferListings · placeBid/withdrawBid/listBids · listForSale/withdrawListing · getPlayerValue · getFinance().spendable/reserved.
 * 정규 창은 Day 25 열림 → 다음 시즌 Day 2 정산이라 SEASON_OVER·새 시즌 Day 1 에도 열려 있다.
 * AI 입찰·다른 구단 입찰 수는 보이지 않는다(블라인드, 경제 6.6). 메서드가 없거나 창이 닫혀 있으면 "닫힘" 안내만.
 */
import { useState } from 'react';
import type { Bid, BidInput, GameSnapshot, ListingKind, Player, PlayerId, Position, TransferListing, TransferWindow } from '../../types';
import { Badge, Card, Empty, ErrorNote, MoneyField, Segmented, Sheet, Stat } from '../components/kit';
import { LISTING_KIND_LABEL, POS_LABEL, POS_NAME, POS_ORDER, WINDOW_KIND_LABEL, canPropose, exactM, formatKc } from '../format';
import { useActor, useGame, useInlineAction, useIsOwner, useQuery, useService } from '../service/ServiceContext';

type View = 'market' | 'bids' | 'sell';
const OWNER_ONLY = '코치는 볼 수만 있어요. 입찰과 판매 등록은 구단주가 해요.';
/** 2.5.0: 스카우트·재정 코치는 입찰을 실행 대신 제안한다 */
const COACH_PROPOSE = '입찰은 구단주가 실행해요. 매물을 눌러 구단주에게 입찰을 제안할 수 있어요.';

function useCanProposeBid(): boolean {
  const service = useService();
  const actor = useActor();
  return !!service.proposeDeal && canPropose(actor, 'TRANSFER_BID');
}

export function TransferScreen() {
  const snap = useGame();
  const isOwner = useIsOwner();
  const canBid = useCanProposeBid();
  const win = useQuery((s) => s.getTransferWindow?.() ?? null).data ?? null;
  const fin = useQuery((s) => s.getFinance()).data;
  const all = useQuery((s) => s.listTransferListings?.() ?? []).data ?? [];
  const bids = useQuery((s) => s.listBids?.() ?? []).data ?? [];
  const [view, setView] = useState<View>('market');
  const forSale = all.filter((l) => l.sellerClubId !== snap.userClubId).length;

  // 정산은 그날로 넘어가는 처리에서 일어난다(그날이 되면 창은 이미 닫혀 있다)
  const nextSeason = !!win && win.settleSeason > snap.time.season;
  const daysLeft = win && !nextSeason ? win.settleDay - snap.time.day : 0;

  return (
    <div className="screen transfer">
      <Card title="이적 창" extra={win ? <Badge tone="good">● 열림</Badge> : <Badge>○ 닫힘</Badge>}>
        {win ? (
          <p>
            <strong>{WINDOW_KIND_LABEL[win.kind]}</strong> · {nextSeason ? '다음 시즌' : `시즌 ${win.settleSeason}`} Day {win.settleDay} 정산
            <span className="muted small"> ({nextSeason ? '새 시즌을 시작한 뒤 정산돼요' : daysLeft <= 1 ? '다음 날로 넘어가면 정산돼요' : `${daysLeft}일 뒤`})</span>
          </p>
        ) : (
          <p className="muted">지금은 이적 창이 닫혀 있어요. 창이 열리면 받은 편지함으로 알려 드려요.</p>
        )}
        {fin && (
          <div className="stat-grid">
            <Stat label="잔액" value={formatKc(fin.balance)} />
            <Stat label="지출 가능액" value={formatKc(fin.spendable)} sub={nextSeason ? '다음 시즌 배정금·연봉을 미리 반영, 입찰 예약액 제외' : '입찰 예약액을 뺀 값'} />
            <Stat label="입찰 예약액" value={formatKc(fin.reserved ?? 0)} />
            <Stat label="내 입찰" value={`${bids.length}건`} />
          </div>
        )}
        {!isOwner && <p className="small muted">{canBid ? COACH_PROPOSE : `${OWNER_ONLY} 입찰 제안은 스카우트·재정 코치가 해요.`}</p>}
      </Card>
      {win && (
        <>
          <Segmented
            label="이적시장 하위 화면"
            panelId="transfer-panel"
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'market', label: `매물 ${forSale}` },
              { value: 'bids', label: `내 입찰 ${bids.length}` },
              { value: 'sell', label: '판매 등록' },
            ]}
          />
          <div role="tabpanel" id="transfer-panel" aria-labelledby={`transfer-panel-tab-${view}`} className="screen">
            {view === 'market' && <MarketView all={all} bids={bids} />}
            {view === 'bids' && <BidsView all={all} bids={bids} />}
            {view === 'sell' && <SellView all={all} win={win} />}
          </div>
        </>
      )}
    </div>
  );
}

/** 매물 선수 조회 (없는 선수는 건너뛴다) */
function usePlayers(ids: readonly PlayerId[]): Record<PlayerId, Player> {
  const key = ids.join(',');
  return (
    useQuery((s) => {
      const out: Record<PlayerId, Player> = {};
      for (const id of ids) {
        try {
          out[id] = s.getPlayer(id);
        } catch {
          /* 이미 시장에서 사라진 선수 */
        }
      }
      return out;
    }, [key]).data ?? {}
  );
}

/** Day 28 부터 FA 매물에는 아직 다른 구단(또는 우리 구단) 소속인 만료 예정 선수가 섞인다(시즌이 끝나면 FA). 그 소속 문구, 아니면 null */
function expiringText(l: TransferListing, p: Player, snap: GameSnapshot): string | null {
  if (l.kind !== 'FA' || !p.clubId) return null;
  return p.clubId === snap.userClubId ? '우리 선수' : `현 소속 ${snap.clubs[p.clubId]?.shortName ?? p.clubId}`;
}

function priceText(l: TransferListing): string {
  return l.kind === 'FA'
    ? `계약금 0~${formatKc(l.bonusMax ?? 0)} · 연봉 ${formatKc(l.salaryFloor ?? 0)} 이상`
    : `입찰 범위 ${formatKc(l.minPrice)}~${formatKc(l.maxPrice)}`;
}
function bidText(b: Bid): string {
  return b.fee !== undefined ? `이적료 ${formatKc(b.fee)}` : `계약금 ${formatKc(b.bonus ?? 0)} · 연봉 ${formatKc(b.salary ?? 0)} · ${b.seasons ?? 1}시즌`;
}

const OVR_OPTS = [0, 50, 55, 60, 65, 70];
const PRICE_OPTS = [0, 5_000_000, 10_000_000, 20_000_000, 40_000_000];

function MarketView({ all, bids }: { all: TransferListing[]; bids: Bid[] }) {
  const snap = useGame();
  const [kind, setKind] = useState<ListingKind | 'ALL'>('ALL');
  const [pos, setPos] = useState<Position | ''>('');
  const [minOvr, setMinOvr] = useState(0);
  const [maxPrice, setMaxPrice] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const filtered =
    useQuery(
      (s) =>
        s.listTransferListings?.({
          kind: kind === 'ALL' ? undefined : kind,
          position: pos || undefined,
          minOvr: minOvr || undefined,
          maxPrice: maxPrice || undefined,
        }) ?? [],
      [kind, pos, minOvr, maxPrice],
    ).data ?? [];
  const others = filtered.filter((l) => l.sellerClubId !== snap.userClubId);
  const players = usePlayers(others.map((l) => l.playerId));
  const bidOn = new Map(bids.map((b) => [b.listingId, b]));
  const selected = all.find((l) => l.id === sel) ?? null;
  return (
    <>
      <Segmented
        label="매물 종류"
        size="sm"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'ALL', label: '전체' },
          { value: 'NPC', label: '신규' },
          { value: 'FA', label: 'FA' },
          { value: 'CLUB', label: '구단 명단' },
        ]}
      />
      <div className="filter-row">
        <label className="field">
          <span>포지션</span>
          <select value={pos} onChange={(e) => setPos(e.target.value as Position | '')}>
            <option value="">전체</option>
            {POS_ORDER.map((p) => (
              <option key={p} value={p}>
                {POS_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>OVR</span>
          <select value={minOvr} onChange={(e) => setMinOvr(Number(e.target.value))}>
            {OVR_OPTS.map((v) => (
              <option key={v} value={v}>
                {v ? `${v} 이상` : '전체'}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>최대가</span>
          <select value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))}>
            {PRICE_OPTS.map((v) => (
              <option key={v} value={v}>
                {v ? `${formatKc(v)} 이하` : '전체'}
              </option>
            ))}
          </select>
        </label>
      </div>
      {others.length === 0 ? (
        <Empty>조건에 맞는 매물이 없어요</Empty>
      ) : (
        <ul className="player-list" aria-label="매물 목록">
          {others.map((l) => {
            const p = players[l.playerId];
            if (!p) return null;
            const mine = bidOn.get(l.id);
            const expiring = expiringText(l, p, snap);
            return (
              <li key={l.id}>
                <button type="button" className="player-row" onClick={() => setSel(l.id)} aria-label={`${p.name}, ${POS_NAME[p.primary]}, OVR ${p.ovr}, ${LISTING_KIND_LABEL[l.kind]}${expiring ? `, 계약 만료 예정, ${expiring}` : ''}${mine ? ', 입찰함' : ''}`}>
                  <span className={`pos-badge pos-${p.primary}`}>{POS_LABEL[p.primary]}</span>
                  <span className="pr-main">
                    <span className="pr-name">
                      {p.name}
                      <span className="tag tag-muted">{LISTING_KIND_LABEL[l.kind]}</span>
                      {expiring && <span className="tag tag-warn">⌛ 계약 만료 예정</span>}
                      {mine && <span className="tag">✓ 입찰함</span>}
                    </span>
                    <span className="pr-sub">
                      {p.age}세 · 평가가치 {formatKc(l.value)}
                      {l.sellerClubId && ` · ${snap.clubs[l.sellerClubId]?.shortName ?? ''}`}
                      {expiring && ` · ${expiring}`}
                    </span>
                    <span className="listing-meta">{priceText(l)}</span>
                  </span>
                  <span className="pr-ovr" aria-hidden="true">
                    {p.ovr}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <BidSheet listing={selected} bid={selected ? bidOn.get(selected.id) : undefined} onClose={() => setSel(null)} />
    </>
  );
}

function BidsView({ all, bids }: { all: TransferListing[]; bids: Bid[] }) {
  const [sel, setSel] = useState<string | null>(null);
  const players = usePlayers(all.map((l) => l.playerId));
  const byId = new Map(all.map((l) => [l.id, l]));
  const selected = (sel && byId.get(sel)) || null;
  if (!bids.length) return <Empty>아직 입찰한 매물이 없어요. ‘매물’에서 선수를 눌러 입찰해 보세요.</Empty>;
  return (
    <Card title="내 입찰">
      <p className="small muted">정산일에 한꺼번에 결과가 나와요. 그 전까지 고치거나 철회할 수 있어요.</p>
      <ul className="list">
        {bids.map((b) => {
          const l = byId.get(b.listingId);
          const p = l && players[l.playerId];
          return (
            <li key={b.listingId} className="list-row">
              <span>
                <strong>{p?.name ?? b.listingId}</strong>
                {p && <span className="small muted"> {POS_LABEL[p.primary]} · OVR {p.ovr}</span>}
                <span className="listing-meta">
                  {bidText(b)} · Day {b.placedDay}
                </span>
              </span>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!l} onClick={() => setSel(b.listingId)}>
                보기
              </button>
            </li>
          );
        })}
      </ul>
      <BidSheet listing={selected} bid={bids.find((b) => b.listingId === sel)} onClose={() => setSel(null)} />
    </Card>
  );
}

/** 입찰·수정·철회 시트. 범위는 매물 값으로 미리 검사하고, 서비스 오류는 코드별 안내로 보여 준다 */
function BidSheet({ listing: l, bid, onClose }: { listing: TransferListing | null; bid?: Bid; onClose: () => void }) {
  if (!l) return null;
  return <BidForm key={l.id} l={l} bid={bid} onClose={onClose} />;
}

function BidForm({ l, bid, onClose }: { l: TransferListing; bid?: Bid; onClose: () => void }) {
  const snap = useGame();
  const isOwner = useIsOwner();
  const canBid = useCanProposeBid();
  const [reason, setReason] = useState('');
  const { run, error } = useInlineAction();
  const p = useQuery((s) => s.getPlayer(l.playerId), [l.playerId]).data;
  const range = l.seasonsRange ?? [1, 1];
  const [fee, setFee] = useState<number | null>(bid?.fee ?? l.minPrice);
  const [bonus, setBonus] = useState<number | null>(bid?.bonus ?? 0);
  const [salary, setSalary] = useState<number | null>(bid?.salary ?? l.salaryFloor ?? 0);
  const [seasons, setSeasons] = useState<number>(bid?.seasons ?? range[0]);
  const fa = l.kind === 'FA';
  const feeBad = !fa && (fee === null || fee < l.minPrice || fee > l.maxPrice);
  const bonusBad = fa && (bonus === null || bonus < 0 || bonus > (l.bonusMax ?? 0));
  const salaryBad = fa && (salary === null || salary < (l.salaryFloor ?? 0));
  // 2.4.1: 이번 시즌 우리가 방출한 선수는 FA 로 다시 데려올 수 없다 (서비스는 BID_OUT_OF_RANGE · RELEASED)
  const released = fa && !!snap.releasedThisSeason?.[snap.userClubId]?.includes(l.playerId);
  const invalid = feeBad || bonusBad || salaryBad || released;
  const seasonOpts = Array.from({ length: range[1] - range[0] + 1 }, (_, i) => String(range[0] + i));

  const input: BidInput = fa ? { listingId: l.id, bonus: bonus ?? 0, salary: salary ?? 0, seasons } : { listingId: l.id, fee: fee ?? 0 };
  const submit = () => {
    const r = run((s) => s.placeBid?.(input), bid ? '입찰을 고쳤어요' : '입찰했어요. 금액이 예약됐어요');
    if (r) onClose();
  };
  const propose = () => {
    const r = run((s) => s.proposeDeal?.({ payload: { kind: 'TRANSFER_BID', bid: input }, reason: reason.trim() }), '입찰 제안을 보냈어요. 구단주 승인을 기다려요');
    if (r) onClose();
  };
  const withdraw = () => {
    run((s) => s.withdrawBid?.(l.id), '입찰을 철회했어요. 예약이 풀렸어요');
    onClose();
  };
  return (
    <Sheet
      open
      title={p ? `${p.name} 입찰` : '입찰'}
      onClose={onClose}
      footer={
        isOwner ? (
          <div className="btn-row">
            {bid && (
              <button type="button" className="btn btn-secondary" onClick={withdraw}>
                입찰 철회
              </button>
            )}
            <button type="button" className="btn btn-primary" disabled={invalid} onClick={submit}>
              {bid ? '입찰 고치기' : '입찰하기'}
            </button>
          </div>
        ) : canBid ? (
          <button type="button" className="btn btn-primary btn-block" disabled={invalid || !reason.trim()} onClick={propose}>
            구단주에게 입찰 제안
          </button>
        ) : (
          <p className="small muted">{OWNER_ONLY} 입찰 제안은 스카우트·재정 코치가 해요.</p>
        )
      }
    >
      <div className="form-stack">
        {released && <p className="warn-line" role="note">⚠ 이번 시즌에 방출한 선수는 FA로 다시 데려올 수 없어요</p>}
        {p && (
          <p>
            <span className={`pos-badge pos-${p.primary}`}>{POS_LABEL[p.primary]}</span> {POS_NAME[p.primary]} · {p.age}세 · <strong>OVR {p.ovr}</strong> · 스카우트 {p.scoutRange[0]}~{p.scoutRange[1]}
          </p>
        )}
        <ul className="list compact">
          <li className="list-row">
            <span>매물</span>
            <span>
              {LISTING_KIND_LABEL[l.kind]}
              {l.sellerClubId && ` · ${snap.clubs[l.sellerClubId]?.name ?? ''}`}
            </span>
          </li>
          {p && expiringText(l, p, snap) && (
            <li className="list-row">
              <span>상태</span>
              <Badge tone="warn">⌛ 계약 만료 예정 · {expiringText(l, p, snap)}</Badge>
            </li>
          )}
          <li className="list-row">
            <span>평가가치</span>
            <strong>{formatKc(l.value)}</strong>
          </li>
          <li className="list-row">
            <span>{fa ? '조건' : '입찰 범위'}</span>
            <span>{fa ? priceText(l) : `${formatKc(l.minPrice)}~${formatKc(l.maxPrice)}`}</span>
          </li>
        </ul>
        {fa ? (
          <>
            <MoneyField label="계약금" value={bonus} onChange={setBonus} invalid={bonusBad} hint={`0~${exactM(l.bonusMax ?? 0)}`} />
            <MoneyField label="연봉" value={salary} onChange={setSalary} invalid={salaryBad} hint={`${exactM(l.salaryFloor ?? 0)} 이상`} />
            <div className="field">
              <span>계약 기간</span>
              <Segmented label="계약 기간" size="sm" value={String(seasons)} onChange={(v) => setSeasons(Number(v))} options={seasonOpts.map((v) => ({ value: v, label: `${v}시즌` }))} />
            </div>
          </>
        ) : (
          <MoneyField label="이적료" value={fee} onChange={setFee} invalid={feeBad} hint={`${exactM(l.minPrice)}~${exactM(l.maxPrice)} 사이로 정해요`} />
        )}
        {canBid && (
          <label className="field">
            <span>제안 이유 (필수, 최대 80자)</span>
            <input value={reason} maxLength={80} aria-describedby="bid-reason-count" onChange={(e) => setReason(e.target.value)} placeholder="예: 왼쪽 수비 보강이 급해요" />
            <small id="bid-reason-count" className="muted">
              {reason.length}/80 · 구단주가 다음 날로 넘기기 전에 승인하면 입찰돼요
            </small>
          </label>
        )}
        <p className="small muted">입찰하면 금액이 예약돼 지출 가능액에서 빠져요. 다른 구단 입찰은 보이지 않아요.</p>
        <ErrorNote error={error} dev={snap.settings.devMode} />
      </div>
    </Sheet>
  );
}

function SellView({ all, win }: { all: TransferListing[]; win: TransferWindow }) {
  const snap = useGame();
  const isOwner = useIsOwner();
  const squad = useQuery((s) => s.getSquad()).data ?? [];
  const { run, error } = useInlineAction();
  const mine = all.filter((l) => l.sellerClubId === snap.userClubId);
  const listed = new Set(mine.map((l) => l.playerId));
  const renewedIds = new Set((snap.pendingRenewals ?? []).map((r) => r.playerId));
  const byId = new Map(squad.map((p) => [p.id, p]));
  const [sel, setSel] = useState<Player | null>(null);
  return (
    <>
      <Card title="내 판매 명단">
        {mine.length === 0 ? (
          <Empty>올린 선수가 없어요</Empty>
        ) : (
          <ul className="list">
            {mine.map((l) => (
              <li key={l.id} className="list-row">
                <span>
                  <strong>{byId.get(l.playerId)?.name ?? l.playerId}</strong>
                  <span className="listing-meta">
                    최저가 {formatKc(l.minPrice)} · 평가가치 {formatKc(l.value)}
                  </span>
                </span>
                {isOwner && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => run((s) => s.withdrawListing?.(l.id), '판매 등록을 철회했어요')}>
                    철회
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <ErrorNote error={error} dev={snap.settings.devMode} />
      </Card>
      <Card title="선수단에서 올리기">
        <p className="small muted">정산일에 사려는 구단이 있으면 팔려요. 이적세 10%를 뺀 금액이 들어와요.</p>
        <ul className="list">
          {squad
            .filter((p) => !listed.has(p.id))
            .map((p) => {
              // 2.4.1: 성립한 재계약(pendingRenewals)이 있으면 새 계약으로 보아 정규 창에도 올릴 수 있다 (도메인 withPendingRenewal 과 같은 판정)
              const blocked = win.kind === 'REGULAR' && p.contract.seasonsLeft <= 1 && !renewedIds.has(p.id) ? '계약이 이번 시즌에 끝나는 선수는 정규 창에 올릴 수 없어요' : undefined;
              return (
              <li key={p.id} className="list-row">
                <span>
                  <span className={`pos-badge pos-${p.primary}`}>{POS_LABEL[p.primary]}</span> {p.name}
                  <span className="listing-meta">
                    OVR {p.ovr} · {p.age}세 · 계약 {p.contract.seasonsLeft}시즌 · 연봉 {formatKc(p.contract.salary)}
                    {blocked && ' · 만료 예정이라 정규 창 등록 불가'}
                  </span>
                </span>
                <button type="button" className="btn btn-secondary btn-sm" disabled={!isOwner || !!blocked} title={!isOwner ? '구단주만 할 수 있어요' : blocked} onClick={() => setSel(p)}>
                  판매 등록
                </button>
              </li>
              );
            })}
        </ul>
      </Card>
      {sel && <SellSheet p={sel} onClose={() => setSel(null)} />}
    </>
  );
}

function SellSheet({ p, onClose }: { p: Player; onClose: () => void }) {
  const snap = useGame();
  const { run, error } = useInlineAction();
  // 2.2.1 선택 메서드: 평가가치 V 와 허용 최저가 범위(0.7V~1.3V). 없으면 서비스 오류 문구가 범위를 알려 준다
  const v = useQuery((s) => s.getPlayerValue?.(p.id) ?? null, [p.id]).data ?? null;
  const [price, setPrice] = useState<number | null>(v?.value ?? null);
  const outOfRange = !!v && price !== null && (price < v.minPrice || price > v.maxPrice);
  const submit = () => {
    const r = run((s) => s.listForSale?.(p.id, price ?? 0), `${p.name} 선수를 판매 명단에 올렸어요`);
    if (r) onClose();
  };
  return (
    <Sheet
      open
      title={`${p.name} 판매 등록`}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary btn-block" disabled={price === null || price <= 0 || outOfRange} onClick={submit}>
          판매 명단에 올리기
        </button>
      }
    >
      <div className="form-stack">
        <p>
          {POS_NAME[p.primary]} · {p.age}세 · OVR {p.ovr} · 계약 {p.contract.seasonsLeft}시즌
        </p>
        {v && (
          <ul className="list compact">
            <li className="list-row">
              <span>평가가치</span>
              <strong>{formatKc(v.value)}</strong>
            </li>
            <li className="list-row">
              <span>최저가 허용 범위</span>
              <span>
                {formatKc(v.minPrice)}~{formatKc(v.maxPrice)}
              </span>
            </li>
          </ul>
        )}
        <MoneyField
          label="최저가"
          value={price}
          onChange={setPrice}
          invalid={outOfRange}
          hint={v ? `${exactM(v.minPrice)}~${exactM(v.maxPrice)} 사이로 정해요. 이보다 낮은 입찰은 받지 않아요` : '평가가치의 0.7~1.3배 사이에서 정해요'}
        />
        <ErrorNote error={error} dev={snap.settings.devMode} />
      </div>
    </Sheet>
  );
}
