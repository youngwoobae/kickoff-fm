/** 엔진 0.4.0~0.5.0 (실축구_전술설계) 게이트: 규칙 단위, 표시 RNG 분리, 스타일·역할 데이터, 세이브 마이그레이션, 서비스 계약 */
import { describe, expect, it } from 'vitest';
import {
  EngineConstants,
  FORMATIONS,
  ROLES,
  ROLE_IDS,
  STYLES,
  STYLE_IDS,
  STYLE_MATRIX_EXPECTED,
  centralDiff,
  evalBinaryRules,
  paceMult,
  simulateMatch,
} from '../../src/engine';
import { migrateSave, runCalibration, staticView } from '../../src/domain';
import { createGameService, createMemoryStorage } from '../../src/services';
import type { EngineConfig, EnginePlayer, TeamInstructions } from '../../src/types';
import { config, makeTeam, play } from '../helpers';

const NEUTRAL: TeamInstructions = { mentality: 0, press: 0, line: 0, width: 0, tempo: 0, directness: 0, counter: false, offsideTrap: false };
const CFG: EngineConfig = config({ tacCap: 0.7 });

describe('데이터: 스타일 9 · 역할 28 · 포메이션 9', () => {
  it('스타일마다 역할 11개가 권장 포메이션 슬롯 허용 역할 안에 있다', () => {
    expect(STYLE_IDS).toHaveLength(9);
    for (const id of STYLE_IDS) {
      const s = STYLES[id];
      const f = FORMATIONS[s.formation];
      expect(s.roles).toHaveLength(11);
      s.roles.forEach((r, i) => expect(f.slots[i]!.allowedRoles, `${id} ${i} ${r}`).toContain(r));
      expect(s.goodAgainst.length + s.badAgainst.length).toBeGreaterThan(0);
    }
  });

  it('역할 28종 모두 설명(effect)이 있고, 3·5백 FB 슬롯은 수비형·윙백만 허용', () => {
    expect(ROLE_IDS).toHaveLength(28);
    for (const r of ROLE_IDS) expect(ROLES[r].effect, r).toBeTruthy();
    for (const f of Object.values(FORMATIONS)) {
      for (const s of f.slots) {
        if (s.position !== 'FB') continue;
        if (f.backLine === 4) expect(s.allowedRoles).toContain('FB_INVERTED');
        else expect(s.allowedRoles).toEqual(['FB_DEFENSIVE', 'WB_WINGBACK']);
      }
    }
  });

  it('설계 상성 행렬은 반대칭', () => {
    for (const a of STYLE_IDS) for (const b of STYLE_IDS) expect(STYLE_MATRIX_EXPECTED[a][b] + STYLE_MATRIX_EXPECTED[b][a]).toBe(0);
  });
});

