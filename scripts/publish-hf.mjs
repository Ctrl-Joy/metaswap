#!/usr/bin/env node
// Publish the hosted demo to a Hugging Face Space (Docker SDK).
//
//   node scripts/publish-hf.mjs <hf-username> [space-name]      (space defaults to "metaswap")
//
// 1. exports the committed code (git archive HEAD) to a temp folder, minus the Uniswap reference
//    screenshots in docs/analysis (the public Space must not redistribute Uniswap's UI);
// 2. snapshots the saved chain (.dev/chain, built by `npm run dev`) into deploy/snapshot/;
// 3. adds the Space metadata (README front matter) and pushes one squashed commit to
//    https://huggingface.co/spaces/<user>/<space> with Git LFS for the snapshot.
// Git asks for your Hugging Face credentials itself: username + an access token with write access.
import { spawnSync } from 'node:child_process'
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'

const [user, space = 'metaswap'] = process.argv.slice(2)
if (!user) {
  console.error('usage: node scripts/publish-hf.mjs <hf-username> [space-name]')
  process.exit(1)
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sh = (cmd, args, cwd, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', ...opts })
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
if (spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout.trim()) {
  console.warn('note: uncommitted changes are NOT included (the export uses the last commit)')
}

const out = mkdtempSync(join(tmpdir(), 'metaswap-hf-'))
console.log(`[publish] exporting HEAD to ${out}`)
const tar = join(out, '..', `${out.split(/[\\/]/).pop()}.tar`)
sh('git', ['archive', '--format=tar', '-o', tar, 'HEAD'], root)
sh('tar', ['-xf', tar, '-C', out], root)
rmSync(tar, { force: true })
for (const d of ['docs/analysis/screens', 'docs/analysis/measured']) rmSync(join(out, d), { recursive: true, force: true })

console.log('[publish] snapshotting the saved chain')
const snap = join(out, 'deploy', 'snapshot')
mkdirSync(join(snap, 'sdk'), { recursive: true })
await pipeline(createReadStream(join(root, '.dev/chain/state.json')), createGzip({ level: 9 }), createWriteStream(join(snap, 'state.json.gz')))
copyFileSync(join(root, '.dev/chain/meta.json'), join(snap, 'meta.json'))
copyFileSync(join(root, 'packages/contracts/deployments/31337.json'), join(snap, 'deployment.json'))
const gen = join(root, 'packages/sdk/src/generated')
for (const f of readdirSync(gen)) copyFileSync(join(gen, f), join(snap, 'sdk', f))

const front = ['---', 'title: MetaSwap', 'emoji: 🔁', 'colorFrom: indigo', 'colorTo: purple', 'sdk: docker', 'app_port: 7860', 'pinned: false', 'license: gpl-3.0', 'short_description: Uniswap-style DEX demo on a local devnet', '---', ''].join('\n')
writeFileSync(join(out, 'README.md'), front + readFileSync(join(out, 'README.md'), 'utf8'))
writeFileSync(join(out, '.dockerignore'), 'node_modules\n**/node_modules\n.git\n')

console.log('[publish] committing and pushing to Hugging Face')
sh('git', ['init', '-q', '-b', 'main'], out)
sh('git', ['lfs', 'install', '--local'], out)
sh('git', ['lfs', 'track', '*.gz'], out)
sh('git', ['add', '-A'], out)
sh('git', ['-c', 'user.name=MetaSwap', '-c', 'user.email=metaswap@users.noreply.huggingface.co', 'commit', '-q', '-m', 'MetaSwap hosted demo'], out)
sh('git', ['push', '--force', `https://huggingface.co/spaces/${user}/${space}`, 'main'], out)
console.log(`\n[publish] done → https://huggingface.co/spaces/${user}/${space}  (the Space builds for a few minutes)`)
