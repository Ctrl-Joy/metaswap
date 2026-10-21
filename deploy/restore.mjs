#!/usr/bin/env node
// Image build step: restore deploy/snapshot/ (written by scripts/publish-hf.mjs) into the places
// dev.mjs and the apps expect, so the container resumes the saved chain instead of building one.
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { createGunzip } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const snap = join(root, 'deploy', 'snapshot')
if (!existsSync(join(snap, 'state.json.gz'))) {
  console.error('deploy/snapshot/state.json.gz missing — publish with `node scripts/publish-hf.mjs`')
  process.exit(1)
}
for (const d of ['.dev/chain', 'packages/contracts/deployments', 'packages/sdk/src/generated']) mkdirSync(join(root, d), { recursive: true })
await pipeline(createReadStream(join(snap, 'state.json.gz')), createGunzip(), createWriteStream(join(root, '.dev/chain/state.json')))
copyFileSync(join(snap, 'meta.json'), join(root, '.dev/chain/meta.json'))
copyFileSync(join(snap, 'deployment.json'), join(root, 'packages/contracts/deployments/31337.json'))
for (const f of readdirSync(join(snap, 'sdk'))) copyFileSync(join(snap, 'sdk', f), join(root, 'packages/sdk/src/generated', f))
console.log('snapshot restored')
