#!/usr/bin/env node
// MetaSwap local stack launcher (cross-platform; built for Windows + Git Bash/PowerShell).
//
//   node scripts/dev.mjs              anvil → DeployAMM → DeployX → Seed → sdk sync → api → web
//   node scripts/dev.mjs --chain-only anvil + deploy + seed + sync, then keep anvil running
//   node scripts/dev.mjs --no-web     everything except the web dev server
//   node scripts/dev.mjs --no-market  no live market simulator (scripts/market.ts --live)
//
// Ctrl+C stops every process this script started.
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const contractsDir = join(root, 'packages/contracts')
const args = new Set(process.argv.slice(2))
const RPC = 'http://127.0.0.1:8545'
// Anvil account #0 — public, well-known dev key. Local devnet only.
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

const foundryBin = process.env.FOUNDRY_BIN ?? 'C:\\Users\\bikal\\Tools\\foundry\\bin'
const env = { ...process.env, PATH: `${process.env.PATH}${delimiter}${foundryBin}` }
const children = []

function log(msg) {
  console.log(`\x1b[35m[dev]\x1b[0m ${msg}`)
}

// Runs a step asynchronously. A synchronous spawn would block the event loop, so long-running
// children (anvil) could not have their stdout drained; anvil then blocks on a full pipe and
// stops answering RPC mid-deploy.
function run(cmd, cmdArgs, cwd) {
  log(`${cmd} ${cmdArgs.join(' ')}`)
  return new Promise((resolveRun) => {
    const child = spawn(cmd, cmdArgs, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' })
    child.on('exit', (code) => {
      if (code !== 0) {
        log(`failed: ${cmd} (exit ${code})`)
        shutdown(1)
      }
      resolveRun()
    })
  })
}

function start(name, cmd, cmdArgs, cwd, { logFile } = {}) {
  log(`starting ${name}${logFile ? ` (log: ${logFile})` : ''}`)
  if (logFile) {
    mkdirSync(dirname(logFile), { recursive: true })
    const out = openSync(logFile, 'w')
    const child = spawn(cmd, cmdArgs, { cwd, env, stdio: ['ignore', out, out], shell: process.platform === 'win32' })
    child.on('exit', (code) => log(`${name} exited (${code})`))
    children.push(child)
    return child
  }
  const child = spawn(cmd, cmdArgs, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' })
  const prefix = `\x1b[36m[${name}]\x1b[0m `
  child.stdout.on('data', (d) => process.stdout.write(prefix + d.toString().replace(/\n(?=.)/g, `\n${prefix}`)))
  child.stderr.on('data', (d) => process.stderr.write(prefix + d.toString().replace(/\n(?=.)/g, `\n${prefix}`)))
  child.on('exit', (code) => log(`${name} exited (${code})`))
  children.push(child)
  return child
}

async function rpcReady(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      })
      if (res.ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

// ---------- PostgreSQL + TimescaleDB (portable, no service) ----------
// The API uses DATABASE_URL from services/api/.env. When portable PostgreSQL binaries are present
// (PG_BIN, default C:\Users\bikal\Tools\pgsql\bin) the launcher creates the cluster in .dev/pgdata
// on first run, starts it, and stops it on exit. The cluster persists across launches; the API
// resets its own schema when it sees a new chain.
const pgBin = process.env.PG_BIN ?? 'C:\\Users\\bikal\\Tools\\pgsql\\bin'
const pgData = join(root, '.dev', 'pgdata')
const apiEnvFile = join(root, 'services/api/.env')
let pgStarted = false

function pgExe(name) {
  return join(pgBin, process.platform === 'win32' ? `${name}.exe` : name)
}

async function ensurePostgres() {
  if (!existsSync(pgExe('pg_ctl'))) {
    log(`PostgreSQL not found at ${pgBin} (set PG_BIN); the API falls back to its default database`)
    return
  }
  const envText = existsSync(apiEnvFile) ? readFileSync(apiEnvFile, 'utf8') : ''
  let password = /^PGSUPERPASSWORD=(.+)$/m.exec(envText)?.[1]?.trim()
  if (!existsSync(join(pgData, 'PG_VERSION'))) {
    log('initialising PostgreSQL cluster in .dev/pgdata')
    if (!password) {
      password = randomBytes(18).toString('base64url')
      appendFileSync(apiEnvFile, `\n# Local PostgreSQL superuser (dev only)\nPGSUPERPASSWORD=${password}\n`)
    }
    const pwFile = join(root, '.dev', 'pgpw.tmp')
    mkdirSync(join(root, '.dev'), { recursive: true })
    writeFileSync(pwFile, password)
    const init = spawnSync(pgExe('initdb'), ['-D', pgData, '-U', 'metaswap', `--pwfile=${pwFile}`, '-A', 'scram-sha-256', '-E', 'UTF8', '--locale=C'], { stdio: 'ignore' })
    rmSync(pwFile, { force: true })
    if (init.status !== 0) {
      log('initdb failed')
      shutdown(1)
    }
    appendFileSync(
      join(pgData, 'postgresql.conf'),
      "\n# MetaSwap local dev\nlisten_addresses = '127.0.0.1'\nport = 5432\nshared_preload_libraries = 'timescaledb'\ntimescaledb.telemetry_level = off\nmax_connections = 50\nshared_buffers = 256MB\n",
    )
  }
  if (!/^DATABASE_URL=/m.test(readFileSync(apiEnvFile, 'utf8'))) {
    appendFileSync(apiEnvFile, `DATABASE_URL=postgres://metaswap:${password}@127.0.0.1:5432/metaswap\n`)
  }
  const status = spawnSync(pgExe('pg_ctl'), ['-D', pgData, 'status'], { stdio: 'ignore' })
  if (status.status !== 0) {
    log('starting PostgreSQL + TimescaleDB on 127.0.0.1:5432')
    const res = spawnSync(pgExe('pg_ctl'), ['-D', pgData, '-l', join(root, '.dev', 'postgres.log'), '-w', 'start'], { stdio: 'ignore' })
    if (res.status !== 0) {
      log('PostgreSQL failed to start (see .dev/postgres.log)')
      shutdown(1)
    }
    pgStarted = true
  }
  const psql = (db, sql) => spawnSync(pgExe('psql'), ['-h', '127.0.0.1', '-U', 'metaswap', '-d', db, '-qtAc', sql], { env: { ...env, PGPASSWORD: password }, encoding: 'utf8' })
  if (!psql('postgres', "SELECT 1 FROM pg_database WHERE datname='metaswap'").stdout.includes('1')) psql('postgres', 'CREATE DATABASE metaswap')
  psql('metaswap', 'CREATE EXTENSION IF NOT EXISTS timescaledb')
}

function shutdown(code = 0) {
  if (pgStarted) spawnSync(pgExe('pg_ctl'), ['-D', pgData, '-m', 'fast', 'stop'], { stdio: 'ignore' })
  for (const child of children) {
    if (child.exitCode !== null) continue
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill('SIGTERM')
  }
  process.exit(code)
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

if (await rpcReady(500)) {
  log(`something is already listening on ${RPC}; stop it first (it may be a stale anvil).`)
  process.exit(1)
}

// Anvil persists historical chain state under ~/.foundry/anvil/tmp (several GB for a 30-day
// replay) and never cleans it up. Every launch starts a brand-new chain, so earlier state folders
// are dead weight — remove them before they fill the disk.
const anvilTmp = join(homedir(), '.foundry', 'anvil', 'tmp')
if (existsSync(anvilTmp)) {
  for (const entry of readdirSync(anvilTmp)) {
    try {
      rmSync(join(anvilTmp, entry), { recursive: true, force: true })
    } catch {} // still held by a running anvil — leave it
  }
}

// Start the chain's clock in the past so scripts/market.ts --history can replay HISTORY_DAYS of hourly
// trading up to "now" — every chart range then has real data. HISTORY_DAYS=0 disables it.
const historyDays = Number(process.env.HISTORY_DAYS ?? 30)
// --prune-history: keep only recent states in memory and persist none to disk. Without it anvil
// writes every historical state under ~/.foundry/anvil/tmp — tens of GB for a replayed month plus a
// live market. Blocks, receipts and logs are kept, which is all the indexer needs.
const anvilArgs = ['--chain-id', '31337', '--block-time', '1', '--accounts', '20', '--balance', '10000', '--port', '8545', '--prune-history', '512']
if (historyDays > 0) anvilArgs.push('--timestamp', String(Math.floor(Date.now() / 1000) - historyDays * 86400))
start('anvil', 'anvil', anvilArgs, root, { logFile: join(root, '.dev/anvil.log') })
if (!(await rpcReady())) {
  log('anvil did not start')
  shutdown(1)
}

const forgeScript = (file) => ['script', file, '--rpc-url', RPC, '--private-key', DEPLOYER_KEY, '--broadcast', '--slow']
await run('forge', ['build'], contractsDir)
await run('forge', forgeScript('script/DeployAMM.s.sol'), contractsDir)
if (existsSync(join(contractsDir, 'script/DeployX.s.sol'))) await run('forge', forgeScript('script/DeployX.s.sol'), contractsDir)
if (existsSync(join(contractsDir, 'script/DeployStage5.s.sol'))) await run('forge', forgeScript('script/DeployStage5.s.sol'), contractsDir)
await run('forge', forgeScript('script/Seed.s.sol'), contractsDir)
await run('node', ['packages/sdk/scripts/sync.mjs'], root)
if (historyDays > 0) await run('npx', ['tsx', 'scripts/market.ts', '--history'], root)
log('chain ready: contracts deployed, pools seeded, sdk synced' + (historyDays > 0 ? `, ${historyDays}d history generated` : ''))

if (!args.has('--chain-only')) {
  await ensurePostgres()
  if (existsSync(join(root, 'services/api/package.json'))) start('api', 'npm', ['run', 'dev', '-w', '@metaswap/api'], root)
  if (!args.has('--no-market') && process.env.MARKET_LIVE !== '0') start('market', 'npx', ['tsx', 'scripts/market.ts', '--live'], root)
  if (!args.has('--no-web') && existsSync(join(root, 'apps/web/package.json'))) start('web', 'npm', ['run', 'dev', '-w', '@metaswap/web'], root)
}
log('running — Ctrl+C to stop')