describe('규칙 단위 (0.4.0)', () => {
  it('R7: 중립 지시·기본 역할 4-4-2 vs 4-3-3 DP2 원기여 — 0.6.0 와이드 MF 중앙 합류(cA 0.6)로 두 포메이션 중앙 기여가 비슷하다 (차 ≤ 0.1, 각 0 < r ≤ 0.3)', () => {
    const a = staticView('a', { formation: '4-4-2', instructions: NEUTRAL });
    const b = staticView('b', { formation: '4-3-3', instructions: NEUTRAL });
    const r442 = evalBinaryRules('DP2', a, b, { zone: 1 }, CFG).R7 ?? 0;
    const r433 = evalBinaryRules('DP2', b, a, { zone: 1 }, CFG).R7 ?? 0;
    // 0.5.0 은 4-4-2 −0.03 / 4-3-3 +0.21 로 4-4-2 vs 4-3-3 |승−패| 16.5 (시뮬레이션_검증.md 5장). 0.6.0: 약 +0.28 / +0.21
    expect(r442).toBeGreaterThan(0);
    expect(r433).toBeGreaterThan(0);
    expect(Math.max(r442, r433)).toBeLessThanOrEqual(0.3);
    expect(Math.abs(r442 - r433)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(centralDiff(a, b) - centralDiff(b, a))).toBeLessThanOrEqual(0.5);
    // 패스 길게면 R7 미발동 (중원을 건너뛴다)
    const direct = staticView('d', { formation: '4-4-2', instructions: { ...NEUTRAL, directness: 1 } });
    expect(evalBinaryRules('DP2', direct, b, { zone: 1 }, CFG).R7).toBeUndefined();
  });

  it('R2 paceMult: 러너 − 최저 CB 속도 4 당 ±1, [0.3, 1.6] 에서 자른다', () => {
    const pl = (pace: number): EnginePlayer => ({
      id: `p${pace}`,
      name: '',
      attrs: { passing: 12, dribbling: 12, finishing: 12, crossing: 12, tackling: 12, vision: 12, positioning: 12, composure: 12, workRate: 12, pace, stamina: 12, physical: 12, reflexes: 12, aerialCommand: 12, kicking: 12 },
      condition: 100,
      positions: {},
      primary: 'CM',
    });
    const withPace = (formation: '4-3-3', p: number) => staticView('x', { formation, instructions: NEUTRAL }, Array.from({ length: 11 }, () => ({ ...pl(p), positions: { GK: 'NATURAL', CB: 'NATURAL', FB: 'NATURAL', DM: 'NATURAL', CM: 'NATURAL', AM: 'NATURAL', W: 'NATURAL', ST: 'NATURAL' } })));
    expect(paceMult(withPace('4-3-3', 12), withPace('4-3-3', 12))).toBeCloseTo(1, 6);
    expect(paceMult(withPace('4-3-3', 14), withPace('4-3-3', 12))).toBeCloseTo(1.5, 6);
    expect(paceMult(withPace('4-3-3', 20), withPace('4-3-3', 8))).toBeCloseTo(1.6, 6);
    expect(paceMult(withPace('4-3-3', 8), withPace('4-3-3', 20))).toBeCloseTo(0.3, 6);
  });

  it('R12: 윙어가 올라간 윙백 뒤 1:1 이면 DP7 에서 발동, 상대가 수비형 풀백이면 미발동', () => {
    const wng = staticView('w', { formation: STYLES.WING_PLAY.formation, instructions: STYLES.WING_PLAY.instructions, roles: STYLES.WING_PLAY.roles });
    const wb3 = staticView('b', { formation: STYLES.WINGBACK_3.formation, instructions: STYLES.WINGBACK_3.instructions, roles: STYLES.WINGBACK_3.roles });
    const lb = staticView('l', { formation: STYLES.LOW_BLOCK.formation, instructions: { ...STYLES.LOW_BLOCK.instructions, mentality: 0 }, roles: STYLES.LOW_BLOCK.roles });
    expect(evalBinaryRules('DP7', wng, wb3, { zone: 1 }, CFG).R12).toBeGreaterThan(0);
    expect(evalBinaryRules('DP7', wng, lb, { zone: 1 }, CFG).R12).toBeUndefined();
  });

  it('R13: 타깃맨 + 패스 길게면 DP1 에서 발동, 타깃맨이 없으면 미발동', () => {
    const strong: EnginePlayer = {
      id: 'big',
      name: '',
      attrs: { passing: 12, dribbling: 12, finishing: 12, crossing: 12, tackling: 12, vision: 12, positioning: 14, composure: 12, workRate: 12, pace: 12, stamina: 12, physical: 17, reflexes: 12, aerialCommand: 12, kicking: 12 },
      condition: 100,
      positions: { ST: 'NATURAL' },
      primary: 'ST',
    };
    const dir = staticView('d', { formation: STYLES.DIRECT.formation, instructions: STYLES.DIRECT.instructions, roles: STYLES.DIRECT.roles }, Array.from({ length: 11 }, (_, i) => (i === 9 ? strong : undefined)));
    const gp = staticView('g', { formation: STYLES.HIGH_PRESS.formation, instructions: STYLES.HIGH_PRESS.instructions, roles: STYLES.HIGH_PRESS.roles });
    expect(evalBinaryRules('DP1', dir, gp, { zone: 0 }, CFG).R13).toBeDefined();
    expect(evalBinaryRules('DP1', gp, dir, { zone: 0 }, CFG).R13).toBeUndefined();
  });
});

