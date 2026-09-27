/**
 * 8.1 보정 목표 배치 검증 CLI (소유: A).
 *   npm run sim:batch -- --n 2000 --cap 0.5 --seed 42 [--scenario BASELINE,OVR_DIFF_10] [--json sim-out/report.json] [--strict]
 *   npm run sim:batch -- --build-values [--n 20000]   (VALUE 테이블 생성 → engine/data/valueTable.ts 에 반영)
 * --strict: 목표 하나라도 실패하면 exit 1 (CI 게이트용).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { buildValueTable, PACKAGES, SPREAD_PACKAGES, runCalibrationDetailed, styleShort } from '../src/domain';
import { STYLE_MATRIX_EXPECTED } from '../src/engine';
import type { ScenarioId, StyleId, TacticCap } from '../src/types';

const { values } = parseArgs({
  options: {
    n: { type: 'string', default: '1000' },
    cap: { type: 'string', default: '0.5' },
    seed: { type: 'string', default: '20260926' },
    scenario: { type: 'string' },
    json: { type: 'string' },
    strict: { type: 'boolean', default: false },
    'build-values': { type: 'boolean', default: false },
  },
});

const cap = Number(values.cap);
if (![0.25, 0.35, 0.5, 0.6, 0.7].includes(cap)) {
  console.error(`--cap 은 0.25 / 0.35 / 0.5 / 0.6 / 0.7 중 하나여야 합니다 (입력: ${values.cap})`);
  process.exit(2);
}

if (values['build-values']) {
  const t = Date.now();
  const table = buildValueTable(Number(values.n), Number(values.seed), cap as TacticCap);
  console.log(JSON.stringify(table, null, 2));
  console.log(`VALUE 테이블 생성: ${values.n}경기, ${Date.now() - t}ms`);
  process.exit(0);
}

const scenarios = values.scenario ? (values.scenario.split(',') as ScenarioId[]) : undefined;
const started = Date.now();
const { report, details } = runCalibrationDetailed(
  {
    matchesPerScenario: Number(values.n),
    tacCap: cap as TacticCap,
    seed: Number(values.seed),
    ...(scenarios ? { scenarios } : {}),
  },
  (p) => {
    if (p.done % 500 === 0 || p.done === p.total) process.stdout.write(`\r${p.scenario} ${p.done}/${p.total}          `);
  },
  () => Date.now(),
);
process.stdout.write('\n');

console.table(
  report.targets.map((t) => ({
    scenario: t.scenario,
    target: t.label,
    range: `${t.min ?? '-'} ~ ${t.max ?? '-'} ${t.unit}`,
    actual: Number(t.actual.toFixed(3)),
    result: t.pass ? 'PASS' : 'FAIL',
  })),
);

const f1 = (x: number) => x.toFixed(1);
if (details.baseline) {
  const b = details.baseline;
  console.log(`\n[BASELINE] n=${b.n} 평균 득점 ${b.goals.toFixed(3)} | 팀당 슈팅 ${f1(b.shotsPerTeam)} | 승/무/패 ${f1(b.w)}/${f1(b.d)}/${f1(b.l)}%`);
}
if (details.realHome) {
  const h = details.realHome;
  console.log(`[REAL_HOME] n=${h.n} 홈 승/무/원정 승 ${f1(h.homeWin)}/${f1(h.draw)}/${f1(h.awayWin)}% | 홈−원정 득점 ${h.goalDiff.toFixed(3)}`);
}
if (details.realism) {
  const s = details.realism;
  console.log(`\n[LEAGUE_REALISM] ${s.n}경기 | 득점 ${s.goals.toFixed(2)} | 홈/무/원정 ${f1(s.homeWin)}/${f1(s.draw)}/${f1(s.awayWin)} | 슈팅 ${f1(s.shotsPerTeam)} 유효 ${f1(s.sotPerTeam)} (${f1(s.sotRatio)}%) | xG ${s.xgPerTeam.toFixed(2)}`);
  if (details.stylePossession) console.log(`  스타일 점유 vs 균형: ${Object.entries(details.stylePossession).map(([k, v]) => `${k} ${f1(v!)}%`).join(', ')}`);
}
if (details.counterMatrix) {
  const S = SPREAD_PACKAGES;
  console.log('\n[STYLE_MATRIX] 동일 전력(OVR 60), 중립. 칸 = 행 팀 (승 − 패)%p [설계 기대 부호], 괄호 = 행 팀 점유율');
  const rows = S.map((u) => {
    const row: Record<string, string> = { 행: styleShort(u) };
    for (const t of S) {
      const c = details.counterMatrix!.find((x) => x.us === u && x.them === t);
      if (!c) continue;
      const e = STYLE_MATRIX_EXPECTED[u][t];
      const mark = e === 2 ? '++' : e === 1 ? '+' : e === 0 ? '0' : e === -1 ? '−' : '−−';
      row[styleShort(t)] = u === t ? '·' : `${(c.winPct - c.lossPct).toFixed(0)} [${mark}]`;
    }
    return row;
  });
  console.table(rows);
  if (details.matrixSign) {
    const m = details.matrixSign;
    console.log(`  부호 일치 ${m.matched}/${m.total} (${f1(m.rate)}%) | 스타일 평균(승−패): ${Object.entries(m.styleAvg).map(([k, v]) => `${styleShort(k as StyleId)} ${f1(v)}`).join(', ')}`);
    console.log(`  +6 이상 상대 수: ${Object.entries(m.plus).map(([k, v]) => `${styleShort(k as StyleId)} ${v}`).join(', ')} | −6 이하: ${Object.entries(m.minus).map(([k, v]) => `${styleShort(k as StyleId)} ${v}`).join(', ')}`);
  }
  console.log(`  단순 최대−최소 평균 ${f1(details.counterRawSpread ?? 0)}%p / 교차검증 평균 ${f1(details.counterCvSpread ?? 0)}%p`);
  for (const [s, b] of Object.entries(details.counterBest ?? {})) {
    console.log(`  vs ${styleShort(s as StyleId)}: 최선 ${styleShort(b.best)}, 최악 ${styleShort(b.worst)}, 교차검증 승률 차 ${f1(b.spread)}%p, 유리측 무승부 제외 ${f1(b.favNonDraw)}%`);
  }
}
if (details.formationParity) {
  const f = details.formationParity;
  console.log(`\n[FORMATION_PARITY] 칸당 ${f.n}경기 | 경기당 승점: ${Object.entries(f.ppg).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')} | 4-4-2 vs 4-3-3 |승−패| ${f1(f.f442v433)}%p`);
}
if (details.styleFit) {
  const f = details.styleFit;
  console.log(`[STYLE_FIT] 적합 이득 ${f1(f.gainFit)} / 부적합 ${f1(f.gainUnfit)} → 차 ${f1(f.diff)}%p | R2 러너17vsCB11 ${f.r2Fast.toFixed(3)} / 러너12vsCB14 ${f.r2Slow.toFixed(3)} (×${f.ratio.toFixed(2)})`);
}
if (details.roleSignature) {
  console.log('\n[ROLE_SIGNATURE]');
  console.table(details.roleSignature.map((r) => ({ 교체: r.swap, 지표: r.metric, 기준: Number(r.base.toFixed(3)), 교체후: Number(r.value.toFixed(3)), 변화: Number(r.change.toFixed(2)), 기준치: r.min, 방향: r.dirOk ? 'OK' : 'X', 크기: r.sizeOk ? 'OK' : 'X' })));
}
if (details.stamina) {
  const s = details.stamina;
  console.log(`[STAMINA_CURVE] 후반 xG 비중 GP ${f1(s.gpShare2)}% / BAL ${f1(s.balShare2)}% (차 ${f1(s.diff)}%p) | 경기 후 컨디션 GP ${f1(s.gpCond)} / BAL ${f1(s.balCond)} (차 ${f1(s.condDiff)})`);
}
if (details.ovr10) console.log(`\n[OVR_DIFF_10] 65 vs 55 강팀 승 ${f1(details.ovr10.strongWin)}% 무 ${f1(details.ovr10.draw)}% 약팀 승 ${f1(details.ovr10.weakWin)}%`);
if (details.ovr10Counter) {
  const c = details.ovr10Counter;
  console.log(`[OVR_DIFF_10_COUNTER] 약팀 ${PACKAGES[c.weakPackage].label}: 강팀 승 ${f1(c.strongWin)}% 무 ${f1(c.draw)}% 약팀 승 ${f1(c.weakWin)}%`);
  if (details.noTactics) console.log(`  (같은 대진, 전술 효과 끔 tacticsEnabled=false: 강팀 승 ${f1(details.noTactics.strongWin)}% 약팀 승 ${f1(details.noTactics.weakWin)}%)`);
}
if (details.ovr25) console.log(`[OVR_DIFF_25] 72.5 vs 47.5 강팀 승 ${f1(details.ovr25.strongWin)}% 무 ${f1(details.ovr25.draw)}% 약팀 승 ${f1(details.ovr25.weakWin)}%`);
if (details.tempo) console.log(`[TEMPO_VARIANCE] 약팀 승률 템포+2 ${f1(details.tempo.weakWinFast)}% / 템포−2 ${f1(details.tempo.weakWinSlow)}% (Δ ${f1(details.tempo.diff)}%p)`);
if (details.ruleIsolation) {
  console.log('\n[RULE_ISOLATION] 규칙 단독(onlyRules) 경기별 |규칙 xG| P95 / 평균');
  for (const r of details.ruleIsolation) console.log(`  ${r.rule.padEnd(8)} P95 ${r.p95.toFixed(3)}  평균 ${r.mean.toFixed(3)}  (n=${r.n})`);
  console.log(`  모든 규칙 합 P95 ${details.ruleTotalP95?.toFixed(3)}`);
}
console.log(
  `\nengine ${report.engineVersion} | cap ${report.tacCap} | n=${report.matchesPerScenario}/scenario | ${Date.now() - started}ms | ${report.allPass ? 'ALL PASS' : 'FAIL'}`,
);

if (values.json) {
  mkdirSync(dirname(values.json), { recursive: true });
  writeFileSync(values.json, JSON.stringify({ report, details }, null, 2));
}
if (values.strict && !report.allPass) process.exit(1);
