/** 탭 내비게이션 상태 (소유: B). 탭마다 하위 화면을 기억한다(10.2 탭 상태 유지). */
import { createContext, useContext } from 'react';

export type TabId = 'home' | 'squad' | 'tactics' | 'match' | 'club';
export type SquadSub = 'list' | 'lineup' | 'youth';
export type TacticsSub = 'team' | 'plan';
export type ClubSub = 'league' | 'career' | 'finance' | 'transfer' | 'coach' | 'dev';
export type HomeView = 'today' | 'inbox';

export interface NavState {
  tab: TabId;
  squad: SquadSub;
  tactics: TacticsSub;
  club: ClubSub;
  /** 경기 센터에서 볼 경기 (없으면 최근 경기) */
  matchId: string | null;
  matchView: 'replay' | 'report';
  /** 홈 탭: 오늘 / 받은 편지함 */
  homeView: HomeView;
}

export const INITIAL_NAV: NavState = { tab: 'home', squad: 'list', tactics: 'team', club: 'league', matchId: null, matchView: 'report', homeView: 'today' };

export interface NavApi {
  nav: NavState;
  go(patch: Partial<NavState>): void;
}

export const NavCtx = createContext<NavApi>({ nav: INITIAL_NAV, go: () => undefined });

export function useNav(): NavApi {
  return useContext(NavCtx);
}
