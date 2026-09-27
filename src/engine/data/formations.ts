/**
 * 포메이션 9종 (4.4-1, 실축구_전술설계 3.4). 슬롯 index 0 은 항상 GK.
 * lane 은 R10 측면 유닛(SIDE_A/SIDE_D)과 역할 형태값(wA/wD) 계산에 쓰인다. 소유: A.
 * 슬롯별 허용 역할: FB 슬롯은 4백(수비형·공격형·인버티드)과 3·5백(수비형 윙백·윙백)이 다르다.
 */
import type { FormationDef, FormationId, FormationSlot, Lane, Position, RoleId } from '../../types';

/** 포지션 기본 허용 역할 (FB 는 4백 기준). 3·5백 FB 슬롯은 WINGBACK_FB_ROLES */
export const ALLOWED_ROLES: Record<Position, RoleId[]> = {
  GK: ['GK_TRADITIONAL', 'GK_SWEEPER'],
  CB: ['CB_STOPPER', 'CB_BALL_PLAYING', 'CB_COVER'],
  FB: ['FB_DEFENSIVE', 'FB_OVERLAPPING', 'FB_INVERTED'],
  DM: ['DM_ANCHOR', 'DM_REGISTA', 'DM_BALL_WINNER', 'CM_BOX_TO_BOX', 'CM_DEEP_PLAYMAKER'],
  CM: ['CM_BOX_TO_BOX', 'CM_MEZZALA', 'CM_DEEP_PLAYMAKER', 'DM_BALL_WINNER', 'AM_PLAYMAKER', 'DM_ANCHOR'],
  AM: ['AM_PLAYMAKER', 'AM_TREQUARTISTA', 'AM_SHADOW_STRIKER', 'AM_ENGANCHE', 'W_INSIDE_FORWARD', 'ST_FALSE_NINE'],
  W: ['W_WINGER', 'W_INSIDE_FORWARD', 'W_INVERTED_WINGER', 'W_WIDE_MIDFIELDER'],
  ST: ['ST_POACHER', 'ST_TARGET', 'ST_FALSE_NINE', 'ST_PRESSING_FORWARD', 'ST_ADVANCED_FORWARD'],
};

/** 3백·5백 포메이션의 FB(윙백) 슬롯 허용 역할 */
export const WINGBACK_FB_ROLES: RoleId[] = ['FB_DEFENSIVE', 'WB_WINGBACK'];

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

function slots(spec: [Position, Lane, RoleId?][], backLine: 3 | 4 | 5 = 4): FormationSlot[] {
  return spec.map(([position, lane, role], index) => ({
    index,
    position,
    lane,
    allowedRoles: position === 'FB' && backLine !== 4 ? WINGBACK_FB_ROLES : ALLOWED_ROLES[position],
    defaultRole: role ?? (position === 'FB' && backLine === 3 ? 'WB_WINGBACK' : DEFAULT_ROLE[position]),
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
      ['W', 'L', 'W_WIDE_MIDFIELDER'],
      ['CM', 'C'],
      ['CM', 'C'],
      ['W', 'R', 'W_WIDE_MIDFIELDER'],
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
    slots: slots(
      [
        ['GK', 'C'],
        ['CB', 'C'],
        ['CB', 'C', 'CB_BALL_PLAYING'],
        ['CB', 'C'],
        ['FB', 'L'],
        ['DM', 'C'],
        ['CM', 'C'],
        ['CM', 'C', 'AM_PLAYMAKER'],
        ['FB', 'R'],
        ['ST', 'C', 'ST_TARGET'],
        ['ST', 'C'],
      ],
      3,
    ),
    centralMidfielders: 3,
    backLine: 3,
    isNarrow: true,
  },
  '5-3-2': {
    id: '5-3-2',
    label: '5-3-2',
    slots: slots(
      [
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
      ],
      5,
    ),
    centralMidfielders: 3,
    backLine: 5,
    isNarrow: false,
  },
  '4-1-4-1': {
    id: '4-1-4-1',
    label: '4-1-4-1',
    slots: slots([
      ['GK', 'C'],
      ['FB', 'L'],
      ['CB', 'C'],
      ['CB', 'C', 'CB_BALL_PLAYING'],
      ['FB', 'R'],
      ['DM', 'C'],
      ['W', 'L'],
      ['CM', 'C'],
      ['CM', 'C', 'AM_PLAYMAKER'],
      ['W', 'R', 'W_INSIDE_FORWARD'],
      ['ST', 'C'],
    ]),
    centralMidfielders: 3,
    backLine: 4,
    isNarrow: false,
  },
  '3-4-3': {
    id: '3-4-3',
    label: '3-4-3',
    slots: slots(
      [
        ['GK', 'C'],
        ['CB', 'C'],
        ['CB', 'C', 'CB_BALL_PLAYING'],
        ['CB', 'C'],
        ['FB', 'L'],
        ['CM', 'C'],
        ['CM', 'C', 'DM_ANCHOR'],
        ['FB', 'R'],
        ['AM', 'L', 'W_INSIDE_FORWARD'],
        ['ST', 'C'],
        ['AM', 'R', 'W_INSIDE_FORWARD'],
      ],
      3,
    ),
    centralMidfielders: 2,
    backLine: 3,
    isNarrow: false,
  },
  '5-4-1': {
    id: '5-4-1',
    label: '5-4-1',
    slots: slots(
      [
        ['GK', 'C'],
        ['FB', 'L'],
        ['CB', 'C'],
        ['CB', 'C', 'CB_BALL_PLAYING'],
        ['CB', 'C'],
        ['FB', 'R'],
        ['W', 'L', 'W_WIDE_MIDFIELDER'],
        ['CM', 'C'],
        ['CM', 'C', 'DM_BALL_WINNER'],
        ['W', 'R', 'W_WIDE_MIDFIELDER'],
        ['ST', 'C', 'ST_TARGET'],
      ],
      5,
    ),
    centralMidfielders: 2,
    backLine: 5,
    isNarrow: false,
  },
};

export const FORMATION_IDS = Object.keys(FORMATIONS) as FormationId[];

export function defaultRoles(formation: FormationId): RoleId[] {
  return FORMATIONS[formation].slots.map((s) => s.defaultRole);
}
