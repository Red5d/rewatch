// Per-user Trakt connection + sync jobs.
import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { pollDeviceToken, saveTokens, startDeviceFlow, traktConfigured } from '../lib/trakt.js'
import { runTraktExport, runTraktImport, runTraktPull } from '../lib/trakt-sync.js'

// One pending device-code flow per user. Trakt is polled on demand from the
// status endpoint (the client already polls it, and refetches on focus): the
// moment the user comes back from trakt.tv, the next status request both
// checks Trakt and answers "connected" in the same round-trip.
type PendingFlow = {
  deviceCode: string
  userCode: string
  verificationUrl: string
  expiresAt: number
  intervalMs: number
  lastPollAt: number
}
const pendingFlows = new Map<number, PendingFlow>()

export default async function traktRoutes(app: FastifyInstance) {
  app.get('/api/trakt/status', { preHandler: app.requireAuth }, async (request) => {
    const userId = request.user!.id

    // Advance the pending device flow, respecting Trakt's poll interval.
    const flow = pendingFlows.get(userId)
    if (flow) {
      if (flow.expiresAt <= Date.now()) {
        pendingFlows.delete(userId)
      } else if (Date.now() - flow.lastPollAt >= flow.intervalMs) {
        flow.lastPollAt = Date.now()
        try {
          const result = await pollDeviceToken(flow.deviceCode)
          if (result.status === 'ok') {
            await saveTokens(userId, result.tokens)
            pendingFlows.delete(userId)
            app.log.info({ userId }, 'trakt connected')
          } else if (result.status !== 'pending') {
            pendingFlows.delete(userId)
          }
        } catch (err) {
          app.log.warn({ err }, 'trakt device poll error')
        }
      }
    }

    const account = await prisma.traktAccount.findUnique({ where: { userId } })
    const running = await prisma.importJob.findFirst({
      where: { userId, status: 'RUNNING', source: { in: ['TRAKT', 'TRAKT_EXPORT'] } },
      select: { id: true, source: true },
    })
    const stillPending = pendingFlows.get(userId)
    return {
      configured: traktConfigured(),
      connected: account !== null,
      username: account?.username ?? null,
      mirrorEnabled: account?.mirrorEnabled ?? false,
      runningJob: running,
      pendingCode:
        stillPending && stillPending.expiresAt > Date.now()
          ? { userCode: stillPending.userCode, verificationUrl: stillPending.verificationUrl }
          : null,
    }
  })

  // Starts the OAuth device flow: returns a short code the user types on
  // trakt.tv/activate. A background poll stores the tokens once approved;
  // the client just re-polls /status until connected.
  app.post('/api/trakt/connect', { preHandler: app.requireAuth }, async (request, reply) => {
    if (!traktConfigured()) return reply.code(400).send({ error: 'trakt_not_configured' })
    const userId = request.user!.id

    const existing = pendingFlows.get(userId)
    if (existing && existing.expiresAt > Date.now()) {
      return { userCode: existing.userCode, verificationUrl: existing.verificationUrl }
    }

    const code = await startDeviceFlow()
    pendingFlows.set(userId, {
      deviceCode: code.device_code,
      userCode: code.user_code,
      verificationUrl: code.verification_url,
      expiresAt: Date.now() + code.expires_in * 1000,
      intervalMs: code.interval * 1000,
      lastPollAt: 0,
    })

    return { userCode: code.user_code, verificationUrl: code.verification_url }
  })

  // Called on every app open/foreground. Cheap by design: one DB lookup when
  // Trakt isn't in play, one last_activities call otherwise. Per-user throttle.
  const lastPullRequest = new Map<number, number>()
  app.post('/api/trakt/pull', { preHandler: app.requireAuth }, async (request) => {
    const userId = request.user!.id
    const last = lastPullRequest.get(userId) ?? 0
    if (Date.now() - last < 60_000) return { skipped: 'throttled' }
    lastPullRequest.set(userId, Date.now())
    try {
      return await runTraktPull(userId)
    } catch (err) {
      request.log.warn({ err }, 'trakt pull failed')
      return { skipped: 'error' }
    }
  })

  app.post('/api/trakt/disconnect', { preHandler: app.requireAuth }, async (request) => {
    await prisma.traktAccount.deleteMany({ where: { userId: request.user!.id } })
    pendingFlows.delete(request.user!.id)
    return { ok: true }
  })

  app.post('/api/trakt/mirror', { preHandler: app.requireAuth }, async (request, reply) => {
    const enabled = (request.body as { enabled?: boolean } | null)?.enabled
    if (typeof enabled !== 'boolean') return reply.code(400).send({ error: 'invalid_input' })
    const updated = await prisma.traktAccount.updateMany({
      where: { userId: request.user!.id },
      data: { mirrorEnabled: enabled },
    })
    if (updated.count === 0) return reply.code(400).send({ error: 'trakt_not_connected' })
    return { ok: true }
  })

  const startJob = async (userId: number, source: 'TRAKT' | 'TRAKT_EXPORT') => {
    const account = await prisma.traktAccount.findUnique({ where: { userId } })
    if (!account) return { error: 'trakt_not_connected' as const }
    const running = await prisma.importJob.findFirst({ where: { userId, status: 'RUNNING' } })
    if (running) return { error: 'job_already_running' as const, jobId: running.id }
    const job = await prisma.importJob.create({ data: { userId, source } })
    void (source === 'TRAKT' ? runTraktImport(job.id, userId) : runTraktExport(job.id, userId))
    return { jobId: job.id }
  }

  app.post('/api/trakt/import', { preHandler: app.requireAuth }, async (request, reply) => {
    const result = await startJob(request.user!.id, 'TRAKT')
    if ('error' in result) return reply.code(result.error === 'trakt_not_connected' ? 400 : 409).send(result)
    return reply.code(202).send(result)
  })

  app.post('/api/trakt/export', { preHandler: app.requireAuth }, async (request, reply) => {
    const result = await startJob(request.user!.id, 'TRAKT_EXPORT')
    if ('error' in result) return reply.code(result.error === 'trakt_not_connected' ? 400 : 409).send(result)
    return reply.code(202).send(result)
  })
}
