const { supabase } = require('../config/supabase');

/**
 * Find the user's role and corresponding record across role-specific tables:
 * 1. public.admin
 * 2. public.petugas
 * 3. public.users
 */
async function getUserRoleAndRecord(client, userId) {
  const db = client || supabase;

  try {
    // 1. Check admin table
    const { data: adminRow, error: adminErr } = await db
      .from('admin')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (!adminErr && adminRow) {
      const resolvedRole = adminRow.role || 'admin';
      return {
        role: resolvedRole,
        table: 'admin',
        profile: {
          id: adminRow.id,
          email: adminRow.email,
          full_name: adminRow.username || adminRow.name || '',
          name: adminRow.name || adminRow.username || '',
          phone: adminRow.phone || '',
          detail: adminRow.detail || '',
          location: adminRow.location || '',
          role: resolvedRole,
          updated_at: adminRow.updated_at,
        },
        raw: adminRow,
      };
    }

    // 2. Check petugas table
    const { data: petugasRow, error: petugasErr } = await db
      .from('petugas')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (!petugasErr && petugasRow) {
      return {
        role: 'petugas',
        table: 'petugas',
        profile: {
          id: petugasRow.id,
          email: petugasRow.email,
          full_name: petugasRow.name || petugasRow.username || '',
          name: petugasRow.name || petugasRow.username || '',
          phone: petugasRow.phone || '',
          detail: petugasRow.detail || '',
          location: petugasRow.location || '',
          role: 'petugas',
          updated_at: petugasRow.updated_at,
        },
        raw: petugasRow,
      };
    }

    // 3. Check users table
    const { data: userRow, error: userErr } = await db
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (!userErr && userRow) {
      return {
        role: 'user',
        table: 'users',
        profile: {
          id: userRow.id,
          email: userRow.email,
          full_name: userRow.full_name || userRow.name || '',
          name: userRow.name || userRow.full_name || '',
          phone: userRow.phone || '',
          address: userRow.address || '',
          avatar_url: userRow.avatar_url || null,
          role: 'user',
          updated_at: userRow.updated_at,
        },
        raw: userRow,
      };
    }
  } catch (err) {
    console.warn('Error fetching role/profile from role tables:', err.message);
  }

  // Default fallback
  return {
    role: 'user',
    table: 'users',
    profile: null,
    raw: null,
  };
}

module.exports = {
  getUserRoleAndRecord,
};
