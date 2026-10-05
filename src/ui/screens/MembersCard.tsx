/**
 * 2.5.0 멤버 관리 (M6.4, 소유: B): 구단주만 코치 추가·수정·삭제, 구단주 PIN 설정/해제.
 * 오류(INVALID_MEMBER·NOT_OWNER 등)는 시트 안에서 서비스 문구로 안내한다. 선택 메서드가 없는 서비스면 그리지 않는다.
 */
import { useState } from 'react';
import type { Membership, RoleLabel } from '../../types';
import { Card, ErrorNote, Segmented, Sheet } from '../components/kit';
import { ROLE_NAME, ROLE_ORDER, ROLE_SHORT, memberRoleText, memberText, proposeAreaText } from '../format';
import { useGame, useInlineAction, useIsOwner, useQuery } from '../service/ServiceContext';
import { useMembers } from './ProfileSheet';

const MAX_COACHES = 5;
const EMOJIS = ['🟦', '🟩', '🟥', '🟪', '🟧', '🟫', '🧢', '⚽', '🦁', '🐯', '🦊', '🐻'];

export function MembersCard() {
  const isOwner = useIsOwner();
  const members = useMembers();
  const hasPin = useQuery((s) => s.hasOwnerPin()).data ?? false;
  const [edit, setEdit] = useState<Membership | 'new' | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const coaches = members.filter((m) => m.seat !== 'OWNER').length;
  const full = coaches >= MAX_COACHES;

  return (
    <Card title={`멤버 (코치 ${coaches}/${MAX_COACHES})`}>
      {!isOwner && <p className="small muted">멤버 추가·수정·삭제와 PIN 은 구단주만 할 수 있어요.</p>}
      <ul className="list">
        {members.map((m) => (
          <li key={m.userId} className="list-row">
            <span>
              <strong>{memberText(m)}</strong>
              <span className="listing-meta">{m.seat === 'OWNER' ? `실행·승인 담당${hasPin ? ' · 🔒 PIN 켜짐' : ''}` : `제안: ${proposeAreaText(m)}`}</span>
            </span>
            {isOwner && (
              <button type="button" className="btn btn-secondary btn-sm" aria-label={`${m.name ?? memberRoleText(m)} 수정`} onClick={() => setEdit(m)}>
                수정
              </button>
            )}
          </li>
        ))}
      </ul>
      {isOwner && (
        <div className="btn-row">
          <button type="button" className="btn btn-primary" disabled={full} onClick={() => setEdit('new')}>
            코치 추가
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setPinOpen(true)}>
            {hasPin ? 'PIN 바꾸기·해제' : '구단주 PIN 설정'}
          </button>
        </div>
      )}
      {isOwner && full && <p className="small muted">코치는 최대 {MAX_COACHES}명이에요. 추가하려면 먼저 한 명을 내보내 주세요.</p>}
      {isOwner && <p className="small muted">새로 들어온 코치는 합류한 날 하루 동안 그날 경기 플랜을 볼 수 없어요.</p>}
      {edit && <MemberSheet key={edit === 'new' ? 'new' : edit.userId} target={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {pinOpen && <PinSheet hasPin={hasPin} onClose={() => setPinOpen(false)} />}
    </Card>
  );
}

function MemberSheet({ target, onClose }: { target: Membership | null; onClose: () => void }) {
  const snap = useGame();
  const { run, error } = useInlineAction();
  const owner = target?.seat === 'OWNER';
  const [name, setName] = useState(target?.name ?? '');
  const [role, setRole] = useState<RoleLabel>(target?.roleLabel ?? 'TAC');
  const [sub, setSub] = useState<RoleLabel | 'NONE'>(target?.subRole ?? 'NONE');
  const [emoji, setEmoji] = useState<string | null>(target?.emoji ?? null);
  const [confirmDel, setConfirmDel] = useState(false);
  const n = [...name.trim()].length;
  const nameBad = n < 1 || n > 12;
  const subRole = sub === 'NONE' || sub === role ? undefined : sub;

  const save = () => {
    const r = target
      ? run((s) => s.updateMember(target.userId, owner ? { name: name.trim(), ...(emoji ? { emoji } : {}) } : { name: name.trim(), role, subRole: subRole ?? null, ...(emoji ? { emoji } : {}) }), '멤버 정보를 고쳤어요')
      : run((s) => s.addMember(name.trim(), role, { ...(subRole ? { subRole } : {}), ...(emoji ? { emoji } : {}) }), `${name.trim()} 코치를 추가했어요`);
    if (r) onClose();
  };
  const remove = () => {
    if (!target) return;
    const ok = run((s) => {
      s.removeMember(target.userId);
      return true;
    }, `${target.name ?? '코치'} 코치를 내보냈어요`);
    if (ok) onClose();
  };

  return (
    <Sheet
      open
      title={target ? `${target.name ?? memberRoleText(target)} 수정` : '코치 추가'}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary btn-block" disabled={nameBad} onClick={save}>
          {target ? '저장' : '추가하기'}
        </button>
      }
    >
      <div className="form-stack">
        <label className="field">
          <span>이름 (1~12자)</span>
          <input value={name} maxLength={12} aria-invalid={(name !== '' && nameBad) || undefined} aria-describedby="member-name-count" onChange={(e) => setName(e.target.value)} placeholder="예: 민수" />
          <small id="member-name-count" className="muted">
            {n}/12
          </small>
        </label>
        {!owner && (
          <>
            <div className="field">
              <span>주 역할</span>
              <Segmented<RoleLabel> label="주 역할" size="sm" value={role} onChange={setRole} options={ROLE_ORDER.map((r) => ({ value: r, label: ROLE_SHORT[r] }))} />
              <small className="muted">
                {ROLE_NAME[role]} · 제안할 수 있는 것: {proposeAreaText({ seat: 'COACH', roleLabel: role, subRole })}
              </small>
            </div>
            <div className="field">
              <span>보조 역할 (선택)</span>
              <Segmented<RoleLabel | 'NONE'>
                label="보조 역할"
                size="sm"
                value={subRole ?? 'NONE'}
                onChange={setSub}
                options={[{ value: 'NONE' as const, label: '없음' }, ...ROLE_ORDER.filter((r) => r !== role).map((r) => ({ value: r, label: ROLE_SHORT[r] }))]}
              />
            </div>
          </>
        )}
        <div className="field">
          <span id="emoji-label">식별 이모지{target ? '' : ' (안 고르면 자동)'}</span>
          <div className="emoji-grid" role="radiogroup" aria-labelledby="emoji-label">
            {EMOJIS.map((e) => (
              <button key={e} type="button" role="radio" aria-checked={emoji === e} aria-label={`이모지 ${e}`} className={`emoji-opt ${emoji === e ? 'is-active' : ''}`} onClick={() => setEmoji(emoji === e && !target ? null : e)}>
                {e}
              </button>
            ))}
          </div>
        </div>
        <ErrorNote error={error} dev={snap.settings.devMode} />
        {target && !owner && (
          <div className="form-stack" role="group" aria-label="코치 내보내기">
            {!confirmDel ? (
              <button type="button" className="btn btn-danger" onClick={() => setConfirmDel(true)}>
                이 코치 내보내기
              </button>
            ) : (
              <>
                <p className="warn-line">⚠ {target.name ?? '이 코치'} 코치를 내보낼까요? 이 코치가 올린 대기 중 제안은 만료돼요. 활동 기록의 이름은 남아요.</p>
                <div className="btn-row">
                  <button type="button" className="btn btn-secondary" onClick={() => setConfirmDel(false)}>
                    취소
                  </button>
                  <button type="button" className="btn btn-danger" onClick={remove}>
                    내보내기 확정
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function PinSheet({ hasPin, onClose }: { hasPin: boolean; onClose: () => void }) {
  const snap = useGame();
  const { run, error } = useInlineAction();
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const ok = /^\d{4}$/.test(pin) && pin === again;
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 4);
  const set = () => {
    const r = run((s) => {
      s.setOwnerPin(pin);
      return true;
    }, '구단주 PIN 을 설정했어요. 구단주로 바꿀 때마다 물어볼게요');
    if (r) onClose();
  };
  const unset = () => {
    const r = run((s) => {
      s.setOwnerPin(null);
      return true;
    }, '구단주 PIN 을 해제했어요');
    if (r) onClose();
  };
  return (
    <Sheet
      open
      title={hasPin ? '구단주 PIN 바꾸기' : '구단주 PIN 설정'}
      onClose={onClose}
      footer={
        <div className="btn-row">
          {hasPin && (
            <button type="button" className="btn btn-secondary" onClick={unset}>
              PIN 해제
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={!ok} onClick={set}>
            {hasPin ? '새 PIN 저장' : 'PIN 설정'}
          </button>
        </div>
      }
    >
      <div className="form-stack">
        <p className="small muted">코치가 기기를 들고 있을 때 실수로 구단주로 바뀌지 않게 막아 줘요. 보안 잠금은 아니에요.</p>
        <label className="field">
          <span>새 PIN (숫자 4자리)</span>
          <input className="pin-input" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="new-password" value={pin} onChange={(e) => setPin(digits(e.target.value))} />
        </label>
        <label className="field">
          <span>한 번 더 입력</span>
          <input
            className="pin-input"
            type="password"
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            autoComplete="new-password"
            aria-invalid={(again.length === 4 && again !== pin) || undefined}
            aria-describedby="pin-again-hint"
            value={again}
            onChange={(e) => setAgain(digits(e.target.value))}
          />
          <small id="pin-again-hint" className={again.length === 4 && again !== pin ? 'neg' : 'muted'}>
            {again.length === 4 && again !== pin ? '⚠ 두 PIN 이 달라요' : '잊으면 세이브 내보내기 파일에서 ownerPin 을 지우고 다시 가져와요.'}
          </small>
        </label>
        <ErrorNote error={error} dev={snap.settings.devMode} />
      </div>
    </Sheet>
  );
}
