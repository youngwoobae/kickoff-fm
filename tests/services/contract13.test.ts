/** 서비스 계약 1.3.0 (추가만): 경기 통계·추가시간·경고 타임라인·경기 흐름 막대·스타일 행렬·적합도·상성 수치 */
import { describe, expect, it } from 'vitest';
import { clock } from '../helpers';
import { STYLE_IDS } from '../../src/engine';
import { createGameService, createMemoryStorage, type GameService } from '../../src/services';
import type { MatchId } from '../../src/types';

const mk = (seed: number): GameService => {
  const s = createGameService({ storage: createMemoryStorage(), clock });
  s.newGame({ seed, startTier: 'T3' }); // 시드별 기대값이 T3 사람 스쿼드 기준
  return s;
};

/** 사용자 경기 n 개를 치른 서비스와 그 경기 id */
function played(seed: number, n: number): { s: GameService; ids: MatchId[] } {
  const s = mk(seed);
  const ids: MatchId[] = [];
  while (ids.length < n) {
    const r = s.advanceDay();
    if (r.userMatchId) ids.push(r.userMatchId);
  }
  return { s, ids };
}

describe('서비스 계약 1.3.0', () => {
  const { s, ids } = played(3, 8);
  const snap = s.getSnapshot()!;

  it('① ReportSummary·TeamSummaryLite 에 유효슈팅·코너·경고·시간 점유가 채워지고 두 경로가 일치', () => {
    for (const id of ids) {
      const r = s.getReport(id);
      const sm = r.summary;
      const lite = snap.summaries[id]!;
      const [us, them] = sm.isHome ? [lite.home, lite.away] : [lite.away, lite.home];
      expect(sm.shotsOnTargetFor).toBe(us.shotsOnTarget);
      expect(sm.shotsOnTargetAgainst).toBe(them.shotsOnTarget);
      expect(sm.cornersFor).toBe(us.corners);
      expect(sm.cornersAgainst).toBe(them.corners);
      expect(sm.yellowCardsFor).toBe(us.yellowCards);
      expect(sm.yellowCardsAgainst).toBe(them.yellowCards);
      expect(sm.possessionTime).toBe(us.possessionTime);
      expect(sm.shotsOnTargetFor!).toBeGreaterThanOrEqual(sm.goalsFor);
      expect(sm.shotsOnTargetFor!).toBeLessThanOrEqual(sm.shotsFor);
      expect(sm.possessionTime!).toBeGreaterThan(0);
      expect(sm.possessionTime!).toBeLessThan(1);
      expect(us.possessionTime! + them.possessionTime!).toBeCloseTo(1, 2);
    }
  });

  it('② TimelineItem·CommentaryLine 에 addedMinute 가 전달된다 (45+N / 90+N)', () => {
    let tl = 0;
    let lines = 0;
    for (const id of ids) {
      for (const t of s.getReport(id).timeline) {
        if (t.addedMinute === undefined) continue;
        tl += 1;
        expect([45, 90]).toContain(t.minute);
        expect(t.addedMinute).toBeGreaterThan(0);
      }
      for (const l of s.getMatchReplay(id).lines) {
        if (l.addedMinute === undefined) continue;
        lines += 1;
        expect([45, 90]).toContain(l.minute);
        expect(l.addedMinute).toBeGreaterThan(0);
      }
    }
    expect(lines).toBeGreaterThan(0);
  });

  it('③ 타임라인에 YELLOW_CARD 가 포함되고 수가 요약·중계와 일치', () => {
    let total = 0;
    for (const id of ids) {
      const r = s.getReport(id);
      const yl = r.timeline.filter((t) => t.kind === 'YELLOW_CARD');
      total += yl.length;
      expect(yl.filter((t) => t.clubId === r.clubId)).toHaveLength(r.summary.yellowCardsFor!);
      expect(yl.filter((t) => t.clubId === r.opponentId)).toHaveLength(r.summary.yellowCardsAgainst!);
      const replayYellows = s.getMatchReplay(id).lines.filter((l) => l.kind === 'CARD' && l.text.startsWith('경고'));
      expect(replayYellows).toHaveLength(yl.length);
    }
    expect(total).toBeGreaterThan(0);
  });

  it('④ factorBars.state (경기 흐름) 가 리포트에 복사된다', () => {
    let nonZero = 0;
    for (const id of ids) {
      const b = s.getReport(id).factorBars;
      expect(typeof b.state).toBe('number');
      if (b.state !== 0) nonZero += 1;
      expect(s.resimulate(id).factorBars.state).toBe(b.state);
    }
    expect(nonZero).toBeGreaterThan(0);
  });
});

