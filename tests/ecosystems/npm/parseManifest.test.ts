import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNpmManifest } from '../../../src/ecosystems/npm/parseManifest.js';

describe('parseNpmManifest', () => {
  it('parses dependencies and devDependencies with correct flags', async () => {
    const manifestPath = resolve('tests/fixtures/npm/basic/package.json');
    const deps = await parseNpmManifest({ ecosystem: 'npm', manifestPath });

    expect(deps).toEqual(
      expect.arrayContaining([
        { ecosystem: 'npm', name: 'left-pad', declaredRange: '^1.3.0', isDev: false, manifestPath },
        { ecosystem: 'npm', name: 'vitest', declaredRange: '^2.0.0', isDev: true, manifestPath },
      ])
    );
    expect(deps).toHaveLength(2);
  });
});
