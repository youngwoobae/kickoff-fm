/** M7.4 최종 리뷰 회귀 (docs/코드리뷰_최종.md) */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clock } from '../helpers';
import { createGameService, createMemorySlotStorage, isGameError, type GameService } from '../../src/services';
import { packBody, unpackBody } from '../../src/services/idbStorage';
import { guardSlotOwner, type SlotChannel } from '../../src/ui/app/slotGuard';
import type { GameState } from '../../src/types';

/** 같은 저장소를 보는 두 창 + 서로 이어진 채널 */
function linkedChannels(): [SlotChannel, SlotChannel] {
  const mk = (): SlotChannel & { peer?: SlotChannel } => ({ onmessage: null, postMessage(m) { this.peer?.onmessage?.({ data: m } as MessageEvent); }, close() {} });
  const a = mk();
  const b = mk();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

const flushMicro = () => new Promise((r) => setTimeout(r, 0));

describe('F-M1 같은 슬롯을 두 창에서 열면 앞 창은 저장 후 닫는다', () => {
  it('뒤 창이 슬롯을 열면 앞 창 게임이 닫히고, 앞 창의 진행이 저장소에 남는다', async () => {
    const slots = createMemorySlotStorage();
    const a = createGameService({ slots, clock }) as GameService;
    const b = createGameService({ slots, clock }) as GameService;
    const [ca, cb] = linkedChannels();
    const taken: number[] = [];
    const offA = guardSlotOwner(a, ca, (id) => taken.push(id));
    const offB = guardSlotOwner(b, cb, () => undefined);

    a.newGame({ seed: 3, slotId: 1 });
    a.advanceDay();
    await a.flush();
    const day = a.getSnapshot()!.time.day;
    await b.openSlot(1);
    await flushMicro();
    expect(a.getSnapshot()).toBeNull();
    expect(taken).toEqual([1]);
    expect(b.getSnapshot()!.time.day).toBe(day);
    // 다른 슬롯은 건드리지 않는다
    a.newGame({ seed: 4, slotId: 2 });
    await flushMicro();
    expect(b.getSnapshot()).not.toBeNull();
    offA();
    offB();
  });
});

describe('F-M2 세이브 본문 압축 실패·해제 불가', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('압축이 실패해도 문자열로 저장한다 (자동 저장이 막히지 않음)', async () => {
    vi.stubGlobal(
      'CompressionStream',
      class {
        constructor() {
          throw new Error('boom');
        }
      },
    );
    expect(await packBody('{"a":1}')).toBe('{"a":1}');
  });

  it('바이트 본문인데 해제할 수 없으면 빈 슬롯(null)이 아니라 손상("")으로 알린다', async () => {
    const packed = await packBody('{"a":1}');
    vi.stubGlobal('DecompressionStream', undefined);
    expect(await unpackBody(packed)).toBe('');
  });
});

describe('F-m 가져오기 검증 보강', () => {
  const base = () => {
    const s = createGameService({ clock }) as GameService;
    s.newGame({ seed: 5 });
    return JSON.parse(s.exportSave()) as GameState;
  };
  const rejects = (mut: (x: GameState) => void): string | null => {
    const x = base();
    mut(x);
    try {
      (createGameService({ clock }) as GameService).importSave(JSON.stringify(x));
      return null;
    } catch (e) {
      return isGameError(e) ? e.code : String(e);
    }
  };

  it('정상 세이브는 통과', () => {
    expect(rejects(() => undefined)).toBeNull();
  });
  it('멤버 joinedAt 없음 → SAVE_INCOMPATIBLE', () => {
    expect(rejects((x) => delete (x.memberships[1] as Partial<GameState['memberships'][number]>).joinedAt)).toBe('SAVE_INCOMPATIBLE');
  });
  it('제안 카드 값이 객체가 아니거나 반응이 깨졌으면 → SAVE_INCOMPATIBLE', () => {
    expect(rejects((x) => ((x.proposals as Record<string, unknown>)['pr-x'] = null))).toBe('SAVE_INCOMPATIBLE');
    const deal = { id: 'dp-x', clubId: 'c', authorId: 'u', kind: 'RENEWAL', payload: { kind: 'RENEWAL', playerId: 'p', salary: 1000, seasons: 1 }, summary: 's', reason: 'r', reactions: [null], createdAt: { season: 1, day: 1, seq: 1 }, expiresAt: { season: 1, day: 2 }, status: 'OPEN' };
    expect(rejects((x) => (x.dealProposals = { 'dp-x': deal } as never))).toBe('SAVE_INCOMPATIBLE');
    expect(rejects((x) => (x.dealProposals = { 'dp-x': { ...deal, reactions: [], summary: { x: 1 } } } as never))).toBe('SAVE_INCOMPATIBLE');
    expect(rejects((x) => (x.dealProposals = { 'dp-x': { ...deal, reactions: [] } } as never))).toBeNull();
  });
});

describe('F-m 손상 슬롯 내보내기', () => {
  it('압축 본문이 깨진 슬롯은 빈 파일 대신 SAVE_INCOMPATIBLE', async () => {
    const slots = createMemorySlotStorage();
    const s = createGameService({ slots: { ...slots, read: async () => '' }, clock }) as GameService;
    await expect(s.exportSlot(1)).rejects.toMatchObject({ code: 'SAVE_INCOMPATIBLE' });
  });
});
