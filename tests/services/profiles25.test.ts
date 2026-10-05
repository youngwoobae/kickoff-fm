/** 계약 2.5.0: 로컬 프로필(한 기기 핫시트) — 멤버 관리·전환·역할별 제안 영역·제안 작성자·이적/재계약 제안·구단주 PIN·이전 세이브 */
import { describe, expect, it } from 'vitest';
import { clock } from '../helpers';
import { createGameService, createMemoryStorage, isGameError, type GameService } from '../../src/services';
import type { GameErrorCode, GameState } from '../../src/types';

type Svc = Required<GameService>;
const mk = (seed = 7): Svc => {
  const s = createGameService({ storage: createMemoryStorage(), clock }) as Svc;
  s.newGame({ seed });
  return s;
};
const snap = (s: Svc) => s.getSnapshot()! as GameState;

function fail(fn: () => unknown): { code: GameErrorCode; details: readonly string[] } | null {
  try {
    fn();
  } catch (e) {
    if (isGameError(e)) return { code: e.code, details: e.details };
    throw e;
  }
  return null;
}

function goTo(s: Svc, season: number, day: number): void {
  for (let i = 0; i < 200; i++) {
    const t = snap(s).time;
    if (t.season === season && t.day === day && snap(s).phase !== 'SEASON_OVER') return;
    if (snap(s).phase === 'SEASON_OVER') s.startNewSeason();
    else s.advanceDay();
  }
  throw new Error(`도달 실패 ${season}/${day}`);
}

/** 다음 경기 id (getPlanState 기준) */
const nextMatch = (s: Svc) => s.getPlanState().matchId!;

describe('멤버 관리 (2.5.0)', () => {
  it('새 게임 기본 멤버 = 구단주 + 전술 코치, 표시 필드 채움', () => {
    const s = mk();
    const ms = s.listMembers();
    expect(ms.map((m) => m.seat)).toEqual(['OWNER', 'COACH']);
    expect(ms[0]).toMatchObject({ name: '구단주', emoji: '👑' });
    expect(ms[1]).toMatchObject({ name: '전술 코치', roleLabel: 'TAC' });
    expect(s.getActor()).toMatchObject({ seat: 'OWNER', name: '구단주' });
  });

  it('추가·수정·제거, 코치 최대 5명, 구단주만 관리', () => {
    const s = mk();
    const a = s.addMember('민지', 'FIN', { subRole: 'SCT' });
    expect(a).toMatchObject({ seat: 'COACH', roleLabel: 'FIN', subRole: 'SCT', name: '민지' });
    expect(a.emoji).not.toBe(s.listMembers()[1]!.emoji); // 안 쓰는 색 자동
    expect(fail(() => s.addMember(' ', 'TAC'))!.code).toBe('INVALID_MEMBER');
    expect(fail(() => s.addMember('너무너무너무너무긴이름이에요', 'TAC'))!.code).toBe('INVALID_MEMBER');
    expect(fail(() => s.addMember('x', 'XXX' as never))!.code).toBe('INVALID_MEMBER');
    expect(fail(() => s.addMember('x', 'TAC', { subRole: 'TAC' }))!.code).toBe('INVALID_MEMBER');
    s.addMember('c3', 'SQD');
    s.addMember('c4', 'ANL');
    s.addMember('c5', 'SCT');
    expect(fail(() => s.addMember('c6', 'TAC'))!.code).toBe('INVALID_MEMBER');
    expect(s.listMembers()).toHaveLength(6);

    const u = s.updateMember(a.userId, { name: '민지2', role: 'SCT', emoji: '🟨' });
    expect(u).toMatchObject({ name: '민지2', roleLabel: 'SCT', emoji: '🟨' });
    expect(u.subRole).toBeUndefined(); // 보조 역할을 주 역할로 올리면 보조 해제
    expect(s.updateMember(a.userId, { subRole: 'FIN' }).subRole).toBe('FIN');
    expect(s.updateMember(a.userId, { subRole: null }).subRole).toBeUndefined();
    const owner = s.listMembers()[0]!;
    expect(s.updateMember(owner.userId, { name: '사장님', role: 'TAC' })).toMatchObject({ name: '사장님', seat: 'OWNER' });
    expect(s.updateMember(owner.userId, {}).roleLabel).toBeUndefined();
    expect(fail(() => s.removeMember(owner.userId))!.code).toBe('INVALID_MEMBER');

    s.switchMember(a.userId);
    expect(fail(() => s.addMember('x', 'TAC'))).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(fail(() => s.removeMember(a.userId))).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(fail(() => s.setOwnerPin('1234'))).toMatchObject({ code: 'PERMISSION_DENIED' });
    s.switchMember(owner.userId);
    s.removeMember(a.userId);
    expect(s.listMembers()).toHaveLength(5);
    expect(snap(s).actionLog.filter((e) => e.kind.startsWith('MEMBER_')).map((e) => e.kind)).toContain('MEMBER_REMOVED');
  });

  it('전환·로그 작성자 이름, switchRole 호환', () => {
    const s = mk();
    const c = s.addMember('지훈', 'ANL');
    expect(s.switchMember(c.userId)).toMatchObject({ userId: c.userId, name: '지훈' });
    expect(s.getActor()).toMatchObject({ userId: c.userId, seat: 'COACH', name: '지훈' });
    const last = snap(s).actionLog.at(-1)!;
    expect(last).toMatchObject({ kind: 'ROLE_SWITCHED', actor: c.userId, actorName: '지훈' });
    expect(s.switchRole('OWNER').seat).toBe('OWNER');
    expect(s.switchRole('COACH').userId).toBe('u-coach'); // 첫 코치
    expect(fail(() => s.switchMember('nobody'))!.code).toBe('NOT_FOUND');
  });
});

