import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const src = path.join(root, 'src', 'titan-builder');
const read = (name) => fs.readFileSync(path.join(src, name), 'utf8');

test('Builder exposes one canonical public package subpath', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.exports['./titan-builder'], './src/titan-builder/index.ts');
});

test('presentation ownership converges on Interface Runtime then Visual Runtime', () => {
  const pipeline = read('presentation-pipeline.ts');
  assert.match(pipeline, /createTitanInterfaceRuntime/);
  assert.match(pipeline, /planVisualRuntime/);
  assert.match(pipeline, /parallel_renderer:false/);
  assert.match(pipeline, /authority_granted:false/);
});

test('Builder action handoff cannot become local execution authority', () => {
  const handoff = read('command-handoff.ts');
  assert.match(handoff, /authority_granted:false/);
  assert.match(handoff, /requires_downstream_authorization:true/);
  assert.doesNotMatch(handoff, /child_process|execSync|spawnSync|eval\s*\(|new Function/);
});

test('lifecycle keeps rewind non-destructive and approval gated', () => {
  const lifecycle = read('lifecycle.ts');
  assert.match(lifecycle, /rewindBuilderRevision/);
  assert.match(lifecycle, /approval/);
  assert.doesNotMatch(lifecycle, /DELETE FROM|TRUNCATE|DROP TABLE/i);
});

test('security boundary retains company, surface and authority checks', () => {
  const gate = read('security-gate.ts');
  assert.match(gate, /company_id/);
  assert.match(gate, /surface/);
  assert.match(gate, /authority/);
});

test('Builder source contains no direct secret/provider or arbitrary code primitive', () => {
  const files = fs.readdirSync(src).filter((f) => f.endsWith('.ts'));
  const all = files.map((f) => read(f)).join('\n');
  assert.doesNotMatch(all, /process\.env\.(OPENAI|ANTHROPIC|GOOGLE|AWS)_/);
  assert.doesNotMatch(all, /child_process|execSync|spawnSync|new Function/);
});
