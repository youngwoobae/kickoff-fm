/**
 * 2.5.0 로컬 프로필 (M6.4, 소유: B): 상단 현재 멤버 칩 + 사용자 바꾸기 시트.
 * 한 기기를 번갈아 쓰는 핫시트. 구단주로 바꿀 때 PIN 이 있으면 4자리 입력 (PIN_REQUIRED·PIN_WRONG).
 * listMembers/switchMember 가 없는 서비스는 스냅샷 멤버십 + switchRole 로 대체한다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Membership } from '../../types';
import { Sheet } from '../components/kit';
import { useToast } from '../components/Toast';
import { memberRoleText, memberText, proposeAreaText } from '../format';
import { useNav } from '../app/nav';
import { useActor, useGame, useInlineAction, useQuery } from '../service/ServiceContext';

/** 이 구단 멤버 (구단주 먼저). 표시 필드는 memberText 가 기본값을 채운다 */
export function useMembers(): Membership[] {
  const snap = useGame();
  const listed = useQuery((s) => s.listMembers?.() ?? null).data;
  return listed ?? snap.memberships.filter((m) => m.clubId === snap.userClubId);
}

/** 상단 바: 현재 멤버 칩 (이모지+이름). 탭하면 사용자 바꾸기 시트 */
export function MemberChip() {
  const actor = useActor();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  if (!actor) return null;
  const label = memberText(actor);
  return (
    <>
      <button type="button" className={`role-chip ${actor.seat === 'OWNER' ? '' : 'is-coach'}`} aria-label={`지금 사용자 ${label}, 눌러서 사용자 바꾸기`} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span aria-hidden="true">{actor.emoji ?? (actor.seat === 'OWNER' ? '👑' : '🧢')}</span> <span className="chip-name">{actor.name ?? memberRoleText(actor)}</span>
      </button>
      {/* 상단 바(sticky)의 쌓임 맥락을 벗어나도록 body 로 포털 (설정 시트와 같은 규칙) */}
      {open && createPortal(<ProfileSheet onClose={close} />, document.body)}
    </>
  );
}

export function ProfileSheet({ onClose }: { onClose: () => void }) {
  const actor = useActor();
  const members = useMembers();
  const hasPin = useQuery((s) => s.hasOwnerPin?.() ?? false).data ?? false;
  const { go } = useNav();
  const toast = useToast();
  const { run, error, clear } = useInlineAction();
  const [pinFor, setPinFor] = useState<Membership | null>(null);
  const [pin, setPin] = useState('');
  const pinRef = useRef<HTMLInputElement>(null);
  const isOwner = actor?.seat === 'OWNER';
  const coaches = members.filter((m) => m.seat !== 'OWNER').length;

  useEffect(() => {
    if (pinFor) pinRef.current?.focus();
  }, [pinFor]);

  const switchTo = (m: Membership, withPin?: string) => {
    const r = run((s) => (s.switchMember ? s.switchMember(m.userId, withPin) : s.switchRole(m.seat === 'OWNER' ? 'OWNER' : 'COACH')));
    if (r) {
      toast.show(`${memberText(r)} 차례예요`, 'success');
      onClose();
    } else {
      setPin('');
      pinRef.current?.focus();
    }
  };
  const pick = (m: Membership) => {
    if (m.userId === actor?.userId) return onClose();
    clear();
    if (m.seat === 'OWNER' && hasPin) {
      setPin('');
      setPinFor(m);
      return;
    }
    switchTo(m);
  };
  const pinCode = error?.details?.find((d) => d === 'PIN_WRONG' || d === 'PIN_REQUIRED');

  return (
    <Sheet
      open
      title={pinFor ? '구단주 PIN 입력' : '사용자 바꾸기'}
      onClose={onClose}
      footer={
        pinFor ? (
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setPinFor(null);
                clear();
              }}
            >
              뒤로
            </button>
            <button type="submit" form="pin-form" className="btn btn-primary" disabled={!/^\d{4}$/.test(pin)}>
              확인
            </button>
          </div>
        ) : isOwner ? (
          <button
            type="button"
            className="btn btn-secondary btn-block"
            onClick={() => {
              onClose();
              go({ tab: 'club', club: 'coach' });
            }}
          >
            멤버 관리 (코치 추가·PIN)
          </button>
        ) : undefined
      }
    >
      {pinFor ? (
        <form
          id="pin-form"
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^\d{4}$/.test(pin)) switchTo(pinFor, pin);
          }}
        >
          <p>
            {memberText(pinFor)}로 바꾸려면 PIN 4자리를 입력해 주세요.
          </p>
          <label className="field">
            <span>PIN (숫자 4자리)</span>
            <input
              ref={pinRef}
              className="pin-input"
              type="password"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              autoComplete="off"
              aria-invalid={!!pinCode || undefined}
              aria-describedby="pin-error"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
          </label>
          <p id="pin-error" className={error ? 'error-note' : 'small muted'} role={error ? 'alert' : undefined}>
            {pinCode === 'PIN_WRONG' ? '⚠ PIN 이 맞지 않아요. 다시 입력해 주세요.' : pinCode === 'PIN_REQUIRED' ? '⚠ PIN 4자리를 입력해 주세요.' : error ? `⚠ ${error.message}` : 'PIN 을 잊었다면 설정 → 세이브 내보내기 파일에서 ownerPin 을 지우고 다시 가져오면 돼요.'}
          </p>
        </form>
      ) : (
        <>
          <p className="small muted">한 기기를 번갈아 써요. 내 차례가 되면 내 이름을 눌러 주세요.</p>
          <ul className="member-list" aria-label="멤버">
            {members.map((m) => {
              const me = m.userId === actor?.userId;
              return (
                <li key={m.userId}>
                  <button type="button" className={`member-row ${me ? 'is-current' : ''}`} aria-current={me ? 'true' : undefined} onClick={() => pick(m)}>
                    <span className="member-emoji" aria-hidden="true">
                      {m.emoji ?? (m.seat === 'OWNER' ? '👑' : '🧢')}
                    </span>
                    <span className="member-main">
                      <strong>{m.name ?? memberRoleText(m)}</strong>
                      <span className="small muted">
                        {memberRoleText(m)}
                        {m.seat === 'COACH' && ` · 제안: ${proposeAreaText(m)}`}
                        {m.seat === 'OWNER' && hasPin && ' · 🔒 PIN'}
                      </span>
                    </span>
                    {me && <span className="badge badge-accent">✓ 지금 사용자</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {coaches === 0 && <p className="small muted">아직 코치가 없어요. {isOwner ? '아래 ‘멤버 관리’에서 코치를 추가하면 한 기기에서 함께할 수 있어요.' : ''}</p>}
          {error && !pinCode && (
            <p className="error-note" role="alert">
              ⚠ {error.message}
            </p>
          )}
        </>
      )}
    </Sheet>
  );
}
