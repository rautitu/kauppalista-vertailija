import { createApiApp } from './app';
import { writeStructuredLog } from '@kauppalista/domain';

const port = Number(process.env.PORT ?? 51111);

Bun.serve({
  fetch: createApiApp().fetch,
  port,
});

writeStructuredLog('info', 'api.server.started', {
  phase: 'api',
  port,
});
