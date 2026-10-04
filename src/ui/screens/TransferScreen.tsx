/**
 * Q05 이적시장 (소유: B, M4.5). 계약 2.2.0 선택 메서드만으로 그린다:
 * getTransferWindow · listTransferListings · placeBid/withdrawBid/listBids · listForSale/withdrawListing · getFinance().spendable/reserved.
 * AI 입찰·다른 구단 입찰 수는 보이지 않는다(블라인드, 경제 6.6). 메서드가 없거나 창이 닫혀 있으면 "닫힘" 안내만.
 */
import { useState } from 'react';
import type { Bid, ListingKind, Player, PlayerId, Position, TransferListing } from '../../types';
import { Badge, Card, Empty, ErrorNote, MoneyField, Segmented, Sheet, Stat } from '../components/kit';
import { LISTING_KIND_LABEL, POS_LABEL, POS_NAME, POS_ORDER, WINDOW_KIND_LABEL, formatKc } from '../format';
import { useGame, useInlineAction, useIsOwner, useQuery } from '../service/ServiceContext';

type View = 'market' | 'bids' | 'sell';
const OWNER_ONLY = '코치는 볼 수만 있어요. 입찰과 판매 등록은 구단주가 해요.';

export function TransferScreen() {
  const snap = useGame();
  const isOwner = useIsOwner();
  const win = useQuery((s) => s.getTransferWindow?.() ?? null).data ?? null;
  const fin = useQuery((s) => s.getFinance()).data;
  const all = useQuery((s) => s.listTransferListings?.() ?? []).data ?? [];
  const bids = useQuery((s) => s.listBids?.() ?? []).data ?? [];
  const [view, setView] = useState<View>('market');
  const forSale = all.filter((l) => l.sellerClubId !== snap.userClubId).length;

  const daysLeft = win ? (win.settleSeason > snap.time.season ? 28 - snap.time.day + win.settleDay : win.settleDay - snap.time.day) : 0;

  return (
    <div className="screen transfer">
      <Card title="이적 창" extra={win ? <Badge tone="good">● 열림</Badge> : <Badge>○ 닫힘</Badge>}>
        {win ? (
          <p>
            <strong>{WINDOW_KIND_LABEL[win.kind]}</strong> · 정산 시즌 {win.settleSeason} · Day {win.settleDay}
            <span className="muted small"> ({daysLeft > 0 ? `${daysLeft}일 뒤` : '오늘 넘기면 정산'})</span>
          </p>
        ) : (
          <p className="muted">지금은 이적 창이 닫혀 있어요. 창이 열리면 받은 편지함으로 알려 드려요.</p>
        )}
        {fin && (
          <div className="stat-grid">
            <Stat label="잔액" value={formatKc(fin.balance)} />
            <Stat label="지출 가능액" value={formatKc(fin.spendable)} sub="입찰 예약액을 뺀 값" />
            <Stat label="입찰 예약액" value={formatKc(fin.reserved ?? 0)} />
            <Stat label="내 입찰" value={`${bids.length}건`} />
          </div>
        )}
        {!isOwner && <p className="small muted">{OWNER_ONLY}</p>}
      </Card>
      {win && (
        <>
          <Segmented
            label="이적시장 하위 화면"
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'market', label: `매물 ${forSale}` },
              { value: 'bids', label: `내 입찰 ${bids.length}` },
              { value: 'sell', label: '판매 등록' },
            ]}
          />
          {view === 'market' && <MarketView all={all} bids={bids} />}
          {view === 'bids' && <BidsView all={all} bids={bids} />}
          {view === 'sell' && <SellView all={all} />}
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
            return (
              <li key={l.id}>
                <button type="button" className="player-row" onClick={() => setSel(l.id)} aria-label={`${p.name}, ${POS_NAME[p.primary]}, OVR ${p.ovr}, ${LISTING_KIND_LABEL[l.kind]}${mine ? ', 입찰함' : ''}`}>
                  <span className={`pos-badge pos-${p.primary}`}>{POS_LABEL[p.primary]}</span>
                  <span className="pr-main">
                    <span className="pr-name">
                      {p.name}
                      <span className="tag tag-muted">{LISTING_KIND_LABEL[l.kind]}</span>
                      {mine && <span className="tag">✓ 입찰함</span>}
                    </span>
                    <span className="pr-sub">
                      {p.age}세 · 평가가치 {formatKc(l.value)}
                      {l.sellerClubId && ` · ${snap.clubs[l.sellerClubId]?.shortName ?? ''}`}
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
  const invalid = feeBad || bonusBad || salaryBad;
  const seasonOpts = Array.from({ length: range[1] - range[0] + 1 }, (_, i) => String(range[0] + i));

  const submit = () => {
    const r = run((s) => s.placeBid?.(fa ? { listingId: l.id, bonus: bonus ?? 0, salary: salary ?? 0, seasons } : { listingId: l.id, fee: fee ?? 0 }), bid ? '입찰을 고쳤어요' : '입찰했어요. 금액이 예약됐어요');
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
        ) : (
          <p className="small muted">{OWNER_ONLY}</p>
        )
      }
    >
      <div className="form-stack">
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
            <MoneyField label="계약금" value={bonus} onChange={setBonus} invalid={bonusBad} hint={`0~${formatKc(l.bonusMax ?? 0)}`} />
            <MoneyField label="연봉" value={salary} onChange={setSalary} invalid={salaryBad} hint={`${formatKc(l.salaryFloor ?? 0)} 이상`} />
            <div className="field">
              <span>계약 기간</span>
              <Segmented label="계약 기간" size="sm" value={String(seasons)} onChange={(v) => setSeasons(Number(v))} options={seasonOpts.map((v) => ({ value: v, label: `${v}시즌` }))} />
            </div>
          </>
        ) : (
          <MoneyField label="이적료" value={fee} onChange={setFee} invalid={feeBad} hint={`${formatKc(l.minPrice)}~${formatKc(l.maxPrice)} 사이로 정해요`} />
        )}
        <p className="small muted">입찰하면 금액이 예약돼 지출 가능액에서 빠져요. 다른 구단 입찰은 보이지 않아요.</p>
        <ErrorNote error={error} dev={snap.settings.devMode} />
      </div>
    </Sheet>
  );
}