describe('경기 구조·통계 (0.4.0)', () => {
  const A = makeTeam(11, 'ha', 60, 'HIGH_PRESS');
  const B = makeTeam(22, 'aw', 60, 'COUNTER');

  it('표시 판정(유효슈팅·코너 추가분·표시 오프사이드)은 결과를 바꾸지 않는다: 표시 상수를 바꿔도 결정 로그·스코어 동일', () => {
    const C = EngineConstants as unknown as { SOT_Q: Record<string, number>; DISPLAY: Record<string, number> };
    const sot = { ...C.SOT_Q };
    const disp = { ...C.DISPLAY };
    const before = [3, 9, 27].map((seed) => play(seed, A.input, B.input));
    try {
      for (const k of Object.keys(C.SOT_Q)) C.SOT_Q[k] = 0.99;
      for (const k of Object.keys(C.DISPLAY)) C.DISPLAY[k] = 0.99;
      const after = [3, 9, 27].map((seed) => play(seed, A.input, B.input));
      after.forEach((r, i) => {
        expect(JSON.stringify(r.log)).toBe(JSON.stringify(before[i]!.log));
        expect([r.home.goals, r.away.goals]).toEqual([before[i]!.home.goals, before[i]!.away.goals]);
      });
    } finally {
      Object.assign(C.SOT_Q, sot);
      Object.assign(C.DISPLAY, disp);
    }
  });

  it('유효슈팅 ≥ 골, 추가시간 이벤트는 minute 45/90 + addedMinute, 경고 2장이면 퇴장', () => {
    let added = 0;
    for (let seed = 0; seed < 60; seed++) {
      const r = play(seed, A.input, B.input);
      for (const t of [r.home, r.away]) expect(t.shotsOnTarget!).toBeGreaterThanOrEqual(t.goals);
      for (const e of r.events) {
        if (e.addedMinute !== undefined) {
          added += 1;
          expect([45, 90]).toContain(e.minute);
          expect(e.addedMinute).toBeGreaterThan(0);
        }
      }
      for (const l of r.players) if ((l.yellowCards ?? 0) >= 2) expect(l.redCard).toBe(true);
      const yellows = r.events.filter((e) => e.type === 'YELLOW_CARD').length;
      expect(yellows).toBe((r.home.yellowCards ?? 0) + (r.away.yellowCards ?? 0));
    }
    expect(added).toBeGreaterThan(0);
  });

  it('LOG state 는 60분 이전에는 없다 (경기 흐름 보정은 60분 이후)', () => {
    const r = play(5, A.input, B.input);
    for (const l of r.log) if (l.kind === 'BINARY' && l.minute < 60) expect(l.state).toBeUndefined();
  });

  it('결정론: 같은 입력 → 같은 결과 (경고 스트림 포함)', () => {
    const inp = { matchId: 'd', seed: 77, home: { ...A.input, isHome: true }, away: { ...B.input, isHome: false }, config: config() };
    expect(JSON.stringify(simulateMatch(inp))).toBe(JSON.stringify(simulateMatch(structuredClone(inp))));
  });
});

describe('세이브 스키마 1 → 2 마이그레이션', () => {
  it("botStyle 'WIDE' → style 'WING_PLAY', 3·5백 FB 공격형 풀백 → 윙백, 이전 세이브를 불러올 수 있다", () => {
    const storage = createMemoryStorage();
    const s = createGameService({ storage, clock: { nowIso: () => '2026-09-27T00:00:00.000Z' } });
    s.newGame({ seed: 5 });
    const cur = JSON.parse(s.exportSave()) as Record<string, any>;
    // 스키마 1 세이브를 흉내: style → botStyle(레거시), 3-5-2 슬롯에 FB_OVERLAPPING
    const botIds = Object.keys(cur.clubs).filter((id) => !cur.clubs[id].isHuman);
    const legacy = structuredClone(cur);
    legacy.schemaVersion = 1;
    for (const id of botIds) {
      const c = legacy.clubs[id];
      c.botStyle = c.style === 'WING_PLAY' ? 'WIDE' : c.style === 'DIRECT' ? 'COUNTER' : c.style === 'HIGH_LINE' ? 'HIGH_PRESS' : c.style === 'WINGBACK_3' ? 'WIDE' : c.style;
      delete c.style;
    }
    const first = legacy.clubs[botIds[0]!];
    first.botStyle = 'WIDE';
    first.tactics.B = { ...first.tactics.B, formation: '3-5-2', roles: FORMATIONS['3-5-2'].slots.map((sl, i) => (sl.position === 'FB' ? 'FB_OVERLAPPING' : FORMATIONS['3-5-2'].slots[i]!.defaultRole)) };
    const migrated = migrateSave(legacy) as Record<string, any>;
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.clubs[botIds[0]!].style).toBe('WING_PLAY');
    expect(migrated.clubs[botIds[0]!].botStyle).toBeUndefined();
    expect(migrated.clubs[botIds[0]!].tactics.B.roles).toContain('WB_WINGBACK');
    expect(migrated.clubs[botIds[0]!].tactics.B.roles).not.toContain('FB_OVERLAPPING');
    // 서비스로 가져오기 (importSave, loadGame 둘 다)
    const s2 = createGameService({ storage: createMemoryStorage(), clock: { nowIso: () => '2026-09-27T00:00:00.000Z' } });
    const snap = s2.importSave(JSON.stringify(legacy));
    expect(snap.schemaVersion).toBe(2);
    expect(snap.clubs[botIds[0]!]!.style).toBe('WING_PLAY');
    const st = createMemoryStorage();
    st.save(JSON.stringify(legacy));
    expect(createGameService({ storage: st, clock: { nowIso: () => 'x' } }).loadGame()?.clubs[botIds[0]!]!.style).toBe('WING_PLAY');
    const scout = s2.getOpponentScout(botIds[0]!);
    expect(scout.botStyle).toBe('WIDE');
    expect(scout.style).toBe('WING_PLAY');
  });
});

