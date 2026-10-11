/**
 * Multipart path of the typed client (D-051, CR-WS1-1): `evidence.upload` sends the body as the
 * JSON `metadata` part and the file as the `file` part, with the Idempotency-Key header; JSON
 * endpoints refuse a file and multipart endpoints require one.
 */
import { API, HEADERS } from '@growth-os/contracts';
import { fid } from '@growth-os/fixtures-aster';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { api, buildPath, MULTIPART_ENDPOINT_IDS } from './api-client';

const seen: { contentType: string | null; key: string | null; metadata: unknown; file: File | null }[] = [];
const server = setupServer(
  http.post(`http://localhost${buildPath(API.evidence.upload)}`, async ({ request }) => {
    const form = await request.formData();
    const file = form.get('file');
    seen.push({
      contentType: request.headers.get('content-type'),
      key: request.headers.get(HEADERS.idempotencyKey),
      metadata: JSON.parse(String(form.get('metadata'))),
      file: file instanceof File ? file : null,
    });
    return HttpResponse.json(
      { type: 'about:blank', title: 'stop here', status: 418, code: 'INTERNAL', correlationId: 't' },
      { status: 418 },
    );
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  seen.length = 0;
});
afterAll(() => server.close());

const metadata = {
  title: 'Plant survey notes',
  publisher: null,
  publishedOn: null,
  licenseId: fid('license', 1),
  caseRef: 'ME-104',
  fileName: 'survey.txt',
};

describe('api() multipart', () => {
  it('lists evidence.upload as multipart', () => {
    expect(MULTIPART_ENDPOINT_IDS.has(API.evidence.upload.id)).toBe(true);
  });

  it('sends a metadata JSON part and one file part with the Idempotency-Key', async () => {
    const file = new File(['Twelve plants asked for monitoring.'], 'survey.txt', { type: 'text/plain' });
    await expect(api(API.evidence.upload, { body: metadata, file, idempotencyKey: 'k-1' })).rejects.toThrow(
      'stop here',
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]!.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(seen[0]!.key).toBe('k-1');
    expect(seen[0]!.metadata).toEqual(metadata);
    expect(seen[0]!.file?.name).toBe('survey.txt');
    expect(await seen[0]!.file?.text()).toBe('Twelve plants asked for monitoring.');
  });

  it('names a bare Blob after the metadata fileName', async () => {
    const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    await expect(
      api(API.evidence.upload, {
        body: { ...metadata, fileName: 'deck.pdf' },
        file: blob,
        idempotencyKey: 'k-2',
      }),
    ).rejects.toThrow();
    expect(seen[0]!.file?.name).toBe('deck.pdf');
  });

  it('requires a file for a multipart endpoint and refuses one elsewhere', async () => {
    await expect(api(API.evidence.upload, { body: metadata, idempotencyKey: 'k-3' })).rejects.toThrow(
      /requires a file/,
    );
    await expect(
      api(API.auth.logout, { file: new Blob(['x']), idempotencyKey: 'k-4' } as never),
    ).rejects.toThrow(/does not accept a file/);
    expect(seen).toHaveLength(0);
  });
});
