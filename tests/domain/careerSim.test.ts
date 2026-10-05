/** M3.6 CAREER_SIM 축약 게이트 (2시드 × 3시즌). 전체 판정은 npm run sim:career (20시드 × 10시즌) */
import { describe, expect, it } from 'vitest';
import { runCareerSim } from '../../src/domain';

describe('CAREER_SIM 축약', () => {
  it('2시드 × 3시즌: 구조·경제 안전 게이트 통과, 판정표 항목 모두 출력', () => {
    const r = runCareerSim({ seeds: 2, seasons: 3 });
    const gate = (id: string) => r.gates.find((g) => g.id === id)!;
    // 표본이 작아 확률 게이트(P·B·U)는 보지 않고, 깨지면 버그인 결정적 게이트만 본다.
    // L-C6(재생성 시즌 평균)은 빼고 전체 판정(sim:career)에 맡긴다: 3시즌이면 경계 2개 중 첫 경계(빈 FA 풀 → 재생성 몰림)가 평균을 지배한다(M4.8)
    for (const id of ['C1', 'C2', 'C3', 'C4', 'C5', 'P1', 'E3', 'L-C1', 'L-C2', 'L-C8']) expect(gate(id).pass, `${id} ${gate(id).value}`).toBe(true);
    expect(gate('L-C6').pass).not.toBeNull();
    expect(r.runs.every((x) => x.starts.length === 3 && x.ends.length === 3)).toBe(true);
    expect(r.gates.filter((g) => g.group === 'ECON' && g.kind === 'HARD')).toHaveLength(16);
    expect(r.gates.filter((g) => g.group === 'ECON' && g.kind === 'WARN')).toHaveLength(9); // 2.4.1: C4F
  }, 60_000);
});
