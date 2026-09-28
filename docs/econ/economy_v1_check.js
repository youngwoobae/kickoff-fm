// 오프라인 v1 경제 수치 검증 (docs/설계/오프라인_경제.md 근거 계산)
// 실행: node docs/econ/economy_v1_check.js            (전체, 약 10~20초)
//       node docs/econ/economy_v1_check.js --quick    (몬테카를로 시드 수 1/5)
// 모든 값 [PH]. 결정적(시드 고정). 단위: M KC.
'use strict';
const QUICK = process.argv.includes('--quick');
const SEEDS = QUICK ? 100 : 500;

// ---------- 상수 (문서 2~7장과 1:1) ----------
const TN = ['T1', 'T2', 'T3', 'T4', 'T5'];
const REF = [72, 66, 60, 54, 48]; // src/domain/squad/generator.ts TIER_REFERENCE_OVR
const BUD = [144.0, 93.5, 61.0, 39.5, 25.0]; // economy.ts TIER_ECONOMY (기획서 v2 7.4.1)
const CAP = [150.0, 98.0, 64.0, 41.0, 26.0];
const WB = [2.55, 1.7, 1.11, 0.72, 0.47];
const DB = [1.02, 0.68, 0.43, 0.3, 0.17];
const LB = [0.4, 0.3, 0.2, 0.12, 0.08];
const PRIZE = (r) => (r === 1 ? 0.2 : r <= 3 ? 0.15 : r <= 6 ? 0.1 : r <= 10 ? 0.06 : 0.03);
const CHAMP = 0.1, CARRY = 0.2, PROMO = 0.3, PARA = 0.5, GRACE = 1.1, RELEG_FEE_LIMIT = 0.25;
const TIER_GAP = REF[2] - REF[3]; // 6
const G = Math.pow(1.55, 1 / TIER_GAP); // OVR 1당 연봉 배율
const S_REF = 3.0; // S(60)
const S = (o) => S_REF * Math.pow(G, o - 60);
const K_SQ = 11 + 11 * Math.pow(G, -TIER_GAP); // 주전 11 @o + 로테이션 11 @o-6 의 연봉합 = K_SQ x S(o)
const ceilOvr = (capAmt) => 60 + Math.log(capAmt / K_SQ / S_REF) / Math.log(G);
const ageF = (a) => (a <= 21 ? 1.3 : a <= 27 ? 1.0 : a <= 30 ? 0.8 : 0.5);
const potF = (gap) => 1 + Math.min(0.45, 0.03 * Math.max(0, gap));
const conF = (y) => (y >= 3 ? 1.0 : y === 2 ? 0.85 : y === 1 ? 0.6 : 0.3);
const V = (o, age = 25, gap = 0, yrs = 2) => 5 * S(o) * ageF(age) * potF(gap) * conF(yrs);
const TAX = 0.1, BID_MAX = 1.3, SYS_SALE = 0.5, MIN_SAL = 0.2;
const f2 = (x) => (Math.round(x * 100) / 100).toFixed(2);
const pct = (x) => (x * 100).toFixed(1) + '%';

// ---------- A. S(OVR) 재기준 ----------
console.log('=== A. S(OVR) 재기준 (코드 OVR 척도: 티어 간 6 OVR, 캡 비 ~1.55) ===');
console.log(`G = 1.55^(1/6) = ${G.toFixed(4)}, S(60) = ${S_REF}M, K_SQ = ${f2(K_SQ)}`);
console.log('구 공식 0.3x1.1^(OVR-50) 로 T3 기준(60) 22인 연봉합 = ' + f2(11 * 0.3 * Math.pow(1.1, 10) + 11 * 0.3 * Math.pow(1.1, 4)) + 'M (캡 64 의 ' + pct((11 * 0.3 * Math.pow(1.1, 10) + 11 * 0.3 * Math.pow(1.1, 4)) / 64) + ') -> 사용 불가');
console.log('티어 | 기준OVR | S(기준) | 22인 연봉합 | 캡 사용률 | 천장OVR(캡100%) | 강등유예110% 천장 | 0.8S 산입 하한 시 이론 천장');
for (let i = 0; i < 5; i++) {
  const sq = K_SQ * S(REF[i]);
  console.log(`${TN[i]} | ${REF[i]} | ${f2(S(REF[i]))} | ${f2(sq)} | ${pct(sq / CAP[i])} | ${f2(ceilOvr(CAP[i]))} | ${f2(ceilOvr(CAP[i] * GRACE))} | ${f2(ceilOvr(CAP[i] / 0.8))}`);
}
console.log('S 표: ' + [36, 40, 45, 48, 54, 60, 66, 72, 78, 84, 90].map((o) => `${o}:${f2(S(o))}`).join(' '));

