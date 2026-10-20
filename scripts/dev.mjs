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
import { existsSync, mkdirSync, openSync, readdirSync, rmSync } from 'node:fs'
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

function shutdown(code = 0) {
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
const anvilArgs = ['--chain-id', '31337', '--block-time', '1', '--accounts', '20', '--balance', '10000', '--port', '8545']
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
  if (existsSync(join(root, 'services/api/package.json'))) start('api', 'npm', ['run', 'dev', '-w', '@metaswap/api'], root)
  if (!args.has('--no-market') && process.env.MARKET_LIVE !== '0') start('market', 'npx', ['tsx', 'scripts/market.ts', '--live'], root)
  if (!args.has('--no-web') && existsSync(join(root, 'apps/web/package.json'))) start('web', 'npm', ['run', 'dev', '-w', '@metaswap/web'], root)
}
log('running — Ctrl+C to stop')
