/** 탭 내비게이션 상태 (소유: B). 탭마다 하위 화면을 기억한다(10.2 탭 상태 유지). */
import { createContext, useContext } from 'react';

export type TabId = 'home' | 'squad' | 'tactics' | 'match' | 'club';
export type SquadSub = 'list' | 'lineup';
export type TacticsSub = 'team' | 'plan';
export type ClubSub = 'league' | 'finance' | 'coach' | 'dev';

export interface NavState {
  tab: TabId;
  squad: SquadSub;
  tactics: TacticsSub;
  club: ClubSub;
  /** 경기 센터에서 볼 경기 (없으면 최근 경기) */
  matchId: string | null;
  matchView: 'replay' | 'report';
}

export const INITIAL_NAV: NavState = { tab: 'home', squad: 'list', tactics: 'team', club: 'league', matchId: null, matchView: 'report' };

export interface NavApi {
  nav: NavState;
  go(patch: Partial<NavState>): void;
}

export const NavCtx = createContext<NavApi>({ nav: INITIAL_NAV, go: () => undefined });

export function useNav(): NavApi {
  return useContext(NavCtx);
}
