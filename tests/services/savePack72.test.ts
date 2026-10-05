/** M7.2: IndexedDB 세이브 본문 gzip (packBody/unpackBody) */
import { describe, expect, it } from 'vitest';
import { packBody, unpackBody } from '../../src/services/idbStorage';

describe('세이브 본문 압축 (M7.2)', () => {
  it('왕복 동일·작아짐, 이전 문자열 세이브는 그대로, 깨진 바이트는 빈 문자열, 그 밖은 null', async () => {
    const json = JSON.stringify({ players: Array.from({ length: 2000 }, (_, i) => ({ id: `p${i}`, name: '한진겸', ovr: i % 90, attrs: { passing: 5, pace: 9 } })) });
    const packed = await packBody(json);
    expect(packed).toBeInstanceOf(Uint8Array);
    expect((packed as Uint8Array).length).toBeLessThan(json.length / 5);
    expect(await unpackBody(packed)).toBe(json);
    expect(await unpackBody(json)).toBe(json);
    expect(await unpackBody(new Uint8Array([1, 2, 3, 4]))).toBe('');
    expect(await unpackBody(undefined)).toBeNull();
    expect(await unpackBody(42)).toBeNull();
  });
});
