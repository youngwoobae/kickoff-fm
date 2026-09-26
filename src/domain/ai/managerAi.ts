/**
 * 감독 AI 단일 모듈 (3.5, 6.6). 봇 운영, "추천대로", 자동 로테이션, 유효성 보정이 같은 코드를 쓰고
 * 강도 파라미터(mode)만 다르다. 소유: A.
 */
import type { BotStyleTag, Club, MatchPlan, OpponentScout, Player, TacticSlot } from '../../types';
import type { Rng } from '../../engine';

export type ManagerAiMode = 'BOT' | 'RECOMMEND' | 'SYSTEM_DEFAULT';

export interface ManagerAiContext {
  club: Club;
  players: Readonly<Record<string, Player>>;
  opponentId: string | null;
  scout?: OpponentScout;
  mode: ManagerAiMode;
  rng: Rng;
}

/** 성향별 기본 전술 슬롯 A/B */
export function styleTactics(_style: BotStyleTag): { A: TacticSlot; B: TacticSlot } {
  throw new Error('TODO');
}

/** 최적 선발 11 + 벤치 7 (적합도 × 컨디션 효율 × 역할 핵심 능력치) */
export function pickLineup(_ctx: ManagerAiContext, _slot: TacticSlot): MatchPlan['lineup'] {
  throw new Error('TODO');
}

export function buildPlan(_ctx: ManagerAiContext): MatchPlan {
  throw new Error('TODO');
}
