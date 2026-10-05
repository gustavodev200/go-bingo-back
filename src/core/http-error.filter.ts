import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import type { ErrorCode } from '../contracts';
import { DomainError } from './domain-error';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  INVALID_PAYLOAD: 400,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
  ROOM_FULL: 409,
  GAME_IN_PROGRESS: 409,
  NOT_HOST: 403,
  NOT_IN_ROOM: 403,
  NOT_ENOUGH_PLAYERS: 409,
  NICKNAME_REQUIRED: 409,
  NICKNAME_INVALID: 400,
  REGEN_LIMIT: 409,
  INVALID_STATE: 409,
  NOT_DRAWN: 409,
  BINGO_INVALID: 409,
  INTERNAL: 500,
};

export function toHttpError(error: unknown): {
  status: number;
  body: { code: ErrorCode; message: string };
} {
  if (error instanceof DomainError)
    return {
      status: STATUS[error.code],
      body: { code: error.code, message: error.message },
    };
  if (error instanceof ThrottlerException)
    return {
      status: 429,
      body: {
        code: 'RATE_LIMITED',
        message: 'Muitas requisições, tente em instantes',
      },
    };
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const code: ErrorCode =
      status === 401
        ? 'UNAUTHENTICATED'
        : status === 404
          ? 'NOT_FOUND'
          : 'INVALID_PAYLOAD';
    return { status, body: { code, message: error.message } };
  }
  return { status: 500, body: { code: 'INTERNAL', message: 'Erro interno' } };
}

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const { status, body } = toHttpError(exception);
    if (status === 500) this.logger.error(exception);
    host.switchToHttp().getResponse<Response>().status(status).json(body);
  }
}
