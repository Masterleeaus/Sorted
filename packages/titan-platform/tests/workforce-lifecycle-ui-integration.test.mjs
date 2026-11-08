import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const adapter = fs.readFileSync('apps/web/lib/titan/workforce-lifecycle/inspection.ts', 'utf8');
const panel = fs.readFileSync('apps/web/app/app/settings/WorkforceLifecyclePanel.tsx', 'utf8');
const tabs = fs.readFileSync('apps/web/app/app/settings/SettingsTabsClient.tsx', 'utf8');

test('Pass 9 integrates lifecycle into existing Settings tabs without UI replacement', () => {
  assert.match(tabs, /id: "workforce-lifecycle"/);
  assert.match(tabs, /<WorkforceLifecyclePanel agents=\{workforceLifecycle\} \/>/);
  assert.doesNotMatch(tabs, /marketplace.*install.*function/i);
});

test('Pass 9 UI adapter is read-only and does not own marketplace lifecycle', () => {
  assert.match(adapter, /replacesExistingUi: false/);
  assert.match(adapter, /ownsMarketplaceInstall: false/);
  assert.match(adapter, /ownsMarketplaceUninstall: false/);
  assert.match(adapter, /directMutationActions: false/);
  assert.match(adapter, /mutation_actions: Object\.freeze\(\[\]\)/);
  assert.match(adapter, /execution_permitted: false/);
  assert.match(adapter, /grants_authority: false/);
});

test('Pass 9 exposes request-only lifecycle controls', () => {
  for (const action of ['ENABLE','PAUSE','RESUME','DISABLE','PREPARE_UPGRADE','PREPARE_REPLACEMENT','PREPARE_RETIREMENT']) {
    assert.match(adapter, new RegExp(`'${action}'`));
  }
  assert.match(adapter, /request_only: true/);
  assert.match(adapter, /requires_fresh_authority_evaluation: true/);
});

test('Pass 9 panel explains governed request-only behavior', () => {
  assert.match(panel, /request-only/);
  assert.match(panel, /Settings does not install, uninstall, execute, or grant permissions directly/);
});
