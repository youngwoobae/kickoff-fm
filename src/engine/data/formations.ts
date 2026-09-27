/**
 * MVP 포메이션 6종 (4.4-1). 슬롯 index 0 은 항상 GK.
 * lane 은 R10 측면 유닛(SIDE_A/SIDE_D) 계산에 쓰인다. 소유: A.
 */
import type { FormationDef, FormationId, FormationSlot, Lane, Position, RoleId } from '../../types';

export const ALLOWED_ROLES: Record<Position, RoleId[]> = {
  GK: ['GK_TRADITIONAL', 'GK_SWEEPER'],
  CB: ['CB_STOPPER', 'CB_BALL_PLAYING'],
  FB: ['FB_DEFENSIVE', 'FB_OVERLAPPING'],
  DM: ['DM_ANCHOR', 'CM_BOX_TO_BOX'],
  CM: ['CM_BOX_TO_BOX', 'AM_PLAYMAKER', 'DM_ANCHOR'],
  AM: ['AM_PLAYMAKER', 'W_INSIDE_FORWARD', 'ST_FALSE_NINE'],
  W: ['W_WINGER', 'W_INSIDE_FORWARD'],
  ST: ['ST_TARGET', 'ST_POACHER', 'ST_FALSE_NINE'],
};

export const DEFAULT_ROLE: Record<Position, RoleId> = {
  GK: 'GK_TRADITIONAL',
  CB: 'CB_STOPPER',
  FB: 'FB_DEFENSIVE',
  DM: 'DM_ANCHOR',
  CM: 'CM_BOX_TO_BOX',
  AM: 'AM_PLAYMAKER',
  W: 'W_WINGER',
  ST: 'ST_POACHER',
};

function slots(spec: [Position, Lane, RoleId?][]): FormationSlot[] {
  return spec.map(([position, lane, role], index) => ({
    index,
    position,
    lane,
    allowedRoles: ALLOWED_ROLES[position],
    defaultRole: role ?? DEFAULT_ROLE[position],
  }));
}

export const FORMATIONS: Record<FormationId, FormationDef> = {
  '4-4-2': {
    id: '4-4-2',
    label: '4-4-2',
    slots: slots([
      ['GK', 'C'],
      ['FB', 'L'],
      ['CB', 'C'],
      ['CB', 'C', 'CB_BALL_PLAYING'],
      ['FB', 'R'],
      ['W', 'L'],
      ['CM', 'C'],
      ['CM', 'C'],
      ['W', 'R'],
      ['ST', 'C', 'ST_TARGET'],
      ['ST', 'C'],
    ]),
    centralMidfielders: 2,
    backLine: 4,
    isNarrow: false,
  },
  '4-4-2D': {
    id: '4-4-2D',
    label: '4-4-2 다이아몬드',
    slots: slots([
      ['GK', 'C'],
      ['FB', 'L', 'FB_OVERLAPPING'],
      ['CB', 'C'],
      ['CB', 'C', 'CB_BALL_PLAYING'],
      ['FB', 'R', 'FB_OVERLAPPING'],
      ['DM', 'C'],
      ['CM', 'L'],
      ['CM', 'R'],
      ['AM', 'C'],
      ['ST', 'C', 'ST_TARGET'],
      ['ST', 'C'],
    ]),
    centralMidfielders: 4,
    backLine: 4,
    isNarrow: true,
  },
  '4-3-3': {
    id: '4-3-3',
    label: '4-3-3',
    slots: slots([
      ['GK', 'C'],
      ['FB', 'L'],
      ['CB', 'C'],
      ['CB', 'C', 'CB_BALL_PLAYING'],
      ['FB', 'R'],
      ['DM', 'C'],
      ['CM', 'C'],
      ['CM', 'C', 'AM_PLAYMAKER'],
      ['W', 'L'],
      ['ST', 'C'],
      ['W', 'R', 'W_INSIDE_FORWARD'],
    ]),
    centralMidfielders: 3,
    backLine: 4,
    isNarrow: false,
  },
  '4-2-3-1': {
    id: '4-2-3-1',
    label: '4-2-3-1',
    slots: slots([
      ['GK', 'C'],
      ['FB', 'L'],
      ['CB', 'C'],
      ['CB', 'C', 'CB_BALL_PLAYING'],
      ['FB', 'R'],
      ['DM', 'C'],
      ['DM', 'C', 'CM_BOX_TO_BOX'],
      ['W', 'L'],
      ['AM', 'C'],
      ['W', 'R', 'W_INSIDE_FORWARD'],
      ['ST', 'C'],
    ]),
    centralMidfielders: 3,
    backLine: 4,
    isNarrow: false,
  },
  '3-5-2': {
    id: '3-5-2',
    label: '3-5-2',
    slots: slots([
      ['GK', 'C'],
      ['CB', 'C'],
      ['CB', 'C', 'CB_BALL_PLAYING'],
      ['CB', 'C'],
      ['FB', 'L', 'FB_OVERLAPPING'],
      ['DM', 'C'],
      ['CM', 'C'],
      ['CM', 'C', 'AM_PLAYMAKER'],
      ['FB', 'R', 'FB_OVERLAPPING'],
      ['ST', 'C', 'ST_TARGET'],
      ['ST', 'C'],
    ]),
    centralMidfielders: 3,
    backLine: 3,
    isNarrow: true,
  },
  '5-3-2': {
    id: '5-3-2',
    label: '5-3-2',
    slots: slots([
      ['GK', 'C'],
      ['FB', 'L'],
      ['CB', 'C'],
      ['CB', 'C'],
      ['CB', 'C', 'CB_BALL_PLAYING'],
      ['FB', 'R'],
      ['CM', 'C'],
      ['DM', 'C'],
      ['CM', 'C'],
      ['ST', 'C', 'ST_TARGET'],
      ['ST', 'C'],
    ]),
    centralMidfielders: 3,
    backLine: 5,
    isNarrow: false,
  },
};

export const FORMATION_IDS = Object.keys(FORMATIONS) as FormationId[];

export function defaultRoles(formation: FormationId): RoleId[] {
  return FORMATIONS[formation].slots.map((s) => s.defaultRole);
}
