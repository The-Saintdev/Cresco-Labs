import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = resolve(backendRoot, 'wrangler.jsonc')
const migrationPaths = [
  resolve(backendRoot, 'db/d1/0001_initial.sql'),
  resolve(backendRoot, 'db/d1/0002_provider_usage.sql'),
  resolve(backendRoot, 'db/d1/0003_text_dispatch.sql'),
  resolve(backendRoot, 'db/d1/0004_sessions.sql'),
]
const workerPath = resolve(backendRoot, 'src/worker.js')
const failures = []

if (!existsSync(configPath)) failures.push('backend/wrangler.jsonc is missing')
for (const migrationPath of migrationPaths) {
  if (!existsSync(migrationPath)) failures.push(`the D1 migration ${migrationPath.split(/[\\/]/).pop()} is missing`)
}
if (!existsSync(workerPath)) failures.push('the Cloudflare Worker entry point is missing')

if (existsSync(configPath)) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const databaseId = config.d1_databases?.[0]?.database_id || ''
  const vars = config.vars || {}
  const requiredSecrets = new Set(config.secrets?.required || [])
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(databaseId)) failures.push('replace REPLACE_WITH_D1_DATABASE_ID with the ID returned by `wrangler d1 create cresco`')
  if (!/^https:\/\//i.test(vars.CRESCO_PUBLIC_API_URL || '') || /example\.com/i.test(vars.CRESCO_PUBLIC_API_URL)) failures.push('set CRESCO_PUBLIC_API_URL to the deployed Worker or custom API domain')
  if (!String(vars.CRESCO_ALLOWED_ORIGINS || '').split(',').some(value => /^https:\/\//i.test(value.trim()) && !/example\./i.test(value))) failures.push('add the final HTTPS Vercel origin to CRESCO_ALLOWED_ORIGINS')
  for (const secret of ['CRESCO_TOKEN_SECRET', 'CRESCO_ENCRYPTION_KEY', 'CRESCO_PASSWORD_PEPPER', 'CRESCO_ADMIN_EMAIL', 'CRESCO_ADMIN_PASSWORD', 'CRESCO_ASSET_SIGNING_SECRET']) {
    if (!requiredSecrets.has(secret)) failures.push(`declare ${secret} as a required Worker secret`)
  }
}

if (failures.length) {
  console.error('Cresco Cloudflare deployment is not configured:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log('Cresco Cloudflare deployment configuration is ready.')
}
