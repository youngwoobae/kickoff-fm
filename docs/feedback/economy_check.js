// 기획서_v1 경제 수치 검증 스크립트 (economy.md 근거 계산)
// 실행: node economy_check.js
const T = {
  T1: { base: 200, cap: 150, w: 3.0, d: 1.2, l: 0.4 },
  T2: { base: 130, cap: 98, w: 2.0, d: 0.8, l: 0.3 },
  T3: { base: 85, cap: 64, w: 1.3, d: 0.5, l: 0.2 },
  T4: { base: 55, cap: 41, w: 0.85, d: 0.35, l: 0.12 },
  T5: { base: 35, cap: 26, w: 0.55, d: 0.2, l: 0.08 },
};
const tiers = ['T1', 'T2', 'T3', 'T4', 'T5'];
const f2 = (x) => (Math.round(x * 100) / 100).toFixed(2);
const S = (ovr) => 0.3 * Math.pow(1.1, ovr - 50);
const prizePct = (rank) => (rank === 1 ? 0.2 : rank <= 3 ? 0.15 : rank <= 6 ? 0.1 : rank <= 10 ? 0.06 : 0.03);
function seasonIncome(t, W, D, L, rank) {
  const x = T[t];
  const bonus = W * x.w + D * x.d + L * x.l;
  const prize = x.base * prizePct(rank) + (rank === 1 ? x.base * 0.1 : 0);
  return { base: x.base, bonus, prize, total: x.base + bonus + prize, perfShare: (bonus + prize) / (x.base + bonus + prize) };
}

console.log('=== A. 티어 배율 / 캡 비율 ===');
for (let i = 0; i < 4; i++) {
  const a = T[tiers[i]], b = T[tiers[i + 1]];
  console.log(`${tiers[i + 1]}->${tiers[i]} base x${f2(a.base / b.base)}  cap/base ${tiers[i]}=${f2(a.cap / a.base)}`);
}

console.log('\n=== B. 캡이 지탱하는 주전 OVR (주전11 @o, 벤치11 @o-6 구조) ===');
const k = 11 + 11 * Math.pow(1.1, -6);
const ceil = {};
for (const t of tiers) {
  const o = 50 + Math.log(T[t].cap / k / 0.3) / Math.log(1.1);
  ceil[t] = o;
  const at120 = 50 + Math.log((T[t].cap * 1.2) / k / 0.3) / Math.log(1.1);
  console.log(`${t}: cap ${T[t].cap} -> 주전 OVR ${f2(o)} (120% 유예 시 ${f2(at120)}) | 18명 전원 표 평균 OVR 연봉합: ${f2(18 * S({ T1: 85, T2: 80, T3: 76, T4: 71, T5: 66 }[t]))}`);
}

console.log('\n=== C. 시즌 수입 (성적별), 성과 비중, 캡 대비 잉여 ===');
const recs = [
  ['우승 20-4-2', 20, 4, 2, 1],
  ['2위 18-4-4', 18, 4, 4, 2],
  ['5위 12-6-8', 12, 6, 8, 5],
  ['9위 9-7-10', 9, 7, 10, 9],
  ['최하위 4-5-17', 4, 5, 17, 14],
];
for (const t of tiers) {
  for (const [n, W, D, L, r] of recs) {
    const s = seasonIncome(t, W, D, L, r);
    console.log(`${t} ${n}: 수입 ${f2(s.total)} (성과비중 ${(s.perfShare * 100).toFixed(1)}%) 캡 채운 뒤 잉여 ${f2(s.total - T[t].cap)} = 배정금의 ${(((s.total - T[t].cap) / T[t].base) * 100).toFixed(0)}%`);
  }
}

console.log('\n=== D. 7.5 예시 비율 재계산 ===');
const inc75 = 85 + 8 + 15.6 + 3 + 1.6 + 8.5 + 14.25;
const exp75 = 60 + 30 + 1.5 + 5 + 2 + 4 + 6 + 8;
console.log(`수입 ${f2(inc75)} 지출 ${f2(exp75)} 비율(이월 포함) ${f2(inc75 / exp75)} 비율(이월 제외) ${f2((inc75 - 8) / exp75)}`);
console.log(`MVP(시설·유스 14.0 제외) 비율(이월 포함) ${f2(inc75 / (exp75 - 14))} (이월 제외) ${f2((inc75 - 8) / (exp75 - 14))}`);
console.log(`MVP 잔액 ${f2(inc75 - (exp75 - 14))} -> 이월 17.0, LP ${f2(inc75 - (exp75 - 14) - 17)}`);

