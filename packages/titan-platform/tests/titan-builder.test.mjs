import test from 'node:test';
import assert from 'node:assert/strict';
import { TITAN_BUILDER_CONTRACT, getBuilderItem, listBuilderItems, resolveBuilderSurface, sanitizeBuilderProjection, validateBuilderIntent } from '../.test-dist/titan-builder/index.js';

test('Titan Builder catalog is materially integrated', () => {
  assert.ok(listBuilderItems('components').length >= 50);
  assert.ok(listBuilderItems('pages').length >= 20);
  assert.ok(getBuilderItem('pages', 'titan-hub-home'));
  assert.ok(getBuilderItem('pages', 'titan-go-today'));
});
test('legacy surfaces converge to zero/hub/go', () => {
  assert.equal(resolveBuilderSurface('owner'), 'zero');
  assert.equal(resolveBuilderSurface('onboarding'), 'zero');
  assert.equal(resolveBuilderSurface('customer'), 'hub');
  assert.equal(resolveBuilderSurface('field'), 'go');
});
test('builder remains presentation-only and company scoped', () => {
  assert.equal(TITAN_BUILDER_CONTRACT.company_boundary, 'company_id');
  assert.equal(validateBuilderIntent({company_id:'c1',surface:'zero',action:'navigate'}).accepted, true);
  assert.equal(validateBuilderIntent({company_id:'',surface:'zero'}).accepted, false);
  assert.equal(validateBuilderIntent({company_id:'c1',surface:'zero',action:'root.shell'}).accepted, false);
});
test('public projections strip secrets recursively', () => {
  assert.deepEqual(sanitizeBuilderProjection({name:'ok',api_key:'no',nested:{token:'no',value:2}}), {name:'ok',nested:{value:2}});
});