// ---------- B. 성적별 수입, 순유입 비율 ----------
console.log('\n=== B. 성적별 시즌 수입 (배정금+수당+상금) / 캡 ===');
const recs = [['우승', 20, 4, 2, 1], ['2위', 18, 4, 4, 2], ['5위', 12, 6, 8, 5], ['9위', 9, 7, 10, 9], ['13위', 5, 6, 15, 13], ['최하위', 4, 5, 17, 14]];
const income = (i, W, D, L, r) => BUD[i] + W * WB[i] + D * DB[i] + L * LB[i] + BUD[i] * PRIZE(r) + (r === 1 ? BUD[i] * CHAMP : 0);
for (let i = 0; i < 5; i++) {
  console.log(`${TN[i]}: ` + recs.map(([n, W, D, L, r]) => `${n} ${f2(income(i, W, D, L, r))}(${f2(income(i, W, D, L, r) / CAP[i])})`).join(' | '));
}
console.log('순유입 비율 (분자=배정금+수당+상금, 분모=연봉(기준 스쿼드)+이적료 싱크(아래 가정)):');
for (let i = 0; i < 5; i++) {
  const sal = K_SQ * S(REF[i]);
  const fees = 1 * 1.12 * V(REF[i] + 3) * 1 - 0.5 * V(REF[i]) + 0.1 * sal * 0.25; // 연 1명 업그레이드 영입 순비용 + 갱신 보너스(주전 1/4 갱신)
  const mid = income(i, 12, 6, 8, 5), low = income(i, 4, 5, 17, 14);
  console.log(`${TN[i]}: 5위 ${f2(mid / (sal + fees))} | 최하위 ${f2(low / (sal + fees))} (연봉 ${f2(sal)}, 싱크 ${f2(fees)})`);
}

// ---------- C. 승강 자금 ----------
console.log('\n=== C. 승격 보너스 / 강등 보조금 / 강등 시즌 이적료 한도 ===');
for (let i = 0; i < 4; i++) console.log(`${TN[i + 1]}->${TN[i]} 승격 보너스 ${f2(BUD[i] * PROMO)} (45%안 ${f2(BUD[i] * 0.45)})`);
for (let i = 1; i < 5; i++) console.log(`${TN[i - 1]}->${TN[i]} 강등: 보조금 상한 ${f2((BUD[i - 1] - BUD[i]) * PARA)}, 캡 유예 ${f2(CAP[i] * GRACE)}, 이적료 한도 ${f2(BUD[i] * RELEG_FEE_LIMIT)}, 줄여야 할 연봉(이전 기준 스쿼드 -> 새 유예 캡) ${f2(Math.max(0, K_SQ * S(REF[i - 1]) - CAP[i] * GRACE))}`);

// ---------- D. 평가가치 ----------
console.log('\n=== D. 평가가치 V = 5 x S x 나이 x 잠재력 x 계약잔여 ===');
const vx = [['T5 유망주 18세 OVR44 잠재+14 3시즌', 44, 18, 14, 3], ['T5 주전 25세 OVR48 2시즌', 48, 25, 0, 2], ['T3 주전 25세 OVR60 2시즌', 60, 25, 0, 2], ['T3 주전 29세 OVR60 1시즌', 60, 29, 0, 1], ['T3 베테랑 32세 OVR61 1시즌', 61, 32, 0, 1], ['T1 스타 24세 OVR78 잠재+4 3시즌', 78, 24, 4, 3], ['T1 주전 27세 OVR72 3시즌', 72, 27, 0, 3]];
for (const [n, o, a, g, y] of vx) console.log(`${n}: S ${f2(S(o))} V ${f2(V(o, a, g, y))} 입찰범위 ${f2(V(o, a, g, y))}~${f2(V(o, a, g, y) * BID_MAX)}`);
{
  const v = V(60);
  console.log(`매각-재구매 루프 (T3 V=${f2(v)}): 판매 1.0V 수령 ${f2(v * (1 - TAX))} -> 재구매 최저 ${f2(v)} = 순손실 ${f2(v * TAX)} (세금 10%)`);
  console.log(`잔액 부족 강제 매각(D18): 시스템 매입 ${SYS_SALE}V = ${f2(v * SYS_SALE)}`);
}

