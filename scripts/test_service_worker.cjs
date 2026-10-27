const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../frontend/public/sw.js'), 'utf8');

function worker() {
  const handlers = {};
  const deleted = [];
  const context = { URL, console, self: {
    addEventListener: (name, handler) => { handlers[name] = handler; },
    clients: { claim: async () => {} },
  }, caches: {
    keys: async () => ['gravetrak-api-v1', 'gravetrak-v11-app-logo', 'gravetrak-tiles-v1'],
    delete: async name => { deleted.push(name); },
  } };
  vm.runInNewContext(source, context);
  return { handlers, deleted };
}

test('private API and document requests bypass service-worker caches across origins', () => {
  const { handlers } = worker();
  for (const url of ['https://api.example/api/profile/', 'https://app.example/api/burial-documents/1/download/']) {
    handlers.fetch({ request: { method: 'GET', url }, respondWith: () => assert.fail('Private API intercepted') });
  }
});

test('activation removes the old account-data cache and preserves map tiles', async () => {
  const { handlers, deleted } = worker();
  let done;
  handlers.activate({ waitUntil: value => { done = value; } });
  await done;
  assert.deepEqual(deleted.sort(), ['gravetrak-api-v1', 'gravetrak-v11-app-logo']);
});
