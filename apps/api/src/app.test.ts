import { expect, test } from 'vitest';
import { buildApp } from './app.js';

test('health endpoint responds', async () => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url: '/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: 'ok' });
  await app.close();
});