// ---------- E. 계약 ----------
console.log('\n=== E. 계약·재계약·방출·유스 ===');
const ask = (o, starter, overTier, age) => S(o) * Math.min(1.3, Math.max(0.9, 1 + (starter ? 0.1 : 0) + (overTier ? 0.15 : 0) - (age >= 33 ? 0.2 : age >= 31 ? 0.1 : 0)));
for (const [n, o, st, ov, a] of [['T3 주전 26세 OVR61', 61, 1, 0, 26], ['T3 로테이션 24세 OVR55', 55, 0, 0, 24], ['T5 에이스 23세 OVR55(천장 초과)', 55, 1, 1, 23], ['T2 베테랑 33세 OVR64', 64, 1, 0, 33]]) {
  const s = ask(o, st, ov, a), yrs = a <= 23 ? 3 : a <= 29 ? 3 : a <= 32 ? 2 : 1;
  console.log(`${n}: 요구 연봉 ${f2(s)} (S ${f2(S(o))}), ${yrs}시즌, 갱신 보너스 ${f2(0.1 * s * yrs)} -> 시즌당 캡 산입 ${f2(s + 0.1 * s)}`);
}
for (const [n, sal, dl, yl] of [['연봉 3.0M, Day 10, 잔여 2시즌', 3.0, 19, 2], ['연봉 3.0M, Day 26, 잔여 1시즌', 3.0, 3, 1], ['연봉 7.2M, Day 1, 잔여 3시즌', 7.2, 28, 3]]) {
  const rem = sal * (dl / 28) + sal * (yl - 1);
  console.log(`방출 ${n}: 잔여 연봉 ${f2(rem)} -> 위약금 50% ${f2(rem * 0.5)}`);
}
for (let i = 0; i < 5; i++) {
  const yo = REF[i] - 12;
  const sal = Math.max(MIN_SAL, 0.9 * S(yo));
  console.log(`${TN[i]} 유스(OVR ${yo}) 연봉 ${f2(sal)} x2명 = 캡의 ${pct((2 * sal) / CAP[i])}; 3시즌 뒤 OVR ${yo + 9} 되면 산입 하한 0.8S = ${f2(0.8 * S(yo + 9))}`);
}

// ---------- F. 피라미드 몬테카를로 ----------
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const K = 0.1107, C0 = 0.532; // 순서형 로짓: OVR 차 10 -> 승 64% (엔진 OVR_DIFF_10_COUNTER 62.4% 와 근접)
const sig = (x) => 1 / (1 + Math.exp(-x));
const Vt = (o, m = 5) => m * S(o) * 0.85; // 팀 모델 평균 매물: 22~27세, 2시즌

