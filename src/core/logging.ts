import { ConsoleLogger, type LoggerService } from '@nestjs/common';

export function buildLogger(nodeEnv: string): LoggerService {
  return nodeEnv === 'production'
    ? new ConsoleLogger({ json: true, colors: false })
    : new ConsoleLogger();
}
