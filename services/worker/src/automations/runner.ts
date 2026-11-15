import type { Client } from "pg";
import { logger } from "../logger.js";
import { runInCompanyContext } from "../company-context.js";
import { AUTOMATION_REGISTRY } from "./registry.js";
import type { AutomationDefinition } from "./registry.js";
import type { RunResult } from "./types.js";

/**
 * Runs one per-account automation. Each automation runs in its own transaction
 * with app.company_id set (issue #26), so its statements are scoped to that company.
 * findDue stays a cross-account sweep (ADR-024); only the per-automation work is scoped.
 */
export async function runAutomationType(
  def: AutomationDefinition,
  client: Client
): Promise<RunResult[]> {
  const automations = await def.findDue(client);
  const results: RunResult[] = [];

  for (const automation of automations) {
    try {
      const result = await runInCompanyContext(client, automation.company_id, async () => {
        const processed = await def.process(client, automation);
        await def.advanceNextRun(client, automation, processed);
        return processed;
      });
      results.push(result);
      logger.info(`${def.logLabel}: processed`, {
        automationId: automation.id,
        accountId: automation.account_id,
        sent: result.sent,
        skipped: result.skipped,
        errors: result.errors,
      });
    } catch (error) {
      logger.error(`${def.logLabel}: failed to process automation`, error, {
        automationId: automation.id,
      });
    }
  }

  return results;
}

export async function runAllDueAutomations(client: Client): Promise<void> {
  for (const def of AUTOMATION_REGISTRY) {
    const results = await runAutomationType(def, client);
    if (results.length > 0) {
      const totalSent = results.reduce((sum, r) => sum + r.sent, 0);
      const totalSkipped = results.reduce((sum, r) => sum + r.skipped, 0);
      const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
      logger.info(`${def.logLabel} complete`, {
        automations: results.length,
        sent: totalSent,
        skipped: totalSkipped,
        errors: totalErrors,
      });
    }
  }
}
