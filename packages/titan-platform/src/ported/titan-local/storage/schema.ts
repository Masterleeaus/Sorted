// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-local/storage/schema.mjs
export const BUSINESS_DB_SCHEMA = Object.freeze({
  name: 'titan-zero-business',
  version: 1,
  stores: Object.freeze({
    records: Object.freeze({
      keyPath: 'pk',
      indexes: Object.freeze({
        by_company: Object.freeze({ keyPath: 'company_id', unique: false }),
        by_company_module: Object.freeze({ keyPath: ['company_id', 'module_id'], unique: false }),
        by_company_collection: Object.freeze({ keyPath: ['company_id', 'module_id', 'collection'], unique: false }),
        by_company_updated: Object.freeze({ keyPath: ['company_id', 'updated_at'], unique: false }),
      }),
    }),
    attachments: Object.freeze({
      keyPath: 'pk',
      indexes: Object.freeze({
        by_company: Object.freeze({ keyPath: 'company_id', unique: false }),
        by_company_module: Object.freeze({ keyPath: ['company_id', 'module_id'], unique: false }),
        by_company_checksum: Object.freeze({ keyPath: ['company_id', 'checksum'], unique: false }),
        by_company_updated: Object.freeze({ keyPath: ['company_id', 'updated_at'], unique: false }),
      }),
    }),
    migrations: Object.freeze({
      keyPath: 'pk',
      indexes: Object.freeze({
        by_company: Object.freeze({ keyPath: 'company_id', unique: false }),
        by_company_version: Object.freeze({ keyPath: ['company_id', 'version'], unique: false }),
      }),
    }),
    idempotency: Object.freeze({
      keyPath: 'pk',
      indexes: Object.freeze({
        by_company: Object.freeze({ keyPath: 'company_id', unique: false }),
        by_company_created: Object.freeze({ keyPath: ['company_id', 'created_at'], unique: false }),
      }),
    }),
  }),
});

export const BUSINESS_DB_STORE_NAMES = Object.freeze(Object.keys(BUSINESS_DB_SCHEMA.stores));

export function assertKnownBusinessStore(name) {
  const store = String(name || '').trim();
  if (!Object.prototype.hasOwnProperty.call(BUSINESS_DB_SCHEMA.stores, store)) {
    throw new Error(`Unknown Titan business database store: ${store || '<empty>'}`);
  }
  return store;
}
