import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
for (const [subpath, target] of Object.entries(manifest.exports)) {
  test(`package consumer resolves public export ${subpath}`, () => {
    const specifier = manifest.name + (subpath === '.' ? '' : subpath.slice(1));
    const resolved = import.meta.resolve(specifier);
    assert.equal(resolved, new URL(`../${target}`, import.meta.url).href);
    assert.ok(existsSync(new URL(resolved)), `${specifier} must resolve to existing source`);
  });
}
test('package consumer cannot bypass declared exports', () => {
  assert.throws(() => import.meta.resolve(`${manifest.name}/src/security-boundary.ts`),
    { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
});
