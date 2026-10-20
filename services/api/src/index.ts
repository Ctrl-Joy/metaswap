import { serve } from '@hono/node-server'
import { createApp, createServices, startServices, stopServices } from './app'

const services = createServices()
const app = createApp(services)
const { host, port } = services.ctx.config

const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`[api] MetaSwap API listening on http://${host}:${info.port} (rpc ${services.ctx.config.rpcUrl})`)
})

// start indexing in the background so /health answers immediately
startServices(services).catch((e) => console.error('[api] startup error', e))

const shutdown = () => {
  stopServices(services)
  server.close()
  services.ctx.db.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
