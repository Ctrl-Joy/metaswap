#!/usr/bin/env node
// Single-port gateway for the hosted demo (Hugging Face Space). Serves the built web app and
// forwards:
//   /api/*  → MetaSwap API      (HTTP + the /api/ws WebSocket)   default http://127.0.0.1:8787
//   /rpc    → MetaChain Devnet  (JSON-RPC, Anvil)                default http://127.0.0.1:8545
//   /*      → apps/web/dist     (SPA fallback to index.html)
// Anvil's admin RPC methods are blocked so visitors cannot reset or rewrite the shared chain.
// Only standard node modules.
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { connect } from 'node:net'
import { extname, join, normalize, resolve } from 'node:path'

const PORT = Number(process.env.PORT ?? 7860)
const API = new URL(process.env.API_UPSTREAM ?? 'http://127.0.0.1:8787')
const RPC = new URL(process.env.RPC_UPSTREAM ?? 'http://127.0.0.1:8545')
const WEB_DIR = resolve(process.env.WEB_DIR ?? 'apps/web/dist')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
}

// Admin namespaces are blocked except anvil_setBalance, which the devnet faucet uses.
const BLOCKED = /^(anvil_|evm_|hardhat_|debug_|admin_|personal_|miner_)/
const ALLOWED_ADMIN = new Set(['anvil_setBalance'])

function proxyApi(req, res, path) {
  const upstream = request({ hostname: API.hostname, port: API.port, method: req.method, path, headers: { ...req.headers, host: API.host } }, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers)
    up.pipe(res)
  })
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'starting up — try again in a few seconds' }))
  })
  req.pipe(upstream)
}

function proxyRpc(req, res) {
  let body = ''
  req.setEncoding('utf8')
  req.on('data', (c) => {
    body += c
    if (body.length > 1_000_000) req.destroy()
  })
  req.on('end', () => {
    let calls
    try {
      calls = JSON.parse(body)
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }))
    }
    const bad = (Array.isArray(calls) ? calls : [calls]).find((c) => typeof c?.method === 'string' && BLOCKED.test(c.method) && !ALLOWED_ADMIN.has(c.method))
    if (bad) {
      res.writeHead(403, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: bad.id ?? null, error: { code: -32601, message: `method ${bad.method} is disabled on this demo` } }))
    }
    const upstream = request(
      { hostname: RPC.hostname, port: RPC.port, method: 'POST', path: '/', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
      (up) => {
        res.writeHead(up.statusCode ?? 502, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
        up.pipe(res)
      },
    )
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'chain starting up' } }))
    })
    upstream.end(body)
  })
}

function serveStatic(req, res) {
  const url = new URL(req.url ?? '/', 'http://x')
  const safe = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '')
  let file = join(WEB_DIR, safe)
  if (!file.startsWith(WEB_DIR) || !existsSync(file) || statSync(file).isDirectory()) file = join(WEB_DIR, 'index.html')
  if (!existsSync(file)) {
    res.writeHead(503, { 'content-type': 'text/plain' })
    return res.end('MetaSwap is starting up — refresh in a minute.')
  }
  const immutable = file.startsWith(join(WEB_DIR, 'assets'))
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' })
  createReadStream(file).pipe(res)
}

const server = createServer((req, res) => {
  const url = req.url ?? '/'
  if (url === '/rpc' || url.startsWith('/rpc?')) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' })
      return res.end()
    }
    if (req.method !== 'POST') {
      res.writeHead(405)
      return res.end()
    }
    return proxyRpc(req, res)
  }
  if (url === '/api' || url.startsWith('/api/')) return proxyApi(req, res, url.slice(4) || '/')
  serveStatic(req, res)
})

// WebSocket upgrades for /api/ws are tunnelled to the API as raw TCP.
server.on('upgrade', (req, socket, head) => {
  if (!(req.url ?? '').startsWith('/api/')) return socket.destroy()
  const upstream = connect(Number(API.port), API.hostname, () => {
    const headers = Object.entries({ ...req.headers, host: API.host }).map(([k, v]) => `${k}: ${v}`).join('\r\n')
    upstream.write(`${req.method} ${(req.url ?? '/').slice(4)} HTTP/1.1\r\n${headers}\r\n\r\n`)
    if (head?.length) upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
})

server.listen(PORT, '0.0.0.0', () => console.log(`[gateway] http://0.0.0.0:${PORT}  web=${WEB_DIR}  api=${API.href}  rpc=${RPC.href}`))