function runPyramid(seed, P) {
  const R = mulberry(seed);
  const gauss = () => { let u = 0; while (u === 0) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R()); };
  const clubs = [];
  for (let t = 0; t < 5; t++) for (let j = 0; j < 14; j++) {
    clubs.push({ id: clubs.length, tier: t, t0: t, xi: REF[t] + Math.max(-3, Math.min(3, gauss() * 1.5)), a: 0.5 + 0.5 * R(), skill: gauss() * P.skillSd,
      bal: CARRY * BUD[t], promo: false, releg: false, capT: P.capTarget, user: false, titles: 0, lp: 0 });
  }
  if (P.user) { const u = clubs[4 * 14]; Object.assign(u, { user: true, skill: P.user.skill, a: P.user.a, capT: P.user.capT }); }
  const M = { promN: 0, promRel: 0, relN: 0, relUp: 0, insolv: 0, cs: 0, xi: [...Array(10)].map(() => [0, 0, 0, 0, 0]), nir: [[], [], [], [], []], carryAtCap: [0, 0, 0, 0, 0], carryN: [0, 0, 0, 0, 0],
    endBal: [...Array(10)].map(() => [[], [], [], [], []]), lp: [0, 0, 0, 0, 0], feeSpent: [0, 0, 0, 0, 0], champRep: 0, champN: 0, t1Rep: 0, t1N: 0, userT1: -1, userTier: [], t1Outsiders: 0, maxT1Titles: 0 };
  let lastChamp = [-1, -1, -1, -1, -1];
  for (let s = 0; s < 10; s++) {
    // 1) 연봉(캡 강제) + 강등 보조금
    for (const c of clubs) {
      const lim = CAP[c.tier] * (c.releg ? GRACE : 1);
      if (K_SQ * S(c.xi) > lim) c.xi = ceilOvr(lim);
      c.sal = K_SQ * S(c.xi);
      c.para = c.releg ? Math.min(Math.max(0, c.sal - CAP[c.tier]), (BUD[c.tier - 1] - BUD[c.tier]) * PARA) : 0;
      M.xi[s][c.tier] += c.xi / 14;
    }
    // 2) 리그
    const nextTier = new Map();
    for (let t = 0; t < 5; t++) {
      const L = clubs.filter((c) => c.tier === t);
      for (const c of L) { c.w = 0; c.d = 0; c.l = 0; }
      for (const h of L) for (const w of L) if (h !== w) {
        const d = K * (h.xi + h.skill - w.xi - w.skill), pw = sig(d - C0), pl = sig(-d - C0), r = R();
        if (r < pw) { h.w++; w.l++; } else if (r < 1 - pl) { h.d++; w.d++; } else { h.l++; w.w++; }
      }
      const tab = [...L].sort((x, y) => (3 * y.w + y.d) - (3 * x.w + x.d) || R() - 0.5);
      tab.forEach((c, i) => { c.rank = i + 1; });
      const ch = tab[0];
      if (s > 0) { M.champN++; if (lastChamp[t] === ch.id) M.champRep++; if (t === 0) { M.t1N++; if (lastChamp[0] === ch.id) M.t1Rep++; } }
      lastChamp[t] = ch.id;
      if (t === 0) ch.titles++;
      for (const c of tab) {
        if (s > 0 && c.promo) { M.promN++; if (c.rank >= 13 && t < 4) M.promRel++; }
        if (s > 0 && c.releg) { M.relN++; if (c.rank <= 2 && t > 0) M.relUp++; }
        nextTier.set(c, t > 0 && c.rank <= 2 ? t - 1 : t < 4 && c.rank >= 13 ? t + 1 : t);
      }
    }
    // 3) 정산
    for (const c of clubs) {
      const t = c.tier;
      const inc = BUD[t] + c.w * WB[t] + c.d * DB[t] + c.l * LB[t] + BUD[t] * PRIZE(c.rank) + (c.rank === 1 ? BUD[t] * CHAMP : 0) + (c.promo ? BUD[t] * P.promo : 0);
      c.bal += inc - c.sal + c.para;
      const sinks = c.sal + (c.feeLast || 0);
      if (!c.user) M.nir[t].push((inc + c.para) / sinks);
      M.cs++;
      if (c.bal < 0) M.insolv++;
      M.endBal[s][t].push(c.bal / BUD[t]);
    }
    // 4) 승강 + 이월
    for (const c of clubs) {
      const nt = nextTier.get(c);
      c.promo = nt < c.tier; c.releg = nt > c.tier; c.tier = nt;
      const capC = CARRY * BUD[nt];
      c.carry = Math.min(c.bal, capC);
      c.wob = Math.max(0, c.bal - c.carry);
      if (!c.user) { M.carryN[nt]++; if (c.bal >= capC) M.carryAtCap[nt]++; }
    }
    // 5) 수명주기 (M1.2 가정: 티어 기준으로 평균 회귀 + 개발 운)
    for (const c of clubs) c.xi += P.rho * (REF[c.tier] - c.xi) + gauss() * P.devSd;
    // 6) 정규 이적창 (AI 규칙 5.4)
    for (const c of clubs) {
      const t = c.tier;
      const lim = CAP[t] * (c.releg ? GRACE : 1) * c.capT;
      const nextSal = Math.min(K_SQ * S(c.xi), lim);
      const Boff = c.carry + c.wob + BUD[t] + (c.promo ? BUD[t] * P.promo : 0) - nextSal - 0.05 * CAP[t];
      let F = c.wob + c.a * Math.max(0, Boff - c.wob);
      if (c.releg) F = Math.min(F, RELEG_FEE_LIMIT * BUD[t]);
      const ceil = ceilOvr(lim);
      const maxD = Math.min(P.maxDelta * (c.promo ? 1.5 : 1), ceil - c.xi);
      const cost = (d) => { const n = (11 * d) / 3; return n * (P.bid * Vt(c.xi + 3, P.vmult) - P.sellBack * Vt(c.xi, P.vmult)) + K_SQ * (S(c.xi + d) - S(c.xi)); };
      let d = 0;
      if (maxD > 0 && F > 0) { let lo = 0, hi = maxD; for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; if (cost(m) <= F) lo = m; else hi = m; } d = lo; }
      const spent = d > 0 ? cost(d) - K_SQ * (S(c.xi + d) - S(c.xi)) : 0;
      c.xi += d;
      c.feeLast = spent;
      if (!c.user) M.feeSpent[t] += spent;
      const fromWob = Math.min(spent, c.wob);
      const lp = c.wob - fromWob;
      if (!c.user) M.lp[t] += lp;
      c.bal = c.carry - (spent - fromWob);
    }
    if (P.user) { const u = clubs.find((c) => c.user); M.userTier.push(u.tier); if (u.tier === 0 && M.userT1 < 0) M.userT1 = s + 1; }
  }
  M.t1Outsiders = clubs.filter((c) => c.tier === 0 && c.t0 !== 0).length;
  M.maxT1Titles = Math.max(...clubs.map((c) => c.titles));
  return M;
}

