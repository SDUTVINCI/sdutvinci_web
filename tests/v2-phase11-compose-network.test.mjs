import assert from 'node:assert/strict'

let source = ''
for await (const chunk of process.stdin) source += chunk
const compose = JSON.parse(source)

const networksFor = service =>
  Object.keys(compose.services[service]?.networks || {}).sort()

assert.equal(compose.networks.backend?.internal, true,
  'database backend must remain internal')
assert.notEqual(compose.networks.egress?.internal, true,
  'dedicated egress network must permit outbound COS/GitHub access')

for (const service of [
  'operations-doctor',
  'content-export-worker',
  'content-reconcile'
]) {
  assert.deepEqual(networksFor(service), ['backend', 'egress'],
    `${service} must use internal database access plus isolated outbound egress`)
}

for (const service of ['postgres', 'migrate', 'admin', 'content-recovery']) {
  assert.deepEqual(networksFor(service), ['backend'],
    `${service} must not receive unnecessary outbound network access`)
}

assert.deepEqual(networksFor('app-blue'), ['backend', 'frontend'])
assert.deepEqual(networksFor('app-green'), ['backend', 'frontend'])
assert.deepEqual(networksFor('gateway'), ['frontend'])

process.stdout.write('phase 11 compose network isolation and required egress test passed\n')