console.log('\n=== E. 28일 현금흐름: 7일 이동 수입/지출 비율 (T3 5위형, 이적 없음) ===');
{
  const x = T['T3'];
  const wage = 60 / 28; // 일할
  const inc = new Array(29).fill(0), exp = new Array(29).fill(0);
  inc[1] += x.base; // Day1 배정금
  const perGame = (12 * x.w + 6 * x.d + 8 * x.l) / 26;
  for (let d = 1; d <= 26; d++) inc[d] += perGame;
  inc[28] += x.base * 0.1; // 순위상금 Day28
  for (let d = 1; d <= 28; d++) exp[d] += wage;
  const out = [];
  for (let d = 7; d <= 28; d++) {
    let a = 0, b = 0;
    for (let j = d - 6; j <= d; j++) { a += inc[j]; b += exp[j]; }
    out.push(`D${d}:${f2(a / b)}`);
  }
  console.log(out.join(' '));
  console.log(`경기일 평균 일수입 ${f2(perGame)} vs 일 연봉 ${f2(wage)} -> Day8~26 비율 ${f2(perGame / wage)}`);
}

console.log('\n=== F. 이적 입찰 타이밍 (48h 최소 + 12:00 정산) vs Day28 00:00 정산 ===');
{
  // 시각을 시즌 시작 기준 시간(h)으로. Day d 00:00 = (d-1)*24
  const settleAt = (d) => (d - 1) * 24 + 12;
  const firstSettle = (placeH) => { let d = 1; while (settleAt(d) < placeH + 48) d++; return d; };
  const windows = [['중간창 Day13 00:00', 12 * 24], ['중간창 Day15 23:59', 15 * 24 - 0.01], ['정규창 Day27 00:00', 26 * 24]];
  for (const [n, h] of windows) console.log(`${n} 입찰 -> 최초 정산 Day${firstSettle(h)} 12:00 (28 초과 = 다음 시즌)`);
  console.log('Day28 00:00 정산(이월 상한 적용) 이전에 결제되는 마지막 입찰: 중간창 Day15까지(정산 Day17). Day17~Day28 사이 KC 소진 수단 = 재계약 보너스·스카우트·방출 위약금뿐');
}

console.log('\n=== G. 승격/강등 직후 가용 자금 (이적료용 = 배정금+보너스/낙하산+이월 - 캡) ===');
{
  const moves = [['T4->T3 승격', 'T3', 12.75, 0, 1.0], ['T3->T2 승격', 'T2', 19.5, 0, 1.0], ['T2->T1 승격', 'T1', 30, 0, 1.0],
    ['T2->T3 강등', 'T3', 0, 22.5, 1.2], ['T1->T2 강등', 'T2', 0, 35, 1.2], ['T3->T4 강등', 'T4', 0, 15, 1.2]];
  for (const [n, t, bonus, para, capx] of moves) {
    const carry = T[t].base * 0.2;
    const avail = T[t].base + bonus + para + carry;
    console.log(`${n}: 가용 ${f2(avail)} (이월상한 ${f2(carry)}) - 연봉한도 ${f2(T[t].cap * capx)} = 이적료 여력 ${f2(avail - T[t].cap * capx)}`);
  }
  // 강등팀이 캡 120%로 맞추며 파는 선수 가치
  for (const [from, to] of [['T2', 'T3'], ['T1', 'T2']]) {
    const shed = T[from].cap - T[to].cap * 1.2;
    console.log(`${from}->${to} 강등: 줄여야 할 연봉 ${f2(shed)}M -> 매각 가치 약 ${f2(shed * 5 * 0.8 * 0.95)}M (V=5xS, 나이·계약계수 0.8, 판매세 5%)`);
  }
  // 승격팀 주전 업그레이드 비용
  const up = (o0, o1) => 55 * S(o0) * (Math.pow(1.1, o1 - o0) - 1) * 1.1;
  console.log(`T4 천장 ${f2(ceil.T4)} -> T3 천장 ${f2(ceil.T3)} 주전11 업그레이드 비용(세금 포함 근사) ${f2(up(ceil.T4, ceil.T3))}M`);
  console.log(`T3 천장 ${f2(ceil.T3)} -> T2 천장 ${f2(ceil.T2)} 비용 ${f2(up(ceil.T3, ceil.T2))}M`);
}