describe('역할별 제안 영역·작성자 (2.5.0)', () => {
  it('플랜 제안: 전술·분석·선수단 가능, 스카우트·재정은 ROLE_AREA. 작성자 이름·반응자 이름 기록', () => {
    const s = mk();
    const fin = s.addMember('재정', 'FIN');
    const anl = s.addMember('분석', 'ANL');
    const mid = nextMatch(s);
    s.switchMember(fin.userId);
    expect(fail(() => s.propose({ payload: { kind: 'PLAN_CHANGE', matchId: mid, patch: { startSlot: 'B' } }, reason: '수비' }))).toEqual({ code: 'PERMISSION_DENIED', details: ['ROLE_AREA'] });
    s.switchMember(anl.userId);
    const p = s.propose({ payload: { kind: 'PLAN_CHANGE', matchId: mid, patch: { startSlot: 'B' } }, reason: '수비' });
    expect(p).toMatchObject({ authorId: anl.userId, authorRole: 'ANL', authorName: '분석', authorEmoji: anl.emoji });
    s.switchMember('u-coach');
    const r = s.react(p.id, 'FOR', '동의');
    expect(r.reactions[0]).toMatchObject({ userId: 'u-coach', name: '전술 코치', choice: 'FOR' });
    expect(snap(s).actionLog.at(-1)).toMatchObject({ kind: 'PROPOSAL_REACTED', actorName: '전술 코치' });
    // 보조 역할 영역도 쓴다: 재정 + 보조 전술
    s.switchRole('OWNER');
    s.updateMember(fin.userId, { subRole: 'TAC' });
    s.switchMember(fin.userId);
    expect(s.propose({ payload: { kind: 'PLAN_CHANGE', matchId: mid, patch: { instructions: { slot: 'A', patch: { press: 2 } } } }, reason: '압박' }).authorName).toBe('재정');
  });

  it('제거된 코치의 미결 제안은 EXPIRED', () => {
    const s = mk();
    const c = s.addMember('떠남', 'TAC');
    const mid = nextMatch(s);
    s.switchMember(c.userId);
    expect(fail(() => s.getPlanState())!.details).toEqual(['NEW_COACH_LOCK']); // 합류 첫날 (5.0.3)
    const p = s.propose({ payload: { kind: 'PLAN_CHANGE', matchId: mid, patch: { startSlot: 'B' } }, reason: 'x' });
    s.switchRole('OWNER');
    s.removeMember(c.userId);
    expect(snap(s).proposals[p.id]).toMatchObject({ status: 'EXPIRED', authorName: '떠남' });
  });
});

