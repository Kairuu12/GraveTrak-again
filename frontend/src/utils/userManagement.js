// Only send changed fields: unrelated edits must not require role/permission grants.
export function buildUserPatch(original, edited) {
  const patch = {};
  for (const field of ['email', 'first_name', 'last_name', 'contact_number', 'role', 'is_active', 'permissions']) {
    const before = original[field];
    const after = edited[field];
    const same = field === 'permissions'
      ? JSON.stringify([...(before || [])].sort()) === JSON.stringify([...(after || [])].sort())
      : before === after;
    if (!same) patch[field] = after;
  }
  return patch;
}
