export type ServiceState = 'ok' | 'error';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  services: {
    api: ServiceState;
    database: ServiceState;
  };
}
