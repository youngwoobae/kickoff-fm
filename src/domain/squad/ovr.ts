/** 표시용 OVR (주 포지션 가중합 × 5, 4.1). 엔진은 사용하지 않는다. 소유: A. */
import type { AttrKey, Player, Position } from '../../types';
import { clamp } from '../../engine';

export const OVR_WEIGHTS: Record<Position, Partial<Record<AttrKey, number>>> = {
  GK: { reflexes: 0.35, aerialCommand: 0.2, kicking: 0.1, positioning: 0.15, composure: 0.1, physical: 0.1 },
  CB: { tackling: 0.25, positioning: 0.2, physical: 0.2, pace: 0.1, passing: 0.1, composure: 0.1, workRate: 0.05 },
  FB: { tackling: 0.15, positioning: 0.15, pace: 0.2, crossing: 0.15, stamina: 0.1, workRate: 0.1, dribbling: 0.05, passing: 0.1 },
  DM: { tackling: 0.2, positioning: 0.2, passing: 0.2, workRate: 0.1, vision: 0.1, composure: 0.1, physical: 0.1 },
  CM: { passing: 0.2, vision: 0.15, workRate: 0.15, dribbling: 0.1, tackling: 0.1, stamina: 0.1, composure: 0.1, positioning: 0.1 },
  AM: { vision: 0.25, passing: 0.2, dribbling: 0.2, composure: 0.1, finishing: 0.15, pace: 0.1 },
  W: { pace: 0.2, dribbling: 0.2, crossing: 0.2, finishing: 0.1, vision: 0.1, workRate: 0.1, passing: 0.1 },
  ST: { finishing: 0.3, composure: 0.15, positioning: 0.2, pace: 0.1, physical: 0.1, dribbling: 0.1, workRate: 0.05 },
};

export function computeOvr(player: Pick<Player, 'attrs' | 'primary'>): number {
  return ovrAt(player, player.primary);
}

/** 임의 포지션 기준 OVR (라인업 선택용) */
export function ovrAt(player: Pick<Player, 'attrs'>, position: Position): number {
  const w = OVR_WEIGHTS[position];
  let s = 0;
  for (const k of Object.keys(w) as AttrKey[]) s += (w[k] ?? 0) * player.attrs[k];
  return clamp(Math.round(s * 5), 1, 100);
}
