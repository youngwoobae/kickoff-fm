/** 받은 편지함 (소유: B, M4.6). getInbox·markRead, 항목의 playerId·matchId·listingId·clubId 로 화면 이동 */
import { useState } from 'react';
import type { InboxMessage, PlayerId } from '../../types';
import { Badge, Card, Empty } from '../components/kit';
import { INBOX_ICON } from '../format';
import { useNav } from '../app/nav';
import { useQuery, useService } from '../service/ServiceContext';
import { PlayerSheet } from './SquadScreen';

/** 안 읽은 편지 수 (홈 배지·상단 버튼) */
export function useUnreadCount(): number {
  return useQuery((s) => s.getInbox?.({ unreadOnly: true }).length ?? 0).data ?? 0;
}

export function InboxScreen() {
  const service = useService();
  const { go } = useNav();
  const q = useQuery((s) => s.getInbox?.());
  const list = q.data;
  const unread = useUnreadCount();
  const [player, setPlayer] = useState<PlayerId | null>(null);
  // 읽음은 게임 사건이 아니라 실패해도 화면을 막지 않는다
  const markRead = (ids?: string[]) => {
    try {
      service.markRead?.(ids);
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

function InboxItem({ m, onRead, onPlayer }: { m: InboxMessage; onRead: () => void; onPlayer: (id: PlayerId) => void }) {
  const { go } = useNav();
  const open = (fn: () => void) => () => {
    onRead();
    fn();
  };
  return (
    <li className={`inbox-item ${m.read ? '' : 'is-unread'}`}>
      <button type="button" className="inbox-head" onClick={onRead} aria-label={`${m.read ? '' : '새 편지, '}${m.title}`}>
        <span aria-hidden="true">{INBOX_ICON[m.kind]}</span>
        <span className="inbox-title">{m.title}</span>
        {!m.read && <Badge tone="accent">새 편지</Badge>}
      </button>
      <p className="inbox-body">{m.body}</p>
      <div className="row-between small">
        <span className="muted">
          시즌 {m.season} · Day {m.day}
        </span>
        <span className="btn-row">
          {m.playerId && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={open(() => onPlayer(m.playerId as PlayerId))}>
              선수 보기
            </button>
          )}
          {m.matchId && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={open(() => go({ tab: 'match', matchId: m.matchId ?? null, matchView: 'report' }))}>
              경기 리포트
            </button>
          )}
          {(m.listingId || m.kind === 'WINDOW_OPENED') && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={open(() => go({ tab: 'club', club: 'transfer' }))}>
              이적시장
            </button>
          )}
          {m.clubId && !m.listingId && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={open(() => go({ tab: 'club', club: 'league' }))}>
              리그 보기
            </button>
          )}
        </span>
      </div>
    </li>
  );
}