const BASE = { rho: 0.3, devSd: 1.0, skillSd: 0.5, capTarget: 0.97, promo: PROMO, bid: 1.12, sellBack: 0.5, maxDelta: 2.2, vmult: 5 };
const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
function batch(P, seeds = SEEDS) {
  const all = [];
  for (let i = 0; i < seeds; i++) all.push(runPyramid(20260928 + i * 7919, P));
  return all;
}
function summarize(label, all) {
  const sum = (f) => all.reduce((a, m) => a + f(m), 0);
  const pr = sum((m) => m.promRel) / sum((m) => m.promN), ru = sum((m) => m.relUp) / sum((m) => m.relN);
  console.log(`\n--- ${label} (${all.length} 시드 x 10시즌 x 70구단) ---`);
  console.log(`승격 직후 강등률 ${pct(pr)} (무작위 기준 14.3%) | 강등팀 즉시 재승격 ${pct(ru)} | 같은 티어 연속 우승 ${pct(sum((m) => m.champRep) / sum((m) => m.champN))} | 잔액<0 구단-시즌 ${pct(sum((m) => m.insolv) / sum((m) => m.cs))}`);
  const x1 = [0, 1, 2, 3, 4].map((t) => all.reduce((a, m) => a + m.xi[0][t], 0) / all.length);
  const x10 = [0, 1, 2, 3, 4].map((t) => all.reduce((a, m) => a + m.xi[9][t], 0) / all.length);
  const steps = all.map((m) => Math.max(...[0, 1, 2, 3, 4].map((t) => Math.max(...m.xi.slice(1).map((r, s) => Math.abs(r[t] - m.xi[s][t]))))));
  const maxStep = Math.max(...steps);
  const gini = (v) => { const a = [...v].sort((x, y) => x - y), n = a.length, mean = a.reduce((x, y) => x + y, 0) / n; let g = 0; a.forEach((x, i) => { g += (2 * (i + 1) - n - 1) * x; }); return mean > 0 ? g / (n * n * mean) : 0; };
  const gin = all.map((m) => Math.max(...[0, 1, 2, 3, 4].map((t) => gini(m.endBal[9][t].map((x) => Math.max(0, x))))));
  console.log(`시드별 시즌 간 최대 변화 P95 ${f2(q(steps, 0.95))} | S10 티어 내 시즌 말 잔액 지니(티어 최대) P50 ${f2(q(gin, 0.5))} P95 ${f2(q(gin, 0.95))} | T1 연속 우승률 ${pct(sum((m) => m.t1Rep) / sum((m) => m.t1N))}`);
  const drift = all.map((m) => Math.max(...[0, 1, 2, 3, 4].map((t) => Math.abs(m.xi[9][t] - m.xi[0][t]))));
  const gapMin = all.map((m) => Math.min(...[0, 1, 2, 3].map((t) => m.xi[9][t] - m.xi[9][t + 1])));
  console.log('티어 평균 주전 OVR S1 -> S10: ' + TN.map((n, t) => `${n} ${f2(x1[t])}->${f2(x10[t])}`).join(' | '));
  console.log(`시드별 최대 |S10-S1| P50 ${f2(q(drift, 0.5))} P95 ${f2(q(drift, 0.95))} | 시즌 간 최대 변화(전체 최대) ${f2(maxStep)} | S10 인접 티어 최소 간격 P5 ${f2(q(gapMin, 0.05))}`);
  const nirLine = TN.map((n, t) => { const v = all.flatMap((m) => m.nir[t]); return `${n} P10 ${f2(q(v, 0.1))} P50 ${f2(q(v, 0.5))} P90 ${f2(q(v, 0.9))}`; });
  console.log('순유입 비율(발생 기준, 구단-시즌): ' + nirLine.join(' | '));
  const bal = (s, t) => all.flatMap((m) => m.endBal[s][t]);
  console.log('시즌 말 잔액/배정금 중앙값 S2 -> S10 (P90 S10): ' + TN.map((n, t) => `${n} ${f2(q(bal(1, t), 0.5))}->${f2(q(bal(9, t), 0.5))} (${f2(q(bal(9, t), 0.9))})`).join(' | '));
  const ratio = all.map((m) => { let r = 0; for (let t = 0; t < 5; t++) { const a = q(m.endBal[1][t], 0.5), b = q(m.endBal[9][t], 0.5); r = Math.max(r, Math.abs(b - a)); } return r; });
  console.log(`시드별 티어 최대 |중앙 잔액/배정금 S10 - S2| P50 ${f2(q(ratio, 0.5))} P95 ${f2(q(ratio, 0.95))}`);
  console.log('이월 상한 도달 비율: ' + TN.map((n, t) => `${n} ${pct(sum((m) => m.carryAtCap[t]) / sum((m) => m.carryN[t]))}`).join(' | '));
  console.log('시즌당 구단 평균 이적료 지출 / LP 전환: ' + TN.map((n, t) => `${n} ${f2(sum((m) => m.feeSpent[t]) / all.length / 140)} / ${f2(sum((m) => m.lp[t]) / all.length / 140)}`).join(' | '));
  console.log(`S10 T1 구단 중 처음엔 T1 아니던 구단 수 P50 ${q(all.map((m) => m.t1Outsiders), 0.5)} P5 ${q(all.map((m) => m.t1Outsiders), 0.05)} | 한 구단 T1 최다 우승 P50 ${q(all.map((m) => m.maxT1Titles), 0.5)} P95 ${q(all.map((m) => m.maxT1Titles), 0.95)} | 5회 이상 비율 ${pct(all.filter((m) => m.maxT1Titles >= 5).length / all.length)}`);
  return { pr, ru };
}
function userSummary(label, all) {
  const reach = all.filter((m) => m.userT1 > 0);
  const neverUp = all.filter((m) => Math.min(...m.userTier) === 4).length;
  const fin = [0, 1, 2, 3, 4].map((t) => all.filter((m) => m.userTier[9] === t).length / all.length);
  console.log(`${label}: 10시즌 내 T1 도달 ${pct(reach.length / all.length)} (도달 시즌 중앙 ${reach.length ? q(reach.map((m) => m.userT1), 0.5) : '-'}) | 한 번도 승격 못함 ${pct(neverUp / all.length)} | S10 종료 티어 분포 ${TN.map((n, t) => `${n} ${pct(fin[t])}`).join(' ')}`);
}

