/**
 * 계약 2.3.0 (M5.1) 접근자 모음 (소유: B). 타입은 src/types 의 실제 2.3.0 타입을 다시 내보낸다.
 * 2.3.0 필드는 모두 선택이라 없을 때의 기본값을 여기서 한 번만 정한다.
 */
import type { Club, Player } from '../types';

export type { TrainingFocus, YouthCandidate, YouthIntake } from '../types';

/** Club.training (없으면 { focus: 'BALANCED' }) */
export const trainingOf = (club: Club | undefined): NonNullable<Club['training']> => club?.training ?? { focus: 'BALANCED' };

/** Availability.yellowAccum (0..4, 없으면 0) */
export const yellowAccumOf = (p: Player): number => p.availability.yellowAccum ?? 0;
/** PlayerSeasonStats.yellowCards (표시용 시즌 경고 수, 구 서비스면 undefined) */
export const yellowCardsOf = (p: Player): number | undefined => p.season.yellowCards;

/** 경고 누적 정지 기준 (수명주기 10.1 yellowLimit) */
export const YELLOW_LIMIT = 5;

/** 유스 편지 종류. YOUTH_OFFERED 는 사건 이름(편지로는 YOUTH_INTAKE 로 온다) — 혹시 그대로 와도 유스로 보이게 */
export const YOUTH_INBOX_KINDS: readonly string[] = ['YOUTH_INTAKE', 'YOUTH_OFFERED', 'YOUTH_AUTO_DECIDED'];
