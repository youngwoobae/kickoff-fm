/** 도메인 테스트 목록 (소유: A). 기준은 docs/아키텍처.md 12장 */
import { describe, it } from 'vitest';

describe('schedule', () => {
  it.todo('14팀 → 26경기일 × 7경기, 모든 쌍이 홈/원정 1회씩');
  it.todo('어떤 팀도 한 경기일에 2경기를 하지 않는다');
});

describe('standings / promotion', () => {
  it.todo('6.2 순위 결정 규칙 ①~⑦ 순서');
  it.todo('사람 팀 1위·2위 → PROMOTED, 11~14위 → RELEGATED, T5 는 강등 없음');
});

describe('condition (4.2 표 재현)', () => {
  it.todo('체력 보정 +3 선수 연속 출전: 100 → 70 → 87 → 57 → 74 → 44 → 61');
  it.todo('효율 배수: 87 → 0.985, 74 → 0.92, 61 → 0.855');
});

describe('resolvePlan (4.7)', () => {
  it.todo('확정본 > 기본 플랜 > 직전 사용 플랜(맞춤 지시 제거) > 시스템 기본');
  it.todo('초안은 절대 적용되지 않는다');
  it.todo('상대가 다른 맞춤 지시는 초기화');
  it.todo('부상·징계 대체 → 자동 로테이션(<70) → 유효성 보정 → 조건부 지시 비활성 순서');
});

describe('economy (7.4, 7.5)', () => {
  it.todo('T3 5위 12-6-8 → 수입 84.60M');
  it.todo('28일 연봉 차감 합계 = 연봉 총액 (반올림 오차 0)');
  it.todo('이월: R=16.8M, C=12.2M → carried 12.2M, excess 4.6M');
});

describe('permissions / proposals (5.0)', () => {
  it.todo('COACH: EDIT_PLAN·SUBMIT_PLAN·APPROVE 거부, PROPOSE 허용');
  it.todo('OWNER: PROPOSE 거부(자기 제안 불필요), APPROVE 허용');
  it.todo('COACH_SPECTATOR: PROPOSE 거부');
  it.todo('코치 1인 동시 OPEN 5장 제한, 동일 대상 중복 불가, 사유 1~80자');
  it.todo('승인 시 같은 path 의 다른 OPEN 제안은 SUPERSEDED');
  it.todo('승인 시 대상 선수가 부상이면 STALE');
  it.todo('대상 경기 마감(advanceDay) 시 OPEN → EXPIRED');
});

describe('advanceDay 상태 머신', () => {
  it.todo('MATCHDAY Day d → 7경기 → Day d+1 00:00 처리 → MATCHDAY/OFFSEASON');
  it.todo('Day 26 → pendingOutcome 설정, Day 27 상금 입금, Day 28 이월 → SEASON_OVER');
  it.todo('SEASON_OVER 에서 advanceDay 는 INVALID_PHASE');
  it.todo('같은 상태·같은 시드로 두 번 진행하면 결과가 같다 (멱등·결정적)');
  it.todo('시즌 1회 전체 진행 후 직렬화 크기 < 2MB');
});