console.log('\n=== F. 피라미드 몬테카를로 (5티어 x 14, 2승 2강, 10시즌) ===');
console.log('팀 모델: 주전 평균 OVR xi. 연봉 = K_SQ x S(xi) 캡 강제. 수명주기 xi += 0.30(기준-xi) + N(0,1.0). 이적: 5.4 AI 규칙 예산 F, +1 OVR 비용 = 영입 1.12V(xi+3) - 매각 0.5V(xi) (n=11d/3명) + 연봉 증가');
const base = batch(BASE);
summarize('F-1 기준 (승격 보너스 30%, AI 캡 목표 97%)', base);

console.log('\n=== F-2. 민감도 (승격 직후 강등률 / 즉시 재승격) ===');
for (const [n, over] of [['보너스 45%', { promo: 0.45 }], ['보너스 60%', { promo: 0.6 }], ['보너스 0%', { promo: 0 }], ['수명주기 회귀 0.15', { rho: 0.15 }], ['수명주기 회귀 0.45', { rho: 0.45 }], ['승격팀 한도 1.5배 없음(maxDelta 동일)', { maxDelta: 2.2 / 1.5 }], ['매각 회수 0 (이적료 전액 싱크)', { sellBack: 0 }], ['개발 운 SD 1.5', { devSd: 1.5 }]]) {
  const all = batch({ ...BASE, ...over }, Math.round(SEEDS / 2));
  const sum = (f) => all.reduce((a, m) => a + f(m), 0);
  const x10 = [0, 1, 2, 3, 4].map((t) => all.reduce((a, m) => a + m.xi[9][t], 0) / all.length);
  console.log(`${n}: 승격 직후 강등 ${pct(sum((m) => m.promRel) / sum((m) => m.promN))} | 즉시 재승격 ${pct(sum((m) => m.relUp) / sum((m) => m.relN))} | 잔액<0 ${pct(sum((m) => m.insolv) / sum((m) => m.cs))} | S10 티어 OVR ${x10.map(f2).join('/')}`);
}

