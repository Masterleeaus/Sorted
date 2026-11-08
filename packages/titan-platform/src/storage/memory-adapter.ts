import type { StorageAdapter, StorageRecord } from "./contracts.js";

export function createMemoryStorageAdapter(): StorageAdapter {
  let records = new Map<string, StorageRecord>();
  let idempotency = new Map<string, string>();
  let transactionTail: Promise<unknown> = Promise.resolve();

  const adapter: StorageAdapter = {
    async get(key: string) {
      return records.has(key) ? structuredClone(records.get(key)!) : null;
    },
    async put(record: StorageRecord) {
      records.set(record.pk, structuredClone(record));
    },
    async delete(key: string) {
      records.delete(key);
    },
    async listByCompany(company_id: string) {
      return [...records.values()]
        .filter((record) => record.company_id === company_id)
        .map((record) => structuredClone(record));
    },
    async getIdempotency(key: string) {
      return idempotency.get(key) ?? null;
    },
    async putIdempotency(key: string, recordPk: string) {
      idempotency.set(key, recordPk);
    },
    async transaction<T>(work: (tx: StorageAdapter) => Promise<T>): Promise<T> {
      const execute = async () => {
        const recordSnapshot = new Map(
          [...records.entries()].map(([key, value]) => [key, structuredClone(value)]),
        );
        const idempotencySnapshot = new Map(idempotency);
        try {
          return await work(adapter);
        } catch (error) {
          records = recordSnapshot;
          idempotency = idempotencySnapshot;
          throw error;
        }
      };
      const current = transactionTail.then(execute, execute);
      transactionTail = current.then(() => undefined, () => undefined);
      return current;
    },
  };

  return Object.freeze(adapter);
}
