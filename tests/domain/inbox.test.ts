/** M4.2 받은 편지함 도메인 (D27 보관, id 규칙, 사건 → 편지) */
import { describe, expect, it } from 'vitest';
import { INBOX, appendInbox, contractDraft, inboxId, lifecycleDraft, pruneInbox, type InboxDraft } from '../../src/domain/inbox/inbox';
import type { InboxMessage } from '../../src/types';

const ctx = { userClubId: 'me', nameOf: (id: string) => (id === 'p1' ? '김철수' : undefined) };
const draft: InboxDraft = { kind: 'GENERAL', title: 't', body: 'b' };

describe('사건 → 편지', () => {
  it('수명주기: 사람 구단만, 편지 대상만', () => {
    expect(lifecycleDraft({ kind: 'RETIRE_ANNOUNCED', playerId: 'p1', clubId: 'me' }, ctx)).toMatchObject({ kind: 'RETIREMENT_NOTICE', playerId: 'p1', clubId: 'me', title: '김철수 은퇴 예고' });
    expect(lifecycleDraft({ kind: 'RETIRE_ANNOUNCED', playerId: 'p1', clubId: 'ai' }, ctx)).toBeNull();
    expect(lifecycleDraft({ kind: 'YOUTH_OFFERED', clubId: 'me', count: 4 }, ctx)?.kind).toBe('YOUTH_INTAKE');
    expect(lifecycleDraft({ kind: 'YOUTH_PROMOTED', playerId: 'p1', clubId: 'me', auto: true }, ctx)?.kind).toBe('YOUTH_AUTO_DECIDED');
    expect(lifecycleDraft({ kind: 'YOUTH_PROMOTED', playerId: 'p1', clubId: 'me', auto: false }, ctx)).toBeNull();
    expect(lifecycleDraft({ kind: 'YELLOW_WARNING', playerId: 'p1' }, ctx)?.kind).toBe('DISCIPLINE_WARNING');
    expect(lifecycleDraft({ kind: 'SUSPENDED_ACCUM', playerId: 'p2' }, ctx)).toMatchObject({ kind: 'SUSPENDED', title: 'p2 출장 정지' });
    expect(lifecycleDraft({ kind: 'GREW', playerId: 'p1', attrs: { pace: 1 } }, ctx)).toBeNull();
    expect(lifecycleDraft({ kind: 'FA_RETIRED', playerId: 'p1' }, ctx)).toBeNull();
  });
  it('계약 사건', () => {
    expect(contractDraft({ kind: 'RENEWAL_OPEN', clubId: 'me', playerIds: ['a', 'b'] }, ctx)?.body).toContain('2명');
    expect(contractDraft({ kind: 'RENEWAL_OPEN', clubId: 'me', playerIds: [] }, ctx)).toBeNull();
    expect(contractDraft({ kind: 'CONTRACT_EXPIRED', playerId: 'p1', clubId: 'me' }, ctx)?.kind).toBe('CONTRACT_EXPIRED');
    expect(contractDraft({ kind: 'PLAYER_RELEASED', playerId: 'p1', clubId: 'me', penalty: 2_518_000, exempt: false }, ctx)?.body).toContain('2.52M');
    expect(contractDraft({ kind: 'PLAYER_RELEASED', playerId: 'p1', clubId: 'me', penalty: 0, exempt: true }, ctx)?.body).toContain('위약금 없이');
    expect(contractDraft({ kind: 'RENEWED', playerId: 'p1', clubId: 'me', salary: 1, seasons: 1 }, ctx)).toBeNull();
    expect(contractDraft({ kind: 'CONTRACT_EXPIRED', playerId: 'p1', clubId: 'ai' }, ctx)).toBeNull();
  });
});

describe('id·보관 (D27)', () => {
  it('id = s{season}-d{day}-{kind}-{n}, 같은 날 같은 종류는 n 증가, null 초안 무시', () => {
    let box = appendInbox([], [draft, null, draft], 2, 5);
    box = appendInbox(box, [draft], 2, 5);
    expect(box.map((m) => m.id)).toEqual(['s2-d5-GENERAL-0', 's2-d5-GENERAL-1', 's2-d5-GENERAL-2']);
    expect(box.every((m) => !m.read && m.season === 2 && m.day === 5)).toBe(true);
    expect(inboxId(1, 28, 'BID_WON', 0)).toBe('s1-d28-BID_WON-0');
  });
  it('84일(3시즌) 이상 지난 편지 삭제, 경계 83일은 유지', () => {
    const m = (season: number, day: number): InboxMessage => ({ id: `${season}-${day}`, season, day, kind: 'GENERAL', title: '', body: '', read: true });
    const box = [m(1, 1), m(1, 2), m(3, 28)];
    // now = s4 d1 → 절대일 85. s1d1(1) = 84일 지남 → 삭제, s1d2(2) = 83일 → 유지
    expect(pruneInbox(box, 4, 1).map((x) => x.id)).toEqual(['1-2', '3-28']);
  });
  it('개수 상한: 오래된 것부터', () => {
    const box = appendInbox([], Array.from({ length: INBOX.maxMessages + 5 }, () => draft), 1, 1);
    expect(box).toHaveLength(INBOX.maxMessages);
    expect(box[0]!.id).toBe('s1-d1-GENERAL-5');
  });
});
