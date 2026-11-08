import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyRisk } from '../.test-dist/intelligence.js';
import { routeOperationalRole } from '../.test-dist/workforce.js';
import { createCompanyExecutionContext } from '../.test-dist/runtime.js';
import { getTitanPlatformDescriptor } from '../.test-dist/descriptor.js';
import {
  getTitanBusinessOpsAgentCommand,
  materializeTitanBusinessOpsPath,
  assessTitanBusinessOpsAgentCommand,
} from '../.test-dist/business-ops.js';

test('company context is standalone-safe and canonical', () => {
  const context = createCompanyExecutionContext({ company_id: 'company-1', actor_id: 'user-1' });
  assert.equal(context.company_id, 'company-1');
  assert.equal(context.actor_id, 'user-1');
});

test('risk classifier preserves Titan deterministic guardrails', () => {
  const risk = classifyRisk({ company_id: 'company-1', evidence: { destructive_change: true } });
  assert.equal(risk.level, 'high');
  assert.equal(risk.deterministic, true);
});

test('workforce role router selects a matching operational role', () => {
  const result = routeOperationalRole('prepare customer quote', 'quotes', [{
    role_definition_id: 'sales-1',
    name: 'Quote Specialist',
    company_boundary: 'company_id',
    activation_confers_authority: false,
    operational_domains: ['quoting', 'sales'],
  }]);
  assert.equal(result.role?.role_definition_id, 'sales-1');
  assert.ok(result.score > 0);
});

test('platform descriptor marks extensions as optional capability layer', () => {
  const descriptor = getTitanPlatformDescriptor();
  assert.equal(descriptor.browserExtensionRequired, false);
  assert.equal(descriptor.browserExtensionsOptionalCapabilityLayer, true);
  assert.equal(descriptor.nativeBusinessOpsCommandGateway, true);
});

test('native agent commands materialize only allow-listed Business Ops paths', () => {
  const command = getTitanBusinessOpsAgentCommand('projects.get');
  assert.equal(command?.path, '/api/v1/jobs/:id');
  assert.equal(materializeTitanBusinessOpsPath(command.path, 'job_123'), '/api/v1/jobs/job_123');
  assert.throws(() => materializeTitanBusinessOpsPath(command.path, '../admin'));
});

test('native mutating commands receive deterministic Titan risk assessment', () => {
  const risk = assessTitanBusinessOpsAgentCommand({ companyId: 'company-1', commandId: 'invoices.send', entityId: 'invoice_1' });
  assert.equal(risk.company_id, 'company-1');
  assert.equal(risk.deterministic, true);
});
