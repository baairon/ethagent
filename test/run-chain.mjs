// Runs the chain suite: every command that sends, against two local Anvil chains (an
// Ethereum Mainnet stand-in for ENS and a Base stand-in for the agent registry), with the
// stand-in contracts from contracts/test/chain placed at the real addresses and a local
// IPFS endpoint served from this process. Needs Foundry (anvil and forge) on PATH.
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, '.test-dist')
const children = []

function fail(message) {
  console.error(`chain suite: ${message}`)
  process.exitCode = 1
}

function which(command) {
  return spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const body = await response.json()
  if (body.error) throw new Error(`${method}: ${body.error.message}`)
  return body.result
}

async function startAnvil(chainId, port, extra = []) {
  const child = spawn('anvil', ['--port', String(port), '--chain-id', String(chainId), '--silent', ...extra], { stdio: 'ignore' })
  children.push(child)
  const url = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if (Number(await rpc(url, 'eth_chainId')) === chainId) return url
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`anvil for chain ${chainId} did not start on port ${port}`)
}

// A minimal IPFS API and gateway: add returns a raw-codec CIDv1 of the bytes, and both
// cat and /ipfs/<cid> serve them back, so the reader's hash check passes.
function startIpfs() {
  const blobs = new Map()
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = Buffer.concat(chunks)
      if (url.pathname === '/api/v0/add') {
        const form = await new Request('http://127.0.0.1/', { method: 'POST', headers: req.headers, body }).formData()
        const file = [...form.values()].find(value => typeof value !== 'string')
        const bytes = new Uint8Array(await file.arrayBuffer())
        const cid = CID.createV1(0x55, await sha256.digest(bytes)).toString()
        blobs.set(cid, bytes)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ Hash: cid, Name: file.name, Size: String(bytes.length) }))
        return
      }
      const cid = url.pathname === '/api/v0/cat' ? url.searchParams.get('arg') : url.pathname.replace(/^\/ipfs\//, '').split('/')[0]
      const bytes = cid ? blobs.get(cid) : undefined
      if (!bytes) {
        res.writeHead(404)
        res.end('not found')
        return
      }
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) })
      res.end(Buffer.from(bytes))
    } catch (err) {
      res.writeHead(500)
      res.end(String(err))
    }
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })))
}

async function main() {
  if (!which('anvil') || !which('forge')) {
    fail('anvil and forge are needed; install Foundry (https://getfoundry.sh).')
    return
  }
  const forge = spawnSync('forge', ['build', '--offline'], { cwd: path.join(root, 'contracts'), stdio: 'inherit' })
  if (forge.status !== 0) {
    const online = spawnSync('forge', ['build'], { cwd: path.join(root, 'contracts'), stdio: 'inherit' })
    if (online.status !== 0) return fail('forge build failed')
  }
  await fs.rm(outDir, { recursive: true, force: true })
  const tsc = spawnSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '--outDir', outDir, '--noEmit', 'false'], { cwd: root, stdio: 'inherit' })
  if (tsc.status !== 0) return fail('typescript did not compile')

  // Owner lookups scan registry logs from the registry's real start block on Base, so the
  // Base chain starts just past it instead of at block 0.
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-chain-'))
  const genesis = path.join(home, 'base-genesis.json')
  await fs.writeFile(genesis, JSON.stringify({
    config: { chainId: 8453 },
    nonce: '0x0',
    timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`,
    extraData: '0x',
    gasLimit: '0x1c9c380',
    difficulty: '0x0',
    number: `0x${(41_663_800).toString(16)}`,
    alloc: {},
  }))
  const [mainnet, base, ipfs] = await Promise.all([startAnvil(1, 18545), startAnvil(8453, 18546, ['--init', genesis]), startIpfs()])
  try {
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      ETHAGENT_CHAIN_MAINNET_RPC: mainnet,
      ETHAGENT_CHAIN_BASE_RPC: base,
      ETHAGENT_CHAIN_ARTIFACTS: path.join(root, 'contracts', 'out'),
      ETHAGENT_RPC_URL: base,
      ETHAGENT_ENS_RPC_URL: mainnet,
      ETHAGENT_IPFS_API_URL: ipfs.url,
      ETHAGENT_IPFS_GATEWAYS: ipfs.url,
      ETHAGENT_IPFS_ROUTERS: '',
      ETHAGENT_HOSTS_FILE: '',
      ETHAGENT_NO_DAEMON: '1',
    }
    delete env.PINATA_JWT
    delete env.PINATA_GATEWAY_URL
    delete env.ETHAGENT_OPERATOR_KEY
    const dir = path.join(outDir, 'test', 'chain')
    const files = (await fs.readdir(dir)).filter(name => name.endsWith('.test.js')).sort().map(name => path.join(dir, name))
    // Not spawnSync: the IPFS endpoint lives in this process and must keep answering.
    const status = await new Promise(resolve => {
      const run = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-timeout=120000', ...files], { cwd: root, stdio: 'inherit', env })
      children.push(run)
      run.on('exit', code => resolve(code ?? 1))
    })
    if (status !== 0) process.exitCode = status
  } finally {
    ipfs.server.close()
    await fs.rm(home, { recursive: true, force: true })
    await fs.rm(outDir, { recursive: true, force: true })
  }
}

try {
  await main()
} catch (err) {
  fail(err instanceof Error ? err.stack ?? err.message : String(err))
} finally {
  for (const child of children) child.kill('SIGTERM')
}
