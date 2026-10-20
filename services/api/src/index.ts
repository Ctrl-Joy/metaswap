import { existsSync, readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { API_ROOT } from './config'

// services/api/.env (e.g. DATABASE_URL); never overrides variables that are already set
const envFile = resolve(API_ROOT, '.env')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line.replace(/^﻿/, ''))
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}

const { createApp, createServices, startServices, stopServices } = await import('./app')
const { RealtimeHub } = await import('./realtime/hub')

const services = createServices()
const app = createApp(services)
const { host, port } = services.ctx.config
const hub = new RealtimeHub(services)

const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`[api] MetaSwap API listening on http://${host}:${info.port} (ws /ws, db ${services.ctx.db.kind}, rpc ${services.ctx.config.rpcUrl})`)
})
hub.attach(server as unknown as Server)

// start indexing in the background so /health answers immediately
startServices(services).catch((e) => console.error('[api] startup error', e))

const shutdown = async () => {
  stopServices(services)
  hub.close()
  server.close()
  await services.ctx.db.close().catch(() => {})
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
