/**
 * Write surfaces: session lifecycle, ingest, recompute.
 *
 * These are operator and pipeline endpoints, not consumer ones. Nothing here is part of
 * the read API's contract.
 */
import type { FastifyInstance } from 'fastify';
import { ingestBatchSchema, openSessionSchema } from '@harrow/shared';

import { db } from '../db.js';
import { ingestBatch, IngestError } from '../services/ingest.js';
import { recompute } from '../services/recompute.js';
import {
  closeSession,
  finalizeSession,
  openSession,
  rejectSession,
  SessionError,
  validateSession,
} from '../services/sessions.js';

export async function writeRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/sessions', async (request, reply) => {
    const parsed = openSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body', detail: parsed.error.issues });
    }
    try {
      return await openSession(db(), parsed.data);
    } catch (err) {
      if (err instanceof SessionError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.get<{ Params: { id: string } }>('/v1/sessions/:id', async (request, reply) => {
    const session = await db().session.findUnique({
      where: { id: request.params.id },
      include: {
        track: { select: { code: true, name: true } },
        indexValues: true,
        _count: { select: { readings: true } },
      },
    });
    if (!session) return reply.code(404).send({ error: 'not found' });
    return session;
  });

  app.post<{ Params: { id: string } }>('/v1/sessions/:id/close', async (request, reply) => {
    try {
      return await closeSession(db(), request.params.id);
    } catch (err) {
      if (err instanceof SessionError) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>('/v1/sessions/:id/validate', async (request, reply) => {
    try {
      const report = await validateSession(db(), request.params.id);
      return reply.code(report.passed ? 200 : 422).send(report);
    } catch (err) {
      if (err instanceof SessionError) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>('/v1/sessions/:id/finalize', async (request, reply) => {
    try {
      const { indexValue, result } = await finalizeSession(db(), request.params.id);
      return { indexValue, detail: result };
    } catch (err) {
      if (err instanceof SessionError) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/v1/sessions/:id/reject',
    async (request, reply) => {
      try {
        return await rejectSession(db(), request.params.id, request.body?.reason ?? 'unspecified');
      } catch (err) {
        if (err instanceof SessionError) return reply.code(409).send({ error: err.message });
        throw err;
      }
    },
  );

  app.post('/v1/ingest', async (request, reply) => {
    const parsed = ingestBatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body', detail: parsed.error.issues });
    }
    try {
      return await ingestBatch(db(), parsed.data);
    } catch (err) {
      if (err instanceof IngestError) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });

  app.post<{ Body: { derivationVersion?: string; trackCode?: string; promote?: boolean } }>(
    '/v1/recompute',
    async (request, reply) => {
      const version = request.body?.derivationVersion;
      if (!version) return reply.code(400).send({ error: 'derivationVersion is required' });
      try {
        return await recompute(db(), {
          derivationVersion: version,
          ...(request.body.trackCode ? { trackCode: request.body.trackCode } : {}),
          ...(request.body.promote != null ? { promote: request.body.promote } : {}),
        });
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );
}
