/** 테스트용 합성 팀·경기 입력, 서비스 테스트 공용 시계·서비스 */
import { ENGINE_VERSION, mulberry32, simulateMatch } from '../src/engine';
import { PACKAGES, generateSquad, pickLineup, toEngineTeamInput, type PackageId } from '../src/domain';
import { createGameService, createMemorySlotStorage, type StoragePort } from '../src/services';
import type { Club, EngineConfig, EngineTeamInput, MatchResult, Player, TeamInstructions } from '../src/types';

export function makeTeam(
  seed: number,
  id: string,
  ovr: number,
  pkg: PackageId = 'BALANCED',
  instr?: Partial<TeamInstructions>,
  isHome = true,
): { input: EngineTeamInput; players: Record<string, Player>; club: Club } {
  const rng = mulberry32(seed);
  const ps = generateSquad(rng, { clubId: id, targetOvr: ovr, size: 22, tier: 'T3' });
  const players = Object.fromEntries(ps.map((p) => [p.id, p]));
  const P = PACKAGES[pkg];
  const slot = (key: 'A' | 'B') => ({ key, formation: P.formation, roles: [...P.roles], instructions: { ...P.instructions, ...instr }, familiarity: 100 });
  const club: Club = { id, name: id, shortName: id, isHuman: false, playerIds: ps.map((p) => p.id), tactics: { A: slot('A'), B: slot('B') } };
  const lineup = pickLineup({ club, players, opponentId: null, mode: 'SYSTEM_DEFAULT', rng }, club.tactics.A);
  const input = toEngineTeamInput(
    club,
    { plan: { clubId: id, matchId: null, lineup, startSlot: 'A', conditionals: [], autoSubThreshold: 55, autoRotation: true }, source: 'SYSTEM', adjustments: [] },
    players,
    isHome,
  );
  return { input, players, club };
}

export function config(extra: Partial<EngineConfig> = {}): EngineConfig {
  return { engineVersion: ENGINE_VERSION, tacCap: 0.35, tacticsEnabled: true, disabledRules: [], ...extra };
}

export function play(seed: number, home: EngineTeamInput, away: EngineTeamInput, extra: Partial<EngineConfig> = {}): MatchResult {
  return simulateMatch({ matchId: `t-${seed}`, seed, home: { ...home, isHome: true }, away: { ...away, isHome: false }, config: config(extra) });
}

export const clock = { nowIso: () => '2026-10-04T00:00:00.000Z' };

/** 메모리 슬롯 저장소 위의 실제 서비스 */
export const svc = (slots: StoragePort = createMemorySlotStorage()) => createGameService({ slots, clock });