function SellView({ all }: { all: TransferListing[] }) {
  const snap = useGame();
  const isOwner = useIsOwner();
  const squad = useQuery((s) => s.getSquad()).data ?? [];
  const { run, error } = useInlineAction();
  const mine = all.filter((l) => l.sellerClubId === snap.userClubId);
  const listed = new Set(mine.map((l) => l.playerId));
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
            .map((p) => (
              <li key={p.id} className="list-row">
                <span>
                  <span className={`pos-badge pos-${p.primary}`}>{POS_LABEL[p.primary]}</span> {p.name}
                  <span className="listing-meta">
                    OVR {p.ovr} · {p.age}세 · 계약 {p.contract.seasonsLeft}시즌 · 연봉 {formatKc(p.contract.salary)}
                  </span>
                </span>
                <button type="button" className="btn btn-secondary btn-sm" disabled={!isOwner} title={isOwner ? undefined : '구단주만 할 수 있어요'} onClick={() => setSel(p)}>
                  판매 등록
                </button>
              </li>
            ))}
        </ul>
      </Card>
      {sel && <SellSheet p={sel} onClose={() => setSel(null)} />}
    </>
  );
}

function SellSheet({ p, onClose }: { p: Player; onClose: () => void }) {
  const snap = useGame();
  const { run, error } = useInlineAction();
  const [price, setPrice] = useState<number | null>(null);
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
        <button type="button" className="btn btn-primary btn-block" disabled={price === null || price <= 0} onClick={submit}>
          판매 명단에 올리기
        </button>
      }
    >
      <div className="form-stack">
        <p>
          {POS_NAME[p.primary]} · {p.age}세 · OVR {p.ovr} · 계약 {p.contract.seasonsLeft}시즌
        </p>
        <MoneyField label="최저가" value={price} onChange={setPrice} hint="평가가치의 0.7~1.3배 사이에서 정해요. 범위를 벗어나면 정확한 범위를 알려 드려요" />
        <ErrorNote error={error} dev={snap.settings.devMode} />
      </div>
    </Sheet>
  );
}
