import { expect, test } from 'vitest';
import { INDEX_VERSIONS } from './index.js';

test('no index version is published before Phase 6', () => {
  expect(INDEX_VERSIONS).toHaveLength(0);
});
