import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports ok so uptime checks and load balancers can probe the service', () => {
    expect(new HealthController().check()).toEqual({ status: 'ok' });
  });
});
