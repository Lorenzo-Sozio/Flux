/**
 * Scheduled Triggers Engine (Cron-based)
 *
 * Fase 2: Supporta triggering basato su cron expressions
 * Esempio: "0 8 * * 1" = lunedì ore 8:00
 *
 * Implementazione semplificata:
 * - Cron expressions definite in code o metadata
 * - Esegue runAutomations su tutti i record del targetEntity
 * - Supporta loop detection e retry logic
 */

import cron, { type ScheduledTask } from 'node-cron'
import { db } from '@/db'
import { automationRules, deals, leads, contacts, companies, tickets } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { runAutomations } from './rule-engine'
import { TargetEntity } from '../../crm/automation/types'
import { parseScheduledTrigger } from './scheduler-utils'
export { SCHEDULED_TRIGGER_PREFIX, parseScheduledTrigger, encodeScheduledTrigger } from './scheduler-utils'

interface RegisteredCronJob {
  ruleId: string
  targetEntity: TargetEntity
  cronExpression: string
  task: ScheduledTask
}

// ============================================================================
// SINGLETON SCHEDULER
// ============================================================================

class SchedulerService {
  private jobs: Map<string, RegisteredCronJob> = new Map()

  /**
   * Inizializza tutti gli scheduled triggers dal database
   */
  async initialize() {
    console.log('🔄 Initializing scheduled triggers...')

    const rules = await db.select().from(automationRules).where(eq(automationRules.isActive, true))

    for (const rule of rules) {
      // Cerca trigger di tipo scheduled
      const triggerOnArray = rule.triggerOn || []
      for (const trigger of triggerOnArray) {
        const cronExpr = parseScheduledTrigger(trigger)
        if (cronExpr) {
          try {
            this.registerCronJob({
              ruleId: rule.id,
              targetEntity: rule.targetEntity as TargetEntity,
              cronExpression: cronExpr,
            })
          } catch (err) {
            console.error(`❌ Failed to register scheduled trigger for rule ${rule.id}:`, err)
          }
        }
      }
    }

    console.log(`✅ Scheduled triggers initialized: ${this.jobs.size} cron jobs active`)
  }

  /**
   * Registra un nuovo cron job
   */
  private registerCronJob({
    ruleId,
    targetEntity,
    cronExpression,
  }: {
    ruleId: string
    targetEntity: TargetEntity
    cronExpression: string
  }) {
    // Controlla se esiste già
    if (this.jobs.has(ruleId)) {
      console.warn(`⚠️  Cron job ${ruleId} already registered, unregistering...`)
      this.unregister(ruleId)
    }

    // Crea il task
    const task = cron.schedule(cronExpression, async () => {
      await this.executeTrigger(ruleId, targetEntity)
    })

    this.jobs.set(ruleId, {
      ruleId,
      targetEntity,
      cronExpression,
      task,
    })

    console.log(`✅ Cron job registered: ${ruleId} (${cronExpression})`)
  }

  /**
   * Esegue un trigger scheduled
   */
  private async executeTrigger(ruleId: string, targetEntity: TargetEntity) {
    try {
      console.log(`⏰ Executing scheduled trigger: ${ruleId}`)

      // Recupera tutti i record della entity type
      const records = await this.getAllRecords(targetEntity)

      // Esegui automation per ogni record
      for (const record of records) {
        try {
          await runAutomations({
            entityType: targetEntity,
            entityId: record.id,
            event: 'onCreate', // ⚠️ Workaround: usiamo onCreate perché event è limitato a onCreate|onUpdate
            oldData: record,
            newData: record,
          })
        } catch (err) {
          console.error(`❌ Error executing trigger for record ${record.id}:`, err)
        }
      }
    } catch (err) {
      console.error(`❌ Error executing scheduled trigger ${ruleId}:`, err)
    }
  }

  /**
   * Recupera tutti i record di un tipo di entity
   */
  private async getAllRecords(
    entityType: TargetEntity
  ): Promise<Array<{ id: string; [key: string]: unknown }>> {
    const schemaMap = {
      deal:    deals,
      lead:    leads,
      contact: contacts,
      company: companies,
      ticket:  tickets,
    }

    const schema = schemaMap[entityType]

    // Query baseline: seleziona top 1000 record
    // In produzione: implementare paginazione
    const records = await db.select().from(schema).limit(1000)

    return records as Array<{ id: string; [key: string]: unknown }>
  }

  /**
   * Deregistra un cron job
   */
  unregister(ruleId: string) {
    const job = this.jobs.get(ruleId)
    if (job) {
      job.task.stop()
      this.jobs.delete(ruleId)
      console.log(`🛑 Cron job unregistered: ${ruleId}`)
    }
  }

  /**
   * Ferma tutti i cron jobs
   */
  shutdown() {
    console.log('🛑 Shutting down scheduler...')
    for (const [ruleId] of this.jobs) {
      this.unregister(ruleId)
    }
  }

  /**
   * Ritorna stato dei cron jobs attivi
   */
  getStatus() {
    return {
      activeJobs: this.jobs.size,
      jobs: Array.from(this.jobs.values()).map((j) => ({
        ruleId: j.ruleId,
        cronExpression: j.cronExpression,
        targetEntity: j.targetEntity,
      })),
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let scheduler: SchedulerService | null = null

export function getScheduler(): SchedulerService {
  if (!scheduler) {
    scheduler = new SchedulerService()
  }
  return scheduler
}

export async function initializeScheduler() {
  const svc = getScheduler()
  await svc.initialize()
}

export function shutdownScheduler() {
  const svc = getScheduler()
  svc.shutdown()
  scheduler = null
}

export function getSchedulerStatus() {
  const svc = getScheduler()
  return svc.getStatus()
}

// ============================================================================
// UTILITIES - CRON EXPRESSION BUILDER
// ============================================================================

/**
 * Helper per costruire cron expressions
 * @example
 *   cronBuilder().everyDayAt(8, 0) // "0 8 * * *"
 *   cronBuilder().everyMondayAt(8, 0) // "0 8 * * 1"
 */
export function cronBuilder() {
  return {
    /**
     * Ogni giorno a un'ora specifica
     * @param hour 0-23
     * @param minute 0-59
     */
    everyDayAt(hour: number, minute: number): string {
      return `${minute} ${hour} * * *`
    },

    /**
     * Un giorno della settimana a un'ora specifica
     * @param dayOfWeek 0=domenica, 1=lunedì, ..., 6=sabato
     * @param hour 0-23
     * @param minute 0-59
     */
    everyDayOfWeekAt(dayOfWeek: number, hour: number, minute: number): string {
      return `${minute} ${hour} * * ${dayOfWeek}`
    },

    /**
     * Ogni N ore
     */
    everyNHours(n: number): string {
      return `0 */${n} * * *`
    },

    /**
     * Ogni N minuti (non usare in prod, testing only)
     */
    everyNMinutes(n: number): string {
      return `*/${n} * * * *`
    },

    /**
     * Raw cron expression
     */
    custom(expr: string): string {
      return expr
    },
  }
}
