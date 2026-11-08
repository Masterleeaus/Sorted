import test from 'node:test';
import assert from 'node:assert/strict';
import { createInterfaceReceipt } from '../.test-dist/ported/titan-runtime/interface-runtime/index.js';

test('InterfaceReceipt preserves canonical company scope without gaining authority', () => {
  const receipt=createInterfaceReceipt({company_id:'company-1',receipt_id:'receipt-1'});
  assert.equal(receipt.receipt_kind,'interface');
  assert.equal(receipt.company_id,'company-1');
  assert.equal(receipt.authority_neutral,true);
  assert.equal(receipt.execution_authority,false);
  assert.equal(receipt.authority_conferred_by_activation,false);
});
