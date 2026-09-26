/** 컨디션·부상·징계·사기의 일일/경기 후 처리 (4.2, 4.3). 소유: A. */
import type { Player, PlayerMatchLine } from '../../types';

/** 00:00: +14 + 체력 보정(0~6), 부상 일수 −1 */
export function applyDailyRecovery(_player: Player): Player {
  throw new Error('TODO');
}

/** 경기 결과 반영: 컨디션, 부상, 퇴장 → 1경기 정지, 시즌 스탯, 출장 정지 소화 */
export function applyMatchLine(_player: Player, _line: PlayerMatchLine | undefined, _clubPlayed: boolean): Player {
  throw new Error('TODO');
}
