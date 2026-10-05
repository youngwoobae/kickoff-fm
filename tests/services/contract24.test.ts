/** 서비스 계약 2.4.0 (추가만): 2D 중계 큐(event·pitch·formations·starters·ballTrack), getBuildInfo, 도메인 조사 */
import { describe, expect, it } from 'vitest';
import { josa } from '../../src/domain/josa';
import { CONTRACT_VERSION, createGameService } from '../../src/services';
import type { MatchId } from '../../src/types';

const s = createGameService({ clock: { nowIso: () => '2026-10-05T00:00:00.000Z' } });
s.newGame({ seed: 24, startTier: 'T3' });
const ids: MatchId[] = [];
while (ids.length < 6) {
  const r = s.advanceDay();
  if (r.userMatchId) ids.push(r.userMatchId);
}

describe('계약 2.4.0', () => {
  it('getBuildInfo', () => {
    expect(s.getBuildInfo!()).toMatchObject({ contractVersion: CONTRACT_VERSION, engineVersion: s.getSnapshot()!.engineVersion, saveSchema: 3 });
    expect(typeof s.getBuildInfo!().app).toBe('string');
  });

  it('중계 줄의 event·pitch 가 리포트와 일치하고, 2D 보조 필드가 채워진다', () => {
    for (const id of ids) {
      const rp = s.getMatchReplay(id);
      const rep = s.getReport(id);
      // 카드: text 접두어 판정과 event 판정이 같다
      const byText = rp.lines.filter((l) => l.kind === 'CARD' && l.text.startsWith('경고')).length;
      expect(rp.lines.filter((l) => l.event === 'YELLOW_CARD')).toHaveLength(byText);
      // 골 줄 = 스코어, 모두 유효슈팅·공격 진영 큐
      const goals = rp.lines.filter((l) => l.event === 'GOAL');
      expect(goals).toHaveLength(rep.summary.goalsFor + rep.summary.goalsAgainst);
      for (const l of [...goals, ...rp.lines.filter((x) => x.event === 'SHOT')]) {
        expect(l.pitch).toMatchObject({ team: l.clubId === rp.homeId ? 'HOME' : 'AWAY', zone: expect.any(Number), lane: expect.stringMatching(/^[LCR]$/) });
        expect(l.pitch!.chance).toBeDefined();
        if (l.event === 'GOAL') expect(l.pitch!.onTarget).toBe(true);
      }
      // 필러는 event 없이 pitch 만, 카드·교체 줄은 pitch 없음
      for (const l of rp.lines) {
        if (l.kind === 'NEUTRAL') expect(l.event === undefined && l.pitch !== undefined).toBe(true);
        else expect(l.event).toBeDefined();
        if (l.kind === 'CARD' || l.kind === 'SUB') expect(l.pitch).toBeUndefined();
      }
      expect(rp.lines.at(-1)!.event).toBe('FULL_TIME');
      expect(rp.formations).toBeDefined();
      expect(rp.starters!.home).toHaveLength(11);
      expect(rp.starters!.away).toHaveLength(11);
      expect(rp.ballTrack!.length).toBeGreaterThan(0);
      expect(rp.ballTrack!.length).toBeLessThanOrEqual(300);
      // 조사: 공백 + 조사 분리 표기 없음
      for (const l of rp.lines) expect(l.text).not.toMatch(/ (가|의|는) /);
      expect(rp.lines.some((l) => l.text.includes('!!!'))).toBe(false);
    }
  });

  it('josa 받침 판정', () => {
    expect(josa('성수 유나이티드', '이/가')).toBe('성수 유나이티드가');
    expect(josa('서울 FC', '이/가')).toBe('서울 FC가');
    expect(josa('1.20M', '이/가')).toBe('1.20M이');
    expect(josa('김민준', '은/는')).toBe('김민준은');
  });
});
