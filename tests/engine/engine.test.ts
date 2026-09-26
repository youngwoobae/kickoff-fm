/** 엔진 테스트 목록 (소유: A). 구현하면서 it.todo 를 채운다. 기준은 docs/아키텍처.md 12장 */
import { describe, it } from 'vitest';

describe('simulateMatch', () => {
  it.todo('같은 SimulateInput → JSON.stringify 결과가 바이트 단위로 같다 (골든 시드 3개)');
  it.todo('모든 BINARY 로그에서 |tac| ≤ tacCap, p ∈ [0.05, 0.95] (DP5 는 [0.01, 0.85])');
  it.todo('tacticsEnabled=false 이면 모든 tac = 0');
  it.todo('DP 별 raw 키는 RULES_BY_DP 의 부분집합');
  it.todo('R6 이 켜진 DP4 실패마다 OFFSIDE 이벤트 1개, R2 가 켜진 DP1 성공마다 LONG_BALL_ADVANCE 1개');
  it.todo('시퀀스 수 = round(100 × tempoFactor × jitter), tempoFactor ∈ [0.85, 1.15]');
  it.todo('컨디션: 풀타임 소모 30 (압박 ±3/단계, 박스투박스 +3, 마커 +4)');
  it.todo('조건부 지시는 경기당 1회만 발동, 위에서부터 우선');
  it.todo('교체 최대 5명 / 3창');
});

describe('explainMatch (8.8)', () => {
  it.todo('결정 지점마다 Σ Δp_i = Δp_tac (오차 < 1e-9)');
  it.todo('clamp 발생 시 a_i = r_i × tac / S 로 비례 배분');
  it.todo('막대 합(전력+준비+전술+운) ≈ 실제 득실 차 (VALUE 근사, 허용오차 ±0.3)');
});

describe('calibration (1,000경기+ 배치)', () => {
  it.todo('BASELINE 1,000경기: 평균 총 득점 2.5~2.9, 무승부 22~28%, 팀당 슈팅 9~15');
  it.todo('OVR_DIFF_25 1,000경기: 강팀 승률 ≥ 85%');
  it.todo('RULE_ISOLATION: 규칙별 단독 기여 P95 ≤ 0.35, 합 P95 ≤ 0.6');
});
