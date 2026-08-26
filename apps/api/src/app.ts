import Fastify, { type FastifyInstance } from 'fastify';

import { readRoutes } from './routes/read.js';
import { writeRoutes } from './routes/write.js';

/**
 * Per-consumer auth and metering (§14).
 *
 * Keys come from `API_KEYS` as `key:consumer` pairs. This is deliberately the smallest
 * thing that supports per-consumer rate limits and usage metering; when there is a real
 * consumer list it moves into the database. If `API_KEYS` is unset, auth is off — which
 * is correct for local development and would be a serious mistake in production, so the
 * server says so at boot.
 */
interface Consumer {
  name: string;
  requests: number;
  windowStart: number;
}

const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 600);

function parseKeys(): Map<string, Consumer> {
  const raw = process.env.API_KEYS ?? '';
  const map = new Map<string, Consumer>();
  for (const pair of raw.split(',').filter(Boolean)) {
    const [key, name] = pair.split(':');
    if (key && name) map.set(key, { name, requests: 0, windowStart: Date.now() });
  }
  return map;
}

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  const consumers = parseKeys();

  if (consumers.size === 0) {
    app.log.warn('API_KEYS is unset — the read API is unauthenticated');
  }

  app.addHook('onRequest', async (request, reply) => {
    if (consumers.size === 0) return;
    if (request.url === '/health') return;

    const key = request.headers['x-api-key'];
    const consumer = typeof key === 'string' ? consumers.get(key) : undefined;
    if (!consumer) return reply.code(401).send({ error: 'unknown or missing API key' });

    const now = Date.now();
    if (now - consumer.windowStart > 60_000) {
      consumer.windowStart = now;
      consumer.requests = 0;
    }
    consumer.requests++;
    if (consumer.requests > RATE_LIMIT_PER_MINUTE) {
      return reply.code(429).send({ error: 'rate limit exceeded', consumer: consumer.name });
    }
    // Usage metering: one line per request, per consumer, for billing and for noticing
    // when a downstream integration starts behaving differently.
    request.log.info({ consumer: consumer.name, route: request.url }, 'api_request');
  });

  app.get('/health', async () => ({ status: 'ok' }));

  void app.register(readRoutes);
  void app.register(writeRoutes);

  return app;
}