describe('이적·재계약 제안 (2.5.0)', () => {
  it('이적 입찰: 스카우트 제안 → 전술 코치 거부(ROLE_AREA) → 구단주 승인 = 구단주 명의 입찰', () => {
    const s = mk();
    goTo(s, 1, 11);
    const sct = s.addMember('스카', 'SCT');
    const cheap = [...s.listTransferListings({ kind: 'NPC' })].sort((a, b) => a.minPrice - b.minPrice)[0]!;
    const input = { payload: { kind: 'TRANSFER_BID' as const, bid: { listingId: cheap.id, fee: cheap.minPrice } }, reason: '싸고 좋아요' };
    s.switchRole('COACH'); // TAC
    expect(fail(() => s.proposeDeal(input))!.details).toEqual(['ROLE_AREA']);
    s.switchMember(sct.userId);
    expect(fail(() => s.proposeDeal({ ...input, payload: { kind: 'TRANSFER_BID', bid: { listingId: cheap.id, fee: cheap.maxPrice * 10 } } }))!.code).toBe('BID_OUT_OF_RANGE'); // 제안 때도 검증
    const d = s.proposeDeal(input);
    expect(d).toMatchObject({ kind: 'TRANSFER_BID', status: 'OPEN', authorId: sct.userId, authorName: '스카', authorRole: 'SCT' });
    expect(d.summary).toContain('이적료');
    expect(fail(() => s.proposeDeal(input))!.code).toBe('PROPOSAL_DUPLICATE');
    expect(fail(() => s.approveDeal(d.id))!.code).toBe('PERMISSION_DENIED');
    expect(s.listBids()).toHaveLength(0);
    s.switchRole('OWNER');
    const r = s.approveDeal(d.id);
    expect(r.ok).toBe(true);
    expect(s.listBids()).toEqual([expect.objectContaining({ listingId: cheap.id, fee: cheap.minPrice })]);
    expect(s.listDealProposals({ status: 'APPROVED' })).toHaveLength(1);
    const log = snap(s).actionLog;
    expect(log.find((e) => e.kind === 'BID_PLACED')).toMatchObject({ actor: 'u-owner' });
    expect(fail(() => s.approveDeal(d.id))!.code).toBe('PROPOSAL_NOT_OPEN');
  });

  it('재계약: 재정 코치 제안, 낮은 연봉이면 승인 = STALE, 하루 지나면 만료', () => {
    const s = mk();
    goTo(s, 1, 20);
    const fin = s.addMember('재정', 'FIN');
    const p = s.getSquad().find((x) => x.contract.seasonsLeft === 1 && !x.isTemporary && !x.retiring)!;
    const q = s.getRenewalQuote(p.id);
    s.switchMember(fin.userId);
    const low = s.proposeDeal({ payload: { kind: 'RENEWAL', playerId: p.id, salary: 1, seasons: 1 }, reason: '아껴요' });
    s.switchRole('OWNER');
    const r = s.approveDeal(low.id);
    expect(r.ok).toBe(false);
    expect(r.proposal.status).toBe('STALE');
    expect(snap(s).pendingRenewals?.some((x) => x.playerId === p.id) ?? false).toBe(false);

    s.switchMember(fin.userId);
    const ok = s.proposeDeal({ payload: { kind: 'RENEWAL', playerId: p.id, salary: q.askSalary, seasons: 1 }, reason: '핵심 선수' });
    const stay = s.proposeDeal({ payload: { kind: 'RENEWAL', playerId: s.getSquad().find((x) => x.contract.seasonsLeft === 1 && x.id !== p.id && !x.isTemporary && !x.retiring)?.id ?? p.id, salary: 10_000_000, seasons: 1 }, reason: '만료 확인' });
    s.switchRole('OWNER');
    expect(s.approveDeal(ok.id).ok).toBe(true);
    expect(snap(s).pendingRenewals!.some((x) => x.playerId === p.id)).toBe(true);
    s.advanceDay();
    expect(snap(s).dealProposals![stay.id]!.status).toBe('EXPIRED');
  });

  it('미결 제안 5장은 플랜·이적·재계약 합산', () => {
    const s = mk();
    goTo(s, 1, 20);
    const fin = s.addMember('재정', 'FIN', { subRole: 'TAC' });
    const mid = nextMatch(s);
    s.switchMember(fin.userId);
    s.propose({ payload: { kind: 'PLAN_CHANGE', matchId: mid, patch: { startSlot: 'B' } }, reason: '1' });
    const expiring = s.getSquad().filter((x) => x.contract.seasonsLeft === 1 && !x.isTemporary && !x.retiring);
    let n = 1;
    for (const p of expiring) {
      if (n >= 5) break;
      s.proposeDeal({ payload: { kind: 'RENEWAL', playerId: p.id, salary: 1_000_000, seasons: 1 }, reason: String(n) });
      n++;
    }
    expect(n).toBe(5); // 시드 7: 만료 선수 4명 이상
    expect(fail(() => s.propose({ payload: { kind: 'PLAN_CHANGE', matchId: mid, patch: { instructions: { slot: 'A', patch: { press: 2 } } } }, reason: '6' }))!.code).toBe('PROPOSAL_LIMIT');
  });
});

