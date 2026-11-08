// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-local/storage/indexed-db.mjs
import { BUSINESS_DB_SCHEMA, assertKnownBusinessStore } from './schema.js';

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function transactionPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
  });
}

function ensureSchema(database, upgradeTransaction, schema) {
  for (const [storeName, definition] of Object.entries(schema.stores)) {
    let store;
    if (!database.objectStoreNames.contains(storeName)) {
      store = database.createObjectStore(storeName, { keyPath: definition.keyPath });
    } else {
      store = upgradeTransaction.objectStore(storeName);
    }
    for (const [indexName, index] of Object.entries(definition.indexes || {})) {
      if (!store.indexNames.contains(indexName)) {
        store.createIndex(indexName, index.keyPath, { unique: Boolean(index.unique), multiEntry: Boolean(index.multiEntry) });
      }
    }
  }
}

export function createIndexedDbAdapter({ indexedDB = globalThis.indexedDB, schema = BUSINESS_DB_SCHEMA } = {}) {
  if (!indexedDB || typeof indexedDB.open !== 'function') throw new Error('IndexedDB is unavailable in this runtime');
  let openPromise = null;
  let database = null;

  const open = async () => {
    if (database) return database;
    if (openPromise) return openPromise;
    openPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(schema.name, schema.version);
      request.onupgradeneeded = () => ensureSchema(request.result, request.transaction, schema);
      request.onsuccess = () => {
        database = request.result;
        database.onversionchange = () => {
          database.close();
          database = null;
          openPromise = null;
        };
        resolve(database);
      };
      request.onerror = () => {
        openPromise = null;
        reject(request.error || new Error('Unable to open Titan business IndexedDB'));
      };
      request.onblocked = () => {
        // Existing tabs may still hold an older schema open. Do not delete data; the caller can retry after they close.
      };
    });
    return openPromise;
  };

  const adapter = {
    schema,
    async open() { await open(); return adapter; },
    async close() {
      if (database) database.close();
      database = null;
      openPromise = null;
    },
    async health() {
      const db = await open();
      return {
        ok: true,
        name: db.name,
        version: db.version,
        stores: Array.from(db.objectStoreNames),
      };
    },
    async transaction(storeNames, mode = 'readonly', work) {
      if (typeof work !== 'function') throw new Error('IndexedDB transaction work function is required');
      const db = await open();
      const names = [...new Set((Array.isArray(storeNames) ? storeNames : [storeNames]).map(assertKnownBusinessStore))];
      if (!names.length) throw new Error('At least one IndexedDB store is required');
      const tx = db.transaction(names, mode === 'readwrite' ? 'readwrite' : 'readonly');
      const done = transactionPromise(tx);
      const api = Object.freeze({
        get: (store, key) => requestPromise(tx.objectStore(assertKnownBusinessStore(store)).get(key)),
        put: (store, value) => requestPromise(tx.objectStore(assertKnownBusinessStore(store)).put(value)),
        delete: (store, key) => requestPromise(tx.objectStore(assertKnownBusinessStore(store)).delete(key)),
        getAll: store => requestPromise(tx.objectStore(assertKnownBusinessStore(store)).getAll()),
        getAllByIndex: (store, indexName, key) => requestPromise(tx.objectStore(assertKnownBusinessStore(store)).index(indexName).getAll(key)),
      });
      let result;
      try {
        result = await work(api);
      } catch (error) {
        try { tx.abort(); } catch (_) {}
        try { await done; } catch (_) {}
        throw error;
      }
      await done;
      return result;
    },
  };
  return Object.freeze(adapter);
}
