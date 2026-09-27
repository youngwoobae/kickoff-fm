/** 컨디션·부상·징계·사기의 일일/경기 후 처리 (4.2, 4.3). 소유: A. */
import type { Player, PlayerMatchLine, Step } from '../../types';
import { EngineConstants, clamp } from '../../engine';

const C = EngineConstants.CONDITION;

/** 체력 능력치 1..20 → 회복 보정 0..6 */
export function staminaRecoveryBonus(stamina: number): number {
  return Math.round(((clamp(stamina, 1, 20) - 1) / 19) * C.dailyRecoveryStaminaMax);
}

/** 00:00: +14 + 체력 보정(0~6), 부상 일수 −1 */
export function applyDailyRecovery(player: Player): Player {
  const condition = Math.min(100, player.condition + C.dailyRecoveryBase + staminaRecoveryBonus(player.attrs.stamina));
  const injuryDays = Math.max(0, player.availability.injuryDays - 1);
  return { ...player, condition, availability: { ...player.availability, injuryDays } };
}

/** 경기 결과 반영: 컨디션, 부상, 퇴장 → 1경기 정지, 시즌 스탯, 출장 정지 소화 */
export function applyMatchLine(player: Player, line: PlayerMatchLine | undefined, clubPlayed: boolean): Player {
  if (!line) {
    if (!clubPlayed || player.availability.suspendedMatches <= 0) return player;
    return { ...player, availability: { ...player.availability, suspendedMatches: player.availability.suspendedMatches - 1 } };
  }
  const s = player.season;
  const suspendedBefore = player.availability.suspendedMatches;
  return {
    ...player,
    condition: clamp(line.conditionAfter, 0, 100),
    availability: {
      injuryDays: Math.max(player.availability.injuryDays, line.injuredDays),
      // 정지 중인 선수는 출전하지 않으므로 여기서는 새 퇴장만 반영
      suspendedMatches: line.redCard ? 1 : suspendedBefore,
    },
    season: {
      apps: s.apps + 1,
      starts: s.starts + (line.started ? 1 : 0),
      minutes: s.minutes + line.minutes,
      goals: s.goals + line.goals,
      shots: s.shots + line.shots,
      keyPasses: s.keyPasses + line.keyPasses,
      tackles: s.tackles + line.tackles,
      redCards: s.redCards + (line.redCard ? 1 : 0),
    },
  };
}

/** 사기: 승 +1 / 패 −1 / 무 0 쪽으로 1단계 [PH] */
export function applyMoraleResult(player: Player, result: 'W' | 'D' | 'L'): Player {
  const m = player.morale;
  const next = result === 'W' ? Math.min(2, m + 1) : result === 'L' ? Math.max(-2, m - 1) : m > 0 ? m - 1 : m < 0 ? m + 1 : 0;
  return next === m ? player : { ...player, morale: next as Step };
}
