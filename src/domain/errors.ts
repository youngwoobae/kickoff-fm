/** 도메인 규칙 위반. services 가 같은 code 의 GameError 로 바꿔 던진다. 소유: A. */
import type { GameErrorCode } from '../types';

export class DomainError extends Error {
  readonly code: GameErrorCode;
  readonly details: readonly string[];
  constructor(code: GameErrorCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