console.log('\n=== G. 사용자 대리 에이전트 (T5 시작, 10시즌) ===');
for (const [n, u] of [['AUTO (감독 AI, 기량 +0, 공격성 0.75, 캡 97%)', { skill: 0, a: 0.75, capT: 0.97 }], ['AGGR (감독 AI + 입찰 적극: 기량 +0, 공격성 1.0, 캡 100%) = CAREER_SIM 이 실제로 돌릴 수 있는 최적 근사', { skill: 0, a: 1.0, capT: 1.0 }], ['MEDIAN (수동 중앙값 근사, 기량 +1.5 OVR, 공격성 1.0, 캡 100%)', { skill: 1.5, a: 1.0, capT: 1.0 }], ['OPTIMAL (수동 최적 근사, 기량 +3.0 OVR, 공격성 1.0, 캡 105% = 성장 유스 0.8S 산입)', { skill: 3.0, a: 1.0, capT: 1.05 }], ['EXPERT (기량 +4.5 OVR)', { skill: 4.5, a: 1.0, capT: 1.05 }]]) {
  userSummary(n, batch({ ...BASE, user: u }));
}

console.log('\n=== G-2. 사용자 도달률 민감도 (OPTIMAL / MEDIAN, 10시즌 내 T1 도달) ===');
for (const [n, over] of [['기준', {}], ['승격 보너스 45%', { promo: 0.45 }], ['승격 보너스 60%', { promo: 0.6 }], ['V 배수 4', { vmult: 4 }], ['V 배수 4 + 보너스 45%', { vmult: 4, promo: 0.45 }], ['수명주기 회귀 0.45', { rho: 0.45 }]]) {
  const o = batch({ ...BASE, ...over, user: { skill: 3.0, a: 1.0, capT: 1.05 } }, Math.round(SEEDS / 2));
  const m = batch({ ...BASE, ...over, user: { skill: 1.5, a: 1.0, capT: 1.0 } }, Math.round(SEEDS / 2));
  const r = (all) => pct(all.filter((x) => x.userT1 > 0).length / all.length);
  const t2 = (all) => pct(all.filter((x) => Math.min(...x.userTier) <= 1).length / all.length);
  console.log(`${n}: OPTIMAL T1 ${r(o)} (T2 이상 ${t2(o)}) | MEDIAN T1 ${r(m)} (T2 이상 ${t2(m)})`);
}

console.log('\n=== F-3. 이적 없음 (M3.6 CAREER_SIM 조건: 수명주기만) ===');
summarize('F-3 maxDelta 0', batch({ ...BASE, maxDelta: 0 }, Math.round(SEEDS / 2)));
