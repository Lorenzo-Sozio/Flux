/**
 * Scheduled Triggers Engine (Cron-based)
 *
 * Rules that fire on a clock rather than on an event: "0 8 * * 1" is Monday at
 * eight. The cron expression is read from the rule, and every record of the
 * rule's target entity is put through runAutomations, loop detection and retry
 * included.
 *
 * ⚠️ There is no long-lived process on Workers, so `src/instrumentation.ts`
 * does not start this there and scheduled rules do not run on that deploy.
 */

import { eq } from "drizzle-orm";
import cron, { type ScheduledTask } from "node-cron";

import { automationRules, companies, contacts, deals, leads, orders, tickets } from "@/db/schema";
import { getDb } from "@/lib/tenant-context";

import type { TargetEntity } from "../../crm/automation/types";
import { runAutomations } from "./rule-engine";
import { parseScheduledTrigger } from "./scheduler-utils";

export { encodeScheduledTrigger, parseScheduledTrigger, SCHEDULED_TRIGGER_PREFIX } from "./scheduler-utils";

interface RegisteredCronJob {
  ruleId: string;
  targetEntity: TargetEntity;
  cronExpression: string;
  task: ScheduledTask;
}

// ============================================================================
// SINGLETON SCHEDULER
// ============================================================================

class SchedulerService {
  private jobs: Map<string, RegisteredCronJob> = new Map();

  /**
   * Registers every scheduled trigger held in the database.
   */
  async initialize() {
    console.log("🔄 Initializing scheduled triggers...");

    try {
      const db = await getDb();
      const rules = await db.select().from(automationRules).where(eq(automationRules.isActive, true));

      for (const rule of rules) {
        // Only the rules that fire on a clock
        const triggerOnArray = rule.triggerOn || [];
        for (const trigger of triggerOnArray) {
          const cronExpr = parseScheduledTrigger(trigger);
          if (cronExpr) {
            try {
              this.registerCronJob({
                ruleId: rule.id,
                targetEntity: rule.targetEntity as TargetEntity,
                cronExpression: cronExpr,
              });
            } catch (err) {
              console.error(`❌ Failed to register scheduled trigger for rule ${rule.id}:`, err);
            }
          }
        }
      }

      console.log(`✅ Scheduled triggers initialized: ${this.jobs.size} cron jobs active`);
    } catch (err) {
      console.error(
        "⚠️  Error initializing scheduled triggers (using platformDb):",
        err instanceof Error ? err.message : String(err),
      );
      console.log("ℹ️  Scheduled triggers will initialize when the first request arrives.");
    }
  }

  /**
   * Registers one cron job.
   */
  private registerCronJob({
    ruleId,
    targetEntity,
    cronExpression,
  }: {
    ruleId: string;
    targetEntity: TargetEntity;
    cronExpression: string;
  }) {
    // Already registered: replace it rather than run it twice
    if (this.jobs.has(ruleId)) {
      console.warn(`⚠️  Cron job ${ruleId} already registered, unregistering...`);
      this.unregister(ruleId);
    }

    // The task itself
    const task = cron.schedule(cronExpression, async () => {
      await this.executeTrigger(ruleId, targetEntity);
    });

    this.jobs.set(ruleId, {
      ruleId,
      targetEntity,
      cronExpression,
      task,
    });

    console.log(`✅ Cron job registered: ${ruleId} (${cronExpression})`);
  }

  /**
   * Runs one scheduled trigger.
   */
  private async executeTrigger(ruleId: string, targetEntity: TargetEntity) {
    try {
      console.log(`⏰ Executing scheduled trigger: ${ruleId}`);

      // Every record of the entity the rule targets
      const records = await this.getAllRecords(targetEntity);

      // One run per record
      for (const record of records) {
        try {
          await runAutomations({
            entityType: targetEntity,
            entityId: record.id,
            // ⚠️ A scheduled run is neither a create nor an update, and the event
            // vocabulary has no third word for it, so it borrows onCreate.
            event: "onCreate",
            oldData: record,
            newData: record,
          });
        } catch (err) {
          console.error(`❌ Error executing trigger for record ${record.id}:`, err);
        }
      }
    } catch (err) {
      console.error(`❌ Error executing scheduled trigger ${ruleId}:`, err);
    }
  }

  /**
   * Every record of one entity type, capped so a large workspace cannot stall the job.
   */
  private async getAllRecords(entityType: TargetEntity): Promise<Array<{ id: string; [key: string]: unknown }>> {
    const schemaMap = {
      deal: deals,
      lead: leads,
      contact: contacts,
      company: companies,
      ticket: tickets,
      order: orders,
    };

    const schema = schemaMap[entityType];

    const db = await getDb();
    const records = await db.select().from(schema).limit(1000);

    return records as Array<{ id: string; [key: string]: unknown }>;
  }

  /**
   * Stops and forgets one cron job.
   */
  unregister(ruleId: string) {
    const job = this.jobs.get(ruleId);
    if (job) {
      job.task.stop();
      this.jobs.delete(ruleId);
      console.log(`🛑 Cron job unregistered: ${ruleId}`);
    }
  }

  /**
   * Stops every cron job.
   */
  shutdown() {
    console.log("🛑 Shutting down scheduler...");
    for (const [ruleId] of this.jobs) {
      this.unregister(ruleId);
    }
  }

  /**
   * What is currently scheduled.
   */
  getStatus() {
    return {
      activeJobs: this.jobs.size,
      jobs: Array.from(this.jobs.values()).map((j) => ({
        ruleId: j.ruleId,
        cronExpression: j.cronExpression,
        targetEntity: j.targetEntity,
      })),
    };
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let scheduler: SchedulerService | null = null;

export function getScheduler(): SchedulerService {
  if (!scheduler) {
    scheduler = new SchedulerService();
  }
  return scheduler;
}

export async function initializeScheduler() {
  const svc = getScheduler();
  await svc.initialize();
}

export function shutdownScheduler() {
  const svc = getScheduler();
  svc.shutdown();
  scheduler = null;
}

export function getSchedulerStatus() {
  const svc = getScheduler();
  return svc.getStatus();
}

// ============================================================================
// UTILITIES - CRON EXPRESSION BUILDER
// ============================================================================

/**
 * Builds cron expressions, so the common ones are not written by hand.
 * @example
 *   cronBuilder().everyDayAt(8, 0) // "0 8 * * *"
 *   cronBuilder().everyMondayAt(8, 0) // "0 8 * * 1"
 */
export function cronBuilder() {
  return {
    /**
     * Every day at a given time.
     * @param hour 0-23
     * @param minute 0-59
     */
    everyDayAt(hour: number, minute: number): string {
      return `${minute} ${hour} * * *`;
    },

    /**
     * One weekday at a given time.
     * @param dayOfWeek 0=Sunday, 1=Monday, …, 6=Saturday
     * @param hour 0-23
     * @param minute 0-59
     */
    everyDayOfWeekAt(dayOfWeek: number, hour: number, minute: number): string {
      return `${minute} ${hour} * * ${dayOfWeek}`;
    },

    /**
     * Every N hours.
     */
    everyNHours(n: number): string {
      return `0 */${n} * * *`;
    },

    /**
     * Every N minutes. Testing only — never a production schedule.
     */
    everyNMinutes(n: number): string {
      return `*/${n} * * * *`;
    },

    /**
     * Raw cron expression
     */
    custom(expr: string): string {
      return expr;
    },
  };
}
