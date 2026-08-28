import { describe, expect, it } from 'vitest';
import { canonicalContentDigest, canonicalManifest } from '../apps/student/persistence.js';

describe('D-000R canonical source authority', () => {
  it('is deterministic and covers material interaction, coaching, assessment, and report definitions', async () => {
    const first = await canonicalManifest();
    const second = await canonicalManifest();
    expect(canonicalContentDigest(first)).toBe(canonicalContentDigest(second));
    const serialized = JSON.stringify(first);
    for (const material of ['ABC Trailer payment','COACH-08','WALKTHROUGH','Technical Bookkeeping','Month-End Financial Explanation','CLIENT_READY','Are You Really Ready for Clients?']) {
      expect(serialized).toContain(material);
    }
  });

  it('changes its digest for representative client, coaching, rubric, and reporting mutations', async () => {
    const source = await canonicalManifest() as Record<string, unknown>;
    const original = canonicalContentDigest(source);
    for (const needle of ['ABC Trailer payment','COACH-08','Technical Bookkeeping','CLIENT_READY']) {
      const mutated = JSON.parse(JSON.stringify(source).replace(needle, `${needle}-changed`));
      expect(canonicalContentDigest(mutated)).not.toBe(original);
    }
  });
});