describe('서비스 계약 1.3.0: 개발자·전술 화면', () => {
  it('⑤ runCalibration(STYLE_MATRIX) → details.counterMatrix 9×9 (us, them, winPct, lossPct %)', async () => {
    const s = mk(1);
    const rep = await s.runCalibration({ matchesPerScenario: 20, tacCap: 0.7, seed: 7, scenarios: ['STYLE_MATRIX'] });
    const cells = rep.details?.counterMatrix;
    expect(cells).toHaveLength(81);
    for (const a of STYLE_IDS) for (const b of STYLE_IDS) expect(cells!.some((c) => c.us === a && c.them === b)).toBe(true);
    for (const c of cells!) {
      expect(Object.keys(c).sort()).toEqual(['lossPct', 'them', 'us', 'winPct']);
      expect(c.winPct + c.lossPct).toBeLessThanOrEqual(100.01);
      expect(c.winPct).toBeGreaterThanOrEqual(0);
    }
    // 대칭: (a,b) 승률 = (b,a) 패율
    const at = (a: string, b: string) => cells!.find((c) => c.us === a && c.them === b)!;
    expect(at('HIGH_PRESS', 'BALANCED').winPct).toBeCloseTo(at('BALANCED', 'HIGH_PRESS').lossPct, 1);
    // 다른 시나리오만 돌리면 details 없음
    const other = await s.runCalibration({ matchesPerScenario: 20, tacCap: 0.7, seed: 7, scenarios: ['BASELINE'] });
    expect(other.details).toBeUndefined();
  }, 60_000);

  it('⑥ StyleFit: 요구치 미달 항목이 있으면 fit ≥ 0.95 여도 GOOD 이 아니다 (최대 OK)', () => {
    const fits = mk(1).getStyleFits!();
    const near = fits.filter((f) => f.fit >= 0.95 && f.fit < 1);
    expect(near.length).toBeGreaterThan(0); // 시드 1: LOW_BLOCK 0.969 등
    for (const f of near) {
      expect(f.missing.length).toBeGreaterThan(0);
      expect(f.level).toBe('OK');
    }
    for (const f of fits) if (f.level === 'GOOD') expect(f.missing).toHaveLength(0);
  });

  it('⑦ getMatchupPreview: 규칙 reason 에 관련 수치 ("A vs B") 가 들어간다', () => {
    const s = mk(5);
    const me = s.getSnapshot()!.userClubId;
    const opponents = Object.keys(s.getSnapshot()!.clubs).filter((c) => c !== me);
    const withNumbers = new Set(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R11', 'R13', 'LINE_FIT']);
    const seen = new Set<string>();
    for (const style of STYLE_IDS) {
      s.applyStyle!('A', style, 'FULL');
      for (const opp of opponents) {
        for (const h of s.getMatchupPreview!('A', opp).rules) {
          seen.add(h.id);
          if (withNumbers.has(h.id) || h.reason.includes('속도')) expect(h.reason, `${h.id}: ${h.reason}`).toMatch(/\d+(\.\d)? vs \D{0,12}\d+/);
        }
      }
    }
    expect([...seen].filter((id) => withNumbers.has(id)).length).toBeGreaterThanOrEqual(4);
  });
});