describe('서비스 계약 1.2.0', () => {
  const mk = () => {
    const s = createGameService({ storage: createMemoryStorage(), clock: { nowIso: () => '2026-09-27T00:00:00.000Z' } });
    s.newGame({ seed: 11 });
    return s;
  };

  it('카탈로그: 스타일 9 · 역할 28 · 포메이션 9 · 규칙 R11~R13', () => {
    const s = mk();
    expect(s.contractVersion).toMatch(/^\d+\.\d+\.\d+$/); // 정확한 계약 버전은 tests/services 가 검사 (계약 단위 소유)
    const c = s.getCatalog();
    expect(c.styles).toHaveLength(9);
    expect(c.roles).toHaveLength(28);
    expect(c.formations).toHaveLength(9);
    expect(c.rules.map((r) => r.id)).toEqual(expect.arrayContaining(['R11', 'R12', 'R13']));
  });

  it('applyStyle: 지시만 적용은 숙련도 유지, 포메이션까지 적용은 포메이션이 바뀌면 × 0.5 + 경고', () => {
    const s = mk();
    const before = s.getSnapshot()!.clubs[s.getSnapshot()!.userClubId]!.tactics.A;
    const r1 = s.applyStyle!('A', 'HIGH_PRESS', 'INSTRUCTIONS_ONLY');
    expect(r1.slot.formation).toBe(before.formation);
    expect(r1.slot.familiarity).toBe(before.familiarity);
    expect(r1.slot.instructions).toEqual(STYLES.HIGH_PRESS.instructions);
    expect(r1.warning).toBeUndefined();
    const r2 = s.applyStyle!('A', 'WINGBACK_3', 'FULL');
    expect(r2.slot.formation).toBe('3-4-3');
    expect(r2.slot.roles).toEqual(STYLES.WINGBACK_3.roles);
    expect(r2.familiarityHalved).toBe(true);
    expect(r2.slot.familiarity).toBe(Math.round(before.familiarity * 0.5));
    expect(r2.warning).toBeTruthy();
  });

  it('getStyleFits: 9개, fit ∈ [0,1], level 은 fit 구간과 일치', () => {
    const fits = mk().getStyleFits!();
    expect(fits).toHaveLength(9);
    for (const f of fits) {
      expect(f.fit).toBeGreaterThanOrEqual(0);
      expect(f.fit).toBeLessThanOrEqual(1);
      expect(f.level).toBe(f.fit >= 0.95 && f.missing.length === 0 ? 'GOOD' : f.fit >= 0.8 ? 'OK' : 'POOR');
      if (f.fit < 1) expect(f.missing.length).toBeGreaterThan(0);
    }
  });

  it('getMatchupPreview: 상대 스타일 추정, 규칙 힌트 ≤ 6 (S/M/L), styleEdge ∈ [−2, 2], RNG 없음(같은 입력 같은 결과)', () => {
    const s = mk();
    const opp = s.getNextMatch()!;
    const oppId = opp.homeId === s.getSnapshot()!.userClubId ? opp.awayId : opp.homeId;
    const p = s.getMatchupPreview!('A', oppId);
    expect(p.opponentStyle).toBeDefined();
    expect(p.opponentStyleEstimated).toBe(false);
    expect(p.rules.length).toBeLessThanOrEqual(6);
    for (const r of p.rules) {
      expect(['S', 'M', 'L']).toContain(r.size);
      expect(r.reason.length).toBeGreaterThan(3);
    }
    expect(p.styleEdge).toBeGreaterThanOrEqual(-2);
    expect(p.styleEdge).toBeLessThanOrEqual(2);
    expect(s.getMatchupPreview!('A', oppId)).toEqual(p);
  });
});

describe('보정 게이트 (고정 시드, 축약)', () => {
  it('REAL_HOME 1,000경기: 홈 승 42~47 / 무 22~28 / 원정 27~33, 홈−원정 득점 0.2~0.4', () => {
    const rep = runCalibration({ matchesPerScenario: 1000, tacCap: 0.7, seed: 20260926, scenarios: ['REAL_HOME'] });
    for (const t of rep.targets) expect(t.pass, `${t.label} = ${t.actual}`).toBe(true);
  });
});
