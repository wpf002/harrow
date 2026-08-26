import { buildApp } from './app.js';

const app = buildApp();
const port = Number(process.env.API_PORT ?? 3000);
const host = process.env.API_HOST ?? '0.0.0.0';

app.listen({ port, host }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