describe('구단주 PIN (2.5.0)', () => {
  it('해시만 저장, 전환 보호, 해제', () => {
    const s = mk();
    expect(s.hasOwnerPin()).toBe(false);
    expect(fail(() => s.setOwnerPin('12a4'))!.code).toBe('INVALID_MEMBER');
    s.setOwnerPin('4321');
    expect(s.hasOwnerPin()).toBe(true);
    const saved = JSON.stringify(snap(s));
    expect(saved).not.toContain('"4321"');
    expect(snap(s).ownerPin!.hash).toMatch(/^[0-9a-f]{16}$/);
    s.switchRole('COACH');
    expect(fail(() => s.switchRole('OWNER'))).toEqual({ code: 'PERMISSION_DENIED', details: ['PIN_REQUIRED'] });
    expect(fail(() => s.switchMember('u-owner'))!.details).toEqual(['PIN_REQUIRED']);
    expect(fail(() => s.switchMember('u-owner', '0000'))!.details).toEqual(['PIN_WRONG']);
    expect(s.getActor().seat).toBe('COACH');
    expect(s.switchMember('u-owner', '4321').seat).toBe('OWNER');
    s.switchRole('COACH'); // 코치 쪽 전환은 PIN 불필요
    s.switchMember('u-owner', '4321');
    // 내보내기·가져오기 후에도 같은 PIN
    const json = s.exportSave();
    const t = createGameService({ storage: createMemoryStorage(), clock }) as Svc;
    t.importSave(json);
    t.switchRole('COACH');
    expect(fail(() => t.switchMember('u-owner', '1111'))!.details).toEqual(['PIN_WRONG']);
    // 잊었을 때: 내보낸 JSON 에서 ownerPin 을 지우고 가져오기
    const raw = JSON.parse(t.exportSave());
    delete raw.ownerPin;
    t.importSave(JSON.stringify(raw));
    expect(t.hasOwnerPin()).toBe(false);
    expect(t.switchRole('OWNER').seat).toBe('OWNER');
    t.setOwnerPin('1111');
    t.setOwnerPin(null);
    expect(t.hasOwnerPin()).toBe(false);
  });
});

describe('세이브 호환·검증 (2.5.0)', () => {
  it('이전 세이브(멤버 표시 필드·dealProposals 없음)는 기본값으로 읽힌다', () => {
    const s = mk();
    const raw = JSON.parse(s.exportSave());
    for (const m of raw.memberships) {
      delete m.name;
      delete m.emoji;
    }
    delete raw.dealProposals;
    delete raw.ownerPin;
    s.importSave(JSON.stringify(raw));
    expect(s.listMembers().map((m) => m.name)).toEqual(['구단주', '전술 코치']);
    expect(s.listDealProposals()).toEqual([]);
  });

  it('깨진 멤버 필드는 SAVE_INCOMPATIBLE', () => {
    const s = mk();
    const base = () => JSON.parse(s.exportSave());
    const bad: ((r: Record<string, any>) => void)[] = [
      (r) => r.memberships.push({ ...r.memberships[0], userId: 'u-x' }), // 구단주 2명
      (r) => (r.memberships[1].roleLabel = 'BOSS'),
      (r) => (r.memberships[1].subRole = r.memberships[1].roleLabel),
      (r) => (r.memberships[1].name = ''),
      (r) => r.memberships.push({ ...r.memberships[1] }), // userId 중복
      (r) => {
        for (let i = 0; i < 5; i++) r.memberships.push({ ...r.memberships[1], userId: `u-z${i}` }); // 코치 6명
      },
      (r) => (r.ownerPin = { salt: 'a', hash: '1234' }), // 평문 같은 값
      (r) => (r.dealProposals = { x: { id: 'x' } }),
    ];
    for (const f of bad) {
      const r = base();
      f(r);
      expect(fail(() => s.importSave(JSON.stringify(r)))?.code).toBe('SAVE_INCOMPATIBLE');
    }
  });
});