console.log('\n=== H. 장기계약 유망주 캡 우회 ===');
{
  const o0 = 66, pot = 81;
  const fee = S(o0) * 5 * 1.3 * 1.45;
  console.log(`19세 OVR${o0} 잠재${pot}: 이적료 ${f2(fee)}M, 연봉 ${f2(S(o0))}M 고정(5시즌 계약)`);
  for (let s = 1; s <= 5; s++) {
    const o = Math.min(pot, o0 + 4 * s);
    console.log(` 시즌${s}: OVR ${o} 시장연봉 ${f2(S(o))} vs 캡 산입 ${f2(S(o0))} -> 캡 절감 ${f2(S(o) - S(o0))}`);
  }
  const teamSave = 11 * (S(80) - S(68));
  console.log(`주전 11명 모두 이런 선수(현재 80, 계약 연봉은 68 기준)면 캡 절감 ${f2(teamSave)}M = T3 캡의 ${((teamSave / 64) * 100).toFixed(0)}%`);
}

// ---------------- Monte Carlo ----------------
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const R = rng(20260926);
const gauss = () => { let u = 0, v = 0; while (u === 0) u = R(); v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
// 순서형 로짓: OVR 차 10 -> 승 64%, 동률 37/26/37 (8.1 보정 목표)
const K = 0.1107, C0 = 0.532;
const sig = (x) => 1 / (1 + Math.exp(-x));
function play(a, b) { const d = K * (a - b); const r = R(); const pw = sig(d - C0), pl = sig(-d - C0); return r < pw ? 3 : r < pw + (1 - pw - pl) ? 1 : 0; }

function simulatePyramid({ seasons = 30, catchUp = true, relegPower = true, promoBonus = 0.15, grace = 1.2, budgetFn = null }) {
  const nLeagues = [1, 2, 4, 8, 16];
  const teams = [];
  let id = 0;
  const leagues = [];
  nLeagues.forEach((n, ti) => {
    for (let li = 0; li < n; li++) {
      const L = [];
      for (let j = 0; j < 14; j++) {
        const t = { id: id++, skill: gauss() * 2.5, ovr: ceil[tiers[ti]], tier: ti, status: 'native' };
        teams.push(t); L.push(t);
      }
      leagues.push({ tier: ti, idx: li, teams: L });
    }
  });
  const stats = { promotedN: 0, promotedRelegated: 0, promotedRepromoted: 0, relegN: 0, relegRepromoted: 0, champN: 0, champRepeat: 0 };
  let lastChamp = new Map();
  for (let s = 0; s < seasons; s++) {
    const promo = [], releg = [];
    const byTier = nLeagues.map(() => []);
    for (const lg of leagues) {
      const pts = new Map(lg.teams.map((t) => [t, 0]));
      for (const a of lg.teams) for (const b of lg.teams) if (a !== b) {
        const r = play(a.ovr + a.skill, b.ovr + b.skill);
        pts.set(a, pts.get(a) + r); pts.set(b, pts.get(b) + (r === 3 ? 0 : r === 1 ? 1 : 3));
      }
      const table = [...lg.teams].sort((x, y) => pts.get(y) - pts.get(x) + (R() - 0.5) * 0.01);
      table.forEach((t, i) => { t.rank = i + 1; });
      if (s >= 5) {
        for (const t of table) {
          if (t.status === 'promoted') { stats.promotedN++; if (t.rank >= 11 && lg.tier < 4) stats.promotedRelegated++; if (t.rank <= 2 && lg.tier > 0) stats.promotedRepromoted++; }
          if (t.status === 'relegated') { stats.relegN++; if (t.rank <= 2 && lg.tier > 0) stats.relegRepromoted++; }
        }
        const ch = table[0];
        if (lastChamp.get(`${lg.tier}-${lg.idx}`)) { stats.champN++; if (lastChamp.get(`${lg.tier}-${lg.idx}`) === ch) stats.champRepeat++; }
        lastChamp.set(`${lg.tier}-${lg.idx}`, ch);
      }
      if (lg.tier > 0) promo.push(...table.slice(0, 2).map((t) => [t, lg]));
      if (lg.tier < 4) releg.push(...table.slice(10).map((t) => [t, lg]));
    }
    // 이동
    for (const t of teams) { t.status = 'native'; }
    for (const [t] of promo) { t.tier -= 1; t.status = 'promoted'; }
    for (const [t] of releg) { t.tier += 1; t.status = 'relegated'; }
    // 전력 갱신 (경제 모델): 천장 = 새 티어 캡이 지탱하는 OVR, 강등팀은 1시즌 120% 유예
    for (const t of teams) {
      const tn = tiers[t.tier];
      const c = ceil[tn];
      if (t.status === 'relegated') {
        const c120 = 50 + Math.log((T[tn].cap * grace) / k / 0.3) / Math.log(1.1);
        t.ovr = relegPower ? Math.min(t.ovr, c120) : c;
      } else if (t.status === 'promoted') {
        // 첫 시즌 이적료 여력으로 따라잡는 양
        const budget = budgetFn ? budgetFn(t, tn) : T[tn].base * (1 + promoBonus + 0.2) - T[tn].cap;
        let o = t.ovr;
        if (catchUp) { let spent = 0; while (o < c && spent < budget) { spent += 55 * S(o) * 0.1 * 1.1; o += 1; } }
        t.ovr = Math.min(o, c);
      } else {
        // 기존 팀: 천장 쪽으로 수렴(1시즌 절반), 초과면 천장으로
        t.ovr = t.ovr > c ? c : t.ovr + (c - t.ovr) * 0.6;
      }
    }
    // 리그 재배치: 티어별로 모아서 셔플 배분
    for (let ti = 0; ti < 5; ti++) byTier[ti] = teams.filter((t) => t.tier === ti);
    for (let ti = 0; ti < 5; ti++) {
      const pool = byTier[ti].sort(() => R() - 0.5);
      const lgs = leagues.filter((l) => l.tier === ti);
      lgs.forEach((l, i) => { l.teams = pool.slice(i * 14, i * 14 + 14); });
    }
  }
  return stats;
}
console.log('\n=== I. 피라미드 몬테카를로 (5티어 31리그 434팀, 30시즌, 앞 5시즌 버림) ===');
for (const cfg of [{ catchUp: true, relegPower: true, label: '현행 규칙(강등팀 120% 유예, 승격팀 부분 보강)' },
  { catchUp: true, relegPower: false, label: '강등팀 유예 없음(즉시 새 캡)' }]) {
  const st = simulatePyramid(cfg);
  console.log(`${cfg.label}: 승격 직후 시즌 강등률 ${((st.promotedRelegated / st.promotedN) * 100).toFixed(1)}% | 승격 직후 연속 승격 ${((st.promotedRepromoted / st.promotedN) * 100).toFixed(1)}% | 강등팀 즉시 재승격 ${((st.relegRepromoted / st.relegN) * 100).toFixed(1)}% | 동일 리그 우승 연속 ${((st.champRepeat / st.champN) * 100).toFixed(1)}%`);
}
console.log('(기준선: 무작위라면 강등 4/14=28.6%, 승격 2/14=14.3%)');

console.log('\n=== J. AI 대행 구단 계약 만료 붕괴 (이적·재계약 없음) ===');
{
  const runs = 2000; const res = [0, 0, 0, 0, 0].map(() => ({ xi: 0, n: 0, temp: 0 }));
  for (let r = 0; r < runs; r++) {
    const c = ceil.T3;
    let squad = [];
    for (let i = 0; i < 22; i++) {
      const starter = i < 11;
      squad.push({ ovr: starter ? c + gauss() : c - 6 + gauss(), age: 18 + Math.floor(R() * 15), yrs: 1 + Math.floor(R() * 5), temp: false });
    }
    for (let s = 0; s < 5; s++) {
      const xi = squad.map((p) => p.ovr).sort((a, b) => b - a).slice(0, 11);
      res[s].xi += xi.reduce((a, b) => a + b, 0) / 11; res[s].temp += squad.filter((p) => p.temp).length; res[s].n++;
      // 시즌 종료: 나이·성장, 계약 만료 이탈
      for (const p of squad) { p.age++; p.ovr += p.age <= 23 ? 1.5 : p.age >= 30 ? -1.5 : 0; p.yrs--; }
      squad = squad.filter((p) => p.temp || p.yrs > 0);
      while (squad.length < 18) squad.push({ ovr: c - 15, age: 30, yrs: 99, temp: true });
    }
  }
  const base = res[0].xi / res[0].n;
  res.forEach((x, s) => {
    const xi = x.xi / x.n; const d = xi - base;
    // 동급 상대 대비 기대 승점
    const pw = sig(K * d - C0), pl = sig(-K * d - C0); const ppg = 3 * pw + (1 - pw - pl);
    console.log(`시즌${s + 1} 시작: 주전 평균 OVR ${f2(xi)} (${f2(d)}), 임시계약 ${f2(x.temp / x.n)}명, 동급 상대 기대 PPG ${f2(ppg)} (기준 1.37 대비 ${((ppg / 1.37) * 100).toFixed(0)}%)`);
  });
}

console.log('\n=== K. 스타 팩 보너스율 (1,200원=100★ 기준) ===');
for (const [won, star] of [[1200, 100], [5900, 520], [11000, 1000], [33000, 3200]]) {
  const baseStar = (won / 1200) * 100;
  console.log(`${won}원 ${star}★: 기준 대비 +${(((star / baseStar) - 1) * 100).toFixed(1)}%, ★당 ${f2(won / star)}원`);
}
console.log(`시즌 패스 9,900원 x 13시즌 = ${9900 * 13}원/년 (월 표기 대비 ${(13 / 12 * 100 - 100).toFixed(1)}% 추가)`);

console.log('\n=== L. 코치 금액 구간 B = 잔액 − 예약액 의 시즌 내 변동 (T3) ===');
for (const d of [1, 7, 14, 21, 26]) {
  const bal = 85 + 17 - (64 / 28) * (d - 1) + (1.0 * (d - 1)) ; // 이적 없음, 일 수당 ~0.8~1.0
  const liab = (64 / 28) * (28 - d + 1);
  console.log(`Day${d}: 잔액 ${f2(bal)} -> 소액 한도 ${f2(bal * 0.05)} | 잔여 연봉부채 ${f2(liab)} 차감 시 실가용 ${f2(bal - liab)} -> 소액 ${f2((bal - liab) * 0.05)}`);
}

console.log('\n=== M. 제안값 민감도 (승격 보너스 / 강등 유예) ===');
for (const cfg of [
  { promoBonus: 0.15, grace: 1.2, label: '현행 15% / 120%' },
  { promoBonus: 0.30, grace: 1.2, label: '보너스 30% / 120%' },
  { promoBonus: 0.30, grace: 1.1, label: '보너스 30% / 110%' },
  { promoBonus: 0.40, grace: 1.1, label: '보너스 40% / 110%' },
]) {
  const st = simulatePyramid({ catchUp: true, relegPower: true, ...cfg });
  console.log(`${cfg.label}: 승격 직후 강등 ${((st.promotedRelegated / st.promotedN) * 100).toFixed(1)}% | 강등팀 즉시 재승격 ${((st.relegRepromoted / st.relegN) * 100).toFixed(1)}%`);
}

console.log('\n=== N. 제안 배정금표 (배정금 = 현행 x0.72, 승리수당 x0.85, 캡 유지) ===');
{
  for (const t of tiers) {
    const x = T[t]; const nb = Math.round(x.base * 0.72 * 2) / 2;
    const y = { ...x, base: nb, w: Math.round(x.w * 0.85 * 100) / 100 };
    const inc = (W, D, L, r) => { const bonus = W * y.w + D * y.d + L * y.l; const pr = nb * prizePct(r) + (r === 1 ? nb * 0.1 : 0); return [nb + bonus + pr, (bonus + pr) / (nb + bonus + pr)]; };
    const [ch, chs] = inc(20, 4, 2, 1), [mid] = inc(12, 6, 8, 5), [last] = inc(4, 5, 17, 14);
    console.log(`${t}: 배정금 ${nb} 캡 ${x.cap} 승리 ${y.w} | 최하위 ${f2(last)} (캡 대비 ${f2(last / x.cap)}) 5위 ${f2(mid)} (${f2(mid / x.cap)}) 우승 ${f2(ch)} (${f2(ch / x.cap)}, 성과비중 ${(chs * 100).toFixed(1)}%)`);
  }
}

// ======================= v2 재검증 (기획서_v2 채택값) =======================
// 채택: E-05 배정금 x0.72(0.5 단위 반올림), 승리 수당 x0.85, 무승부 수당 x0.85(무/승 비율 약 40% 유지 — v2에서 추가 조정), 패배 수당·캡 유지
//       E-08 승격 보너스 30%, E-09 강등 캡 유예 110%, E-06 이월 초과분은 정규창 한정 예산(창 종료 후 LP)
console.log('\n\n######## v2 재검증 ########');
const V2 = {};
for (const t of tiers) {
  const x = T[t];
  V2[t] = { base: Math.round(x.base * 0.72 * 2) / 2, cap: x.cap, w: Math.round(x.w * 0.85 * 100) / 100, d: Math.round(x.d * 0.85 * 100) / 100, l: x.l };
}
const r2 = (v) => Math.round(v * 100) / 100;
function inc2(t, W, D, L, rank) {
  const x = V2[t]; const bonus = W * x.w + D * x.d + L * x.l;
  const prize = x.base * prizePct(rank) + (rank === 1 ? x.base * 0.1 : 0);
  return { bonus, prize, total: x.base + bonus + prize, perf: (bonus + prize) / (x.base + bonus + prize) };
}
console.log('=== O-1. v2 티어표 ===');
for (let i = 0; i < 5; i++) {
  const t = tiers[i], x = V2[t];
  const promo = i < 4 ? r2(x.base * 0.3) : '-';
  const para = i > 0 ? r2((V2[tiers[i - 1]].base - x.base) * 0.5) : '-';
  console.log(`${t}: 배정금 ${x.base} 캡 ${x.cap} (캡/배정금 ${f2(x.cap / x.base)}) 승 ${x.w} 무 ${x.d} (무/승 ${f2(x.d / x.w)}) 패 ${x.l} 전승수당 ${f2(26 * x.w)} | 1위 ${r2(x.base * .2)} 2~3 ${r2(x.base * .15)} 4~6 ${r2(x.base * .1)} 7~10 ${r2(x.base * .06)} 11~14 ${r2(x.base * .03)} 우승 ${r2(x.base * .1)} | 이 티어로 승격 보너스 ${promo} | 이 티어로 강등 시 보조금 상한 ${para} | 이월 상한 ${r2(x.base * .2)}`);
}
console.log('=== O-2. v2 성적별 수입 (성과 비중 = (수당+상금)/(배정금+수당+상금), 승격 보너스·이월·보조금 제외) ===');
for (const t of tiers) {
  const row = recs.map(([n, W, D, L, r]) => { const s = inc2(t, W, D, L, r); return `${n.split(' ')[0]} ${f2(s.total)}(${(s.perf * 100).toFixed(1)}%, 캡 대비 ${f2(s.total / V2[t].cap)})`; });
  console.log(`${t}: ${row.join(' | ')}`);
}
console.log('=== O-3. v2 7.5 예시 (T3 5위 12-6-8, MVP=시설·유스 없음, 경매 없음) ===');
{
  const s = inc2('T3', 12, 6, 8, 5);
  const carryIn = 8.0;
  const sources = s.total; // 배정금+수당+상금 (순유입 분자)
  const wage = 60.0, sys = 12.0, fa = 2.0, renew = 3.0, rel = 1.0, scout = 2.0, sysSale = 4.2; // 시스템 매각 대금 7.0x0.6
  const sinks = wage + sys + fa + renew + rel + scout;
  console.log(`분자(배정금+수당+상금) ${f2(sources)} = 61 + ${f2(s.bonus)} + ${f2(s.prize)}`);
  console.log(`분모(연봉 ${wage} + 시스템 이적료 ${sys} + FA 계약금 ${fa} + 갱신 ${renew} + 위약금 ${rel} + 스카우트 ${scout}) = ${f2(sinks)} -> 순유입 비율 ${f2(sources / sinks)}`);
  const bal = carryIn + sources + sysSale - sinks;
  console.log(`잔액 = 이월 ${carryIn} + ${f2(sources)} + 시스템 매각 ${sysSale} - ${f2(sinks)} = ${f2(bal)} ; 이월 상한 ${r2(61 * .2)} -> 한정 예산 ${f2(Math.max(0, bal - 12.2))}`);
}
console.log('=== O-4. 승격팀 첫 시즌 이적 여력 (전 시즌 잉여 전액[한정 예산+이월] + 새 배정금 x(1+보너스) - 새 캡) ===');
const surplus2 = (t, W, D, L, r) => inc2(t, W, D, L, r).total - V2[t].cap;
for (const [from, to] of [['T5', 'T4'], ['T4', 'T3'], ['T3', 'T2'], ['T2', 'T1']]) {
  for (const b of [0.15, 0.3]) {
    const s2nd = surplus2(from, 18, 4, 4, 2);
    console.log(`${from}->${to} (2위 승격, 보너스 ${b * 100}%): 전 시즌 잉여 ${f2(s2nd)} + 새 배정금 ${V2[to].base} x ${1 + b} - 캡 ${V2[to].cap} = ${f2(s2nd + V2[to].base * (1 + b) - V2[to].cap)}`);
  }
}
{
  const idx = (tn) => tiers.indexOf(tn);
  const mk = (bonus) => (t, tn) => { const lower = tiers[idx(tn) + 1]; return surplus2(lower, 18, 4, 4, 2) + V2[tn].base * (1 + bonus) - V2[tn].cap; };
  console.log('=== O-5. v2 피라미드 몬테카를로 (승격팀 예산 = O-4 식) ===');
  for (const cfg of [{ bonus: 0.15, grace: 1.2 }, { bonus: 0.3, grace: 1.1 }, { bonus: 0.3, grace: 1.2 }]) {
    const st = simulatePyramid({ catchUp: true, relegPower: true, grace: cfg.grace, promoBonus: cfg.bonus, budgetFn: mk(cfg.bonus) });
    console.log(`보너스 ${cfg.bonus * 100}% / 유예 ${cfg.grace * 100}%: 승격 직후 강등 ${((st.promotedRelegated / st.promotedN) * 100).toFixed(1)}% | 강등팀 즉시 재승격 ${((st.relegRepromoted / st.relegN) * 100).toFixed(1)}%`);
  }
}
console.log('=== O-6. AI 대행 보수적 계약 정책(E-04) 적용 시 ===');
{
  const runs = 2000; const res = [0, 0, 0, 0, 0].map(() => ({ xi: 0, n: 0, temp: 0 }));
  for (let r = 0; r < runs; r++) {
    const c = ceil.T3; let squad = [];
    for (let i = 0; i < 22; i++) { const st = i < 11; squad.push({ ovr: st ? c + gauss() : c - 6 + gauss(), age: 18 + Math.floor(R() * 15), yrs: 1 + Math.floor(R() * 5), temp: false }); }
    for (let s = 0; s < 5; s++) {
      const xi = squad.map((p) => p.ovr).sort((a, b) => b - a).slice(0, 11);
      res[s].xi += xi.reduce((a, b) => a + b, 0) / 11; res[s].temp += squad.filter((p) => p.temp).length; res[s].n++;
      // Day 27: 만료 예정자 중 상위 18명 & 31세 이하 자동 재계약(2시즌)
      const ranked = [...squad].sort((a, b) => b.ovr - a.ovr); const top18 = new Set(ranked.slice(0, 18));
      for (const p of squad) if (!p.temp && p.yrs === 1 && top18.has(p) && p.age <= 31) p.yrs += 2;
      for (const p of squad) { p.age++; p.ovr += p.age <= 23 ? 1.5 : p.age >= 30 ? -1.5 : 0; p.yrs--; }
      squad = squad.filter((p) => p.temp || p.yrs > 0);
      // 20명 미만이면 FA 최저가 입찰로 결원 충원(시즌당 최대 3명, 벤치급 = 천장-6)
      let signed = 0; while (squad.length < 20 && signed < 3) { squad.push({ ovr: c - 6 + gauss(), age: 24 + Math.floor(R() * 6), yrs: 2, temp: false }); signed++; }
      while (squad.length < 18) squad.push({ ovr: c - 15, age: 30, yrs: 99, temp: true });
    }
  }
  const base = res[0].xi / res[0].n;
  res.forEach((x, s) => { const xi = x.xi / x.n; const d = xi - base; const pw = sig(K * d - C0), pl = sig(-K * d - C0); const ppg = 3 * pw + (1 - pw - pl);
    console.log(`시즌${s + 1} 시작: 주전 OVR ${f2(xi)} (${f2(d)}), 임시 ${f2(x.temp / x.n)}명, PPG ${((ppg / 1.37) * 100).toFixed(0)}%`); });
}
console.log('=== O-7. 3시즌 아키타입 수기 추정 (v2 수치, 캡 94% 사용, 시즌 잉여는 이월 상한까지 이월·나머지는 정규창 한정 예산으로 이적에 사용 가정) ===');
{
  const arche = {
    '캐주얼(T4 9위 유지, AI 대행 포함)': [['T4', 9, 7, 10, 9, null], ['T4', 9, 7, 10, 9, null], ['T4', 9, 7, 10, 9, null]],
    '코어(T4 2위 승격 -> T3 5위 -> T3 5위)': [['T4', 18, 4, 4, 2, 'T3'], ['T3', 12, 6, 8, 5, null], ['T3', 12, 6, 8, 5, null]],
    '그라인더(T3 우승 -> T2 우승 -> T1 5위)': [['T3', 20, 4, 2, 1, 'T2'], ['T2', 20, 4, 2, 1, 'T1'], ['T1', 12, 6, 8, 5, null]],
  };
  for (const [name, seq] of Object.entries(arche)) {
    let carry = 0; let promoIn = 0; const out = [];
    for (const [t, W, D, L, r, next] of seq) {
      const s = inc2(t, W, D, L, r); const income = s.total + promoIn; const wage = V2[t].cap * 0.94;
      const nextTier = next || t; const cap = V2[nextTier].base * 0.2;
      const surplus = carry + income - wage; const carryOut = Math.min(cap, surplus); const window = surplus - carryOut;
      out.push(`${t} 수입 ${f2(income)}(보너스 ${f2(promoIn)}) 연봉 ${f2(wage)} 이월 ${f2(carryOut)} 정규창 한정 예산 ${f2(window)}`);
      carry = carryOut; promoIn = next ? V2[next].base * 0.3 : 0;
    }
    console.log(`${name}: ${out.join(' || ')}`);
  }
}
console.log('=== O-8. v2 승격 보너스 민감도 (유예 110%) ===');
{
  const idx = (tn) => tiers.indexOf(tn);
  const mk = (bonus) => (t, tn) => surplus2(tiers[idx(tn) + 1], 18, 4, 4, 2) + V2[tn].base * (1 + bonus) - V2[tn].cap;
  for (const b of [0.3, 0.45, 0.6, 0.8]) {
    const st = simulatePyramid({ catchUp: true, relegPower: true, grace: 1.1, promoBonus: b, budgetFn: mk(b) });
    console.log(`보너스 ${Math.round(b * 100)}%: 승격 직후 강등 ${((st.promotedRelegated / st.promotedN) * 100).toFixed(1)}% | 강등팀 즉시 재승격 ${((st.relegRepromoted / st.relegN) * 100).toFixed(1)}%`);
  }
}
