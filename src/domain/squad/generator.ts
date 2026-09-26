/** 선수·스쿼드 생성기 (4.1, 9.1). 모든 무작위는 주입된 Rng 로만. 소유: A. */
import type { BotStyleTag, Club, Player, Position, Tier } from '../../types';
import type { Rng } from '../../engine';

export interface GenerateSquadOptions {
  clubId: string;
  /** 주전 11명 목표 평균 OVR (로테이션 11명은 −6) */
  targetOvr: number;
  size: number;
  tier: Tier;
}

export function generatePlayer(_rng: Rng, _position: Position, _targetOvr: number, _age?: number): Player {
  throw new Error('TODO');
}

/** 기준 스쿼드 22명: GK 2 / CB 4 / FB 4 / DM 2 / CM 3 / AM 2 / W 2 / ST 3 [PH] */
export function generateSquad(_rng: Rng, _opts: GenerateSquadOptions): Player[] {
  throw new Error('TODO');
}

export function createBotClub(_rng: Rng, _id: string, _style: BotStyleTag, _players: readonly Player[]): Club {
  throw new Error('TODO');
}

export function computeOvr(_player: Pick<Player, 'attrs' | 'primary'>): number {
  throw new Error('TODO');
}
