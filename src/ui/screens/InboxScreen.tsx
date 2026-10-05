/** 받은 편지함 (소유: B, M4.6). getInbox·markRead, 항목의 playerId·matchId·listingId·clubId 로 화면 이동 */
import { useState } from 'react';
import type { InboxKind, InboxMessage, PlayerId } from '../../types';
import { Badge, Card, Empty } from '../components/kit';
import { INBOX_ICON, INBOX_KIND_LABEL } from '../format';
import { useNav, type NavState } from '../app/nav';
import { useQuery, useService } from '../service/ServiceContext';
import { PlayerSheet } from './SquadScreen';
import { YOUTH_INBOX_KINDS } from '../types23';

/** 안 읽은 편지 수 (홈 배지·상단 버튼) */
export function useUnreadCount(): number {
  return useQuery((s) => s.getInbox({ unreadOnly: true }).length).data ?? 0;
}

export function InboxScreen() {
  const service = useService();
  const { go } = useNav();
  const q = useQuery((s) => s.getInbox());
  const list = q.data;
  const unread = useUnreadCount();
  const [player, setPlayer] = useState<PlayerId | null>(null);
  // 읽음은 게임 사건이 아니라 실패해도 화면을 막지 않는다
  const markRead = (ids?: string[]) => {
    try {
      service.markRead(ids);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="screen inbox">
      <div className="row-between">
        <button type="button" className="btn btn-ghost" onClick={() => go({ homeView: 'today' })}>
          ‹ 오늘로
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={unread === 0} onClick={() => markRead()}>
          모두 읽음
        </button>
      </div>
      <Card title={`받은 편지함${unread ? ` · 안 읽음 ${unread}통` : ''}`}>
        {q.error ? (
          <Empty>{q.error.message}</Empty>
        ) : !list ? (
          <Empty>받은 편지함은 곧 열려요. 이적·계약 소식이 여기로 와요.</Empty>
        ) : list.length === 0 ? (
          <Empty>아직 받은 편지가 없어요</Empty>
        ) : (
          <ul className="list" aria-label="편지 목록">
            {list.map((m) => (
              <InboxItem key={m.id} m={m} onRead={() => !m.read && markRead([m.id])} onPlayer={setPlayer} />
            ))}
          </ul>
        )}
      </Card>
      <PlayerSheet playerId={player} onClose={() => setPlayer(null)} />
    </div>
  );
}

/** 종류별 바로 가기 (clubId 는 늘 우리 구단이라 링크로 쓰지 않는다. 창은 정산 뒤 닫히므로 이적시장은 창 열림 편지만) */
const KIND_LINK: Partial<Record<InboxKind | 'YOUTH_OFFERED', { label: string; to: Partial<NavState> }>> = {
  WINDOW_OPENED: { label: '이적시장', to: { tab: 'club', club: 'transfer' } },
  BID_WON: { label: '재정', to: { tab: 'club', club: 'finance' } },
  PLAYER_SOLD: { label: '재정', to: { tab: 'club', club: 'finance' } },
  PLAYER_RELEASED: { label: '재정', to: { tab: 'club', club: 'finance' } },
  NEGATIVE_BALANCE: { label: '재정', to: { tab: 'club', club: 'finance' } },
  FORCED_SALE: { label: '재정', to: { tab: 'club', club: 'finance' } },
  RENEWAL_OPEN: { label: '선수단', to: { tab: 'squad', squad: 'list' } },
  CONTRACT_EXPIRED: { label: '선수단', to: { tab: 'squad', squad: 'list' } },
  GENERAL: { label: '선수단', to: { tab: 'squad', squad: 'list' } }, // 긴급 FA 자동 계약
  // 2.3.0 유스 (YOUTH_OFFERED 는 Backend 2.3.0 이름, YOUTH_INTAKE 와 같은 뜻)
  YOUTH_INTAKE: { label: '유스 후보 보기', to: { tab: 'squad', squad: 'youth' } },
  YOUTH_OFFERED: { label: '유스 후보 보기', to: { tab: 'squad', squad: 'youth' } },
  YOUTH_AUTO_DECIDED: { label: '선수단', to: { tab: 'squad', squad: 'list' } },
};

function InboxItem({ m, onRead, onPlayer }: { m: InboxMessage; onRead: () => void; onPlayer: (id: PlayerId) => void }) {
  const { go } = useNav();
  // 방출된 유스·팔리지 않은 신규 선수처럼 세계에서 사라진 선수는 링크를 숨긴다
  const hasPlayer = useQuery((s) => (m.playerId ? !!s.getPlayer(m.playerId) : false), [m.playerId]).data ?? false;
  const link = KIND_LINK[m.kind as keyof typeof KIND_LINK];
  // 2.3.0 새 종류는 InboxKind 에 아직 없어 라벨·아이콘이 비면 유스·일반으로 대신한다
  const kindLabel = INBOX_KIND_LABEL[m.kind] ?? (YOUTH_INBOX_KINDS.includes(m.kind) ? '유스' : '알림');
  const icon = INBOX_ICON[m.kind] ?? (YOUTH_INBOX_KINDS.includes(m.kind) ? '🌱' : '✉');
  const open = (fn: () => void) => () => {
    onRead();
    fn();
  };
  return (
    <li className={`inbox-item ${m.read ? '' : 'is-unread'}`}>
      <button type="button" className="inbox-head" onClick={onRead} aria-label={`${m.read ? '' : '새 편지, '}${kindLabel}: ${m.title}`}>
        <span aria-hidden="true">{icon}</span>
        <span className="inbox-title">{m.title}</span>
        {!m.read && <Badge tone="accent">새 편지</Badge>}
      </button>
      <p className="inbox-body">{m.body}</p>
      <div className="row-between small">
        <span className="muted">
          {kindLabel} · 시즌 {m.season} · Day {m.day}
        </span>
        <span className="btn-row">
          {hasPlayer && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={open(() => onPlayer(m.playerId as PlayerId))}>
              선수 보기
            </button>
          )}
          {m.matchId && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={open(() => go({ tab: 'match', matchId: m.matchId ?? null, matchView: 'report' }))}>
              경기 리포트
            </button>
          )}
          {link && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={open(() => go(link.to))}>
              {link.label}
            </button>
          )}
        </span>
      </div>
    </li>
  );
}
