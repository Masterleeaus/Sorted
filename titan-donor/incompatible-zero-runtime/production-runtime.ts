import { resolve } from "node:path";
import { createSqliteStorage } from "../../../../packages/storage/src/index";
// The canonical service exposes its runtime composition as ESM.
// @ts-expect-error JavaScript runtime owner has no declaration file yet.
import { createFieldServiceRuntime } from "../../../../services/workforce/src/field-service-runtime.mjs";
import { completeAssignedWorkOrder } from "../work-orders/lead-access";
import { getEnv } from "../env";

let production: Promise<any> | undefined;

export function getProductionZeroRuntime(): Promise<any> {
  if (!production) production = (async () => {
    const url = getEnv().DATABASE_URL;
    if (!/^(file:|sqlite:)/.test(url)) throw new Error("zero-sqlite-storage-required");
    const filename = process.env.SQLITE_PATH ?? resolve(process.cwd(), url.replace(/^(file:|sqlite:)/, "").replace(/^\/\//, ""));
    const storage = createSqliteStorage(filename);
    try {
      return await createFieldServiceRuntime({ storage, workOrders: {
        complete: ({ company_id, actor_id, work_order_id }: { company_id: string; actor_id: string; work_order_id: string }) =>
          storage.transaction(client => completeAssignedWorkOrder(client, work_order_id, company_id, actor_id)),
        // Compatibility for this legacy same-store composition. Hosted runtime
        // providers use separate company databases and never receive control tx.
        completeInControlTransaction: ({ company_id, actor_id, work_order_id, authorityFence }: { company_id: string; actor_id: string; work_order_id: string; authorityFence?: { assertCurrent(): void } }, client: import("../../../../packages/storage/src/index").StorageClient) =>
          completeAssignedWorkOrder(client, work_order_id, company_id, actor_id, authorityFence),
        async read({ company_id, actor_id, work_order_id }: { company_id: string; actor_id: string; work_order_id: string }) {
          return (await storage.query("SELECT id,title,status,completed_at FROM work_orders WHERE company_id=$1 AND id=$2 AND assigned_user_id=$3", [company_id, work_order_id, actor_id])).rows[0] ?? null;
        },
      } });
    } catch (error) { await storage.close(); throw error; }
  })().catch(error => { production = undefined; throw error; });
  return production;
}
