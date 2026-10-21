#!/usr/bin/env node
// Pack the hosted demo into one file for a server (e.g. Oracle Cloud Always Free):
//   node scripts/export-demo.mjs            → .dev/metaswap-demo.tar.gz
// Contents: the committed code (git archive HEAD, minus the Uniswap reference screenshots) plus
// deploy/snapshot/ (the saved chain, deployment and generated sdk files). On the server:
//   tar -xzf metaswap-demo.tar.gz && docker build -t metaswap . && docker run -d -p 80:7860 metaswap
import { spawnSync } from 'node:child_process'
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sh = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' })
  if (r.status !== 0) {
    console.error(`failed: ${cmd} ${args.join(' ')}`)
    process.exit(1)
  }
}
for (const f of ['.dev/chain/state.json', '.dev/chain/meta.json', 'packages/contracts/deployments/31337.json', 'packages/sdk/src/generated/abis.ts']) {
  if (!existsSync(join(root, f))) {
    console.error(`missing ${f} — run \`npm run dev\` first so a chain is built and saved`)
    process.exit(1)
  }
}

const work = mkdtempSync(join(tmpdir(), 'metaswap-demo-'))
const app = join(work, 'metaswap')
mkdirSync(app)
const codeTar = join(work, 'code.tar')
sh('git', ['archive', '--format=tar', '-o', codeTar, 'HEAD'], root)
sh('tar', ['-xf', 'code.tar', '-C', 'metaswap'], work) // relative paths: GNU tar reads C: as a host
rmSync(codeTar)
for (const d of ['docs/analysis/screens', 'docs/analysis/measured']) rmSync(join(app, d), { recursive: true, force: true })

const snap = join(app, 'deploy', 'snapshot')
mkdirSync(join(snap, 'sdk'), { recursive: true })
await pipeline(createReadStream(join(root, '.dev/chain/state.json')), createGzip({ level: 9 }), createWriteStream(join(snap, 'state.json.gz')))
copyFileSync(join(root, '.dev/chain/meta.json'), join(snap, 'meta.json'))
copyFileSync(join(root, 'packages/contracts/deployments/31337.json'), join(snap, 'deployment.json'))
const gen = join(root, 'packages/sdk/src/generated')
for (const f of readdirSync(gen)) copyFileSync(join(gen, f), join(snap, 'sdk', f))

mkdirSync(join(root, '.dev'), { recursive: true })
const out = join(root, '.dev', 'metaswap-demo.tar.gz')
sh('tar', ['-czf', 'metaswap-demo.tar.gz', '-C', 'metaswap', '.'], work)
copyFileSync(join(work, 'metaswap-demo.tar.gz'), out)
rmSync(work, { recursive: true, force: true })
console.log(`demo bundle: ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB)`)
