import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUserPatch } from './userManagement.js';

const original = { email: 'user@example.com', first_name: 'Ana', last_name: 'Cruz', role: 'user', contact_number: '', permissions: [], is_active: true };

test('contact edits omit unchanged role, permissions and active status', () => {
  assert.deepEqual(buildUserPatch(original, { ...original, first_name: 'Anna', contact_number: '09123456789' }), { first_name: 'Anna', contact_number: '09123456789' });
});

test('intentional role, permission removal and deactivation are sent', () => {
  assert.deepEqual(buildUserPatch({ ...original, permissions: ['manage_users'] }, { ...original, role: 'staff', is_active: false }), { role: 'staff', is_active: false, permissions: [] });
});

test('reordered permissions do not create an unnecessary restricted edit', () => {
  assert.deepEqual(buildUserPatch({ ...original, permissions: ['manage_users', 'assign_roles'] }, { ...original, permissions: ['assign_roles', 'manage_users'] }), {});
});
