/**
 * HTTP transport against the Harrow API.
 *
 * Every method here must be safe to call twice: the app retries whenever the radio
 * comes back, and the server deduplicates on the reading's own content hash.
 */
import type { IngestResult, ReadingPayload } from '@harrow/shared';

import type { StoredSession } from './core/store.js';
import type { SyncTransport } from './core/sync.js';

export class HttpTransport implements SyncTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | null = null,
  ) {}

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
    };
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${res.status} ${path}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  async openSession(session: StoredSession): Promise<string> {
    const created = await this.post<{ id: string }>('/v1/sessions', {
      trackCode: session.trackCode,
      surfaceType: session.surfaceType,
      date: session.date,
      samplingPattern: session.samplingPattern,
      operatorRef: session.operatorRef,
      instrumentSerial: session.instrumentSerial,
      officialGoingLabel: session.officialGoingLabel,
      maintenanceLog: session.maintenanceLog,
      notes: [session.notes, session.weatherNotes].filter(Boolean).join('\n') || null,
    });
    return created.id;
  }

  async ingest(
    remoteSessionId: string,
    session: StoredSession,
    readings: ReadingPayload[],
  ): Promise<IngestResult> {
    return this.post<IngestResult>('/v1/ingest', {
      sessionId: remoteSessionId,
      instrumentSerial: session.instrumentSerial,
      operatorRef: session.operatorRef,
      readings,
    });
  }

  async closeSession(remoteSessionId: string): Promise<void> {
    await this.post(`/v1/sessions/${remoteSessionId}/close`, {});
  }
}
