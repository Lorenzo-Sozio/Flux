/**
 * Webhook Actions Service
 *
 * Supporta invio di HTTP requests con:
 * - Merge fields nella URL, headers, e body
 * - Retry logic con exponential backoff
 * - Timeout configurabile
 */

import { executeWithRetryTracked } from './retry-engine'
import { replaceMergeFields } from './email-service'

interface WebhookPayload {
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  headers?: Record<string, string>
  body?: Record<string, unknown>
  timeoutMs?: number
  retryCount?: number
}

interface WebhookResult {
  success: boolean
  statusCode?: number
  message: string
  responseBody?: unknown
  retryCount: number
}

/**
 * Invia un webhook HTTP request con merge fields e retry logic
 */
export async function sendWebhook(
  payload: WebhookPayload,
  context: {
    dealId?: string
    leadId?: string
    contactId?: string
    companyId?: string
    [key: string]: unknown
  }
): Promise<WebhookResult> {
  const { url, method, headers = {}, body, timeoutMs = 10000, retryCount = 3 } = payload

  // Sostituisci merge fields nella URL
  const resolvedUrl = replaceMergeFields(url, context)

  // Sostituisci merge fields negli headers
  const resolvedHeaders: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      resolvedHeaders[key] = replaceMergeFields(value, context)
    } else {
      resolvedHeaders[key] = String(value)
    }
  }

  // Sostituisci merge fields nel body
  let resolvedBody: string | undefined
  if (body) {
    const resolvedBodyObj = replaceInObject(body, context)
    resolvedBody = JSON.stringify(resolvedBodyObj)
  }

  // Costruisci le opzioni della request
  const fetchOptions: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...resolvedHeaders,
    },
    signal: AbortSignal.timeout(timeoutMs),
  }

  if (resolvedBody && ['POST', 'PUT', 'PATCH'].includes(method)) {
    fetchOptions.body = resolvedBody
  }

  // Esegui con retry logic
  const { result, attempts } = await executeWithRetryTracked(
    async () => {
      const response = await fetch(resolvedUrl, fetchOptions)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      let responseBody: unknown
      try {
        responseBody = await response.json()
      } catch {
        responseBody = await response.text()
      }

      return {
        success: true as const,
        statusCode: response.status,
        message: 'Webhook sent successfully',
        responseBody,
      }
    },
    {
      maxRetries: retryCount,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      strategy: 'exponential',
    }
  )

  return { ...result, retryCount: attempts }
}

/**
 * Ricorsivamente sostituisci merge fields in un oggetto
 */
function replaceInObject(obj: Record<string, unknown>, context: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = replaceMergeFields(value, context)
    } else if (value === null || value === undefined) {
      result[key] = value
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) => {
        if (typeof item === 'string') {
          return replaceMergeFields(item, context)
        }
        return item
      })
    } else if (typeof value === 'object') {
      result[key] = replaceInObject(value as Record<string, unknown>, context)
    } else {
      result[key] = value
    }
  }

  return result
}
