import type { GameErrorCode } from '../types';

export class GameError extends Error {
  readonly code: GameErrorCode;
  readonly details: readonly string[];

  constructor(code: GameErrorCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = 'GameError';
    this.code = code;
    this.details = details;
  }
}

export function isGameError(e: unknown): e is GameError {
  return e instanceof GameError;
}
