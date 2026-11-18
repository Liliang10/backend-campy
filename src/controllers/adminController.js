const { supabase } = require('../config/supabase');

/**
 * Get all admin users from admin table
 * GET /api/admins
 */
async function getAdmins(req, res) {
  try {
    const { q } = req.query;
    const client = req.supabase || supabase;

    let query = client
      .from('admin')
      .select('id, username, name, email, detail, location, role, updated_at')
      .order('updated_at', { ascending: false });

    if (q) {
      query = query.or(`username.ilike.%${q}%,email.ilike.%${q}%,name.ilike.%${q}%`);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Gagal mengambil daftar admin.',
        error: error.message,
      });
    }

    // Map fields for Flutter AdminUser compatibility (username <-> full_name)
    const admins = (data || []).map((a) => ({
      id: a.id,
      username: a.username || a.name || a.email || 'Admin',
      email: a.email || '',
      detail: a.detail || '',
      location: a.location || '',
      role: a.role || 'admin',
    }));

    return res.status(200).json({
      success: true,
      count: admins.length,
      data: admins,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil daftar admin.',
      error: err.message,
    });
  }
}

/**
 * Add or promote user to admin
 * POST /api/admins
 * Body: { username, email, detail, location, password }
 */
async function createAdmin(req, res) {
  try {
    const { username, email, detail, location, password, role } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username, email, dan password wajib diisi untuk membuat akun admin.',
      });
    }
    if (String(password).length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password admin minimal terdiri dari 6 karakter.',
      });
    }

    const cleanRole = (role === 'super_admin' || role === 'superadmin') ? 'super_admin' : 'admin';
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanName = String(username).trim();
    const client = req.supabase || supabase;

    // Check if admin already exists with this email
    const { data: existingAdmin } = await client
      .from('admin')
      .select('*')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (existingAdmin) {
      // Update existing admin
      const { data: updated, error: updateErr } = await client
        .from('admin')
        .update({
          username: cleanName,
          name: cleanName,
          detail: detail ? String(detail).trim() : existingAdmin.detail,
          location: location ? String(location).trim() : existingAdmin.location,
          role: cleanRole,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingAdmin.id)
        .select()
        .single();

      if (updateErr) {
        return res.status(400).json({
          success: false,
          message: 'Gagal memperbarui data admin.',
          error: updateErr.message,
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Data admin berhasil diperbarui.',
        data: {
          id: updated.id,
          username: updated.username || updated.name,
          email: updated.email,
          detail: updated.detail || '',
          location: updated.location || '',
          role: updated.role,
        },
      });
    }

    // Register user via Supabase Auth with role
    const { data: authData, error: authErr } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: {
          name: cleanName,
          role: cleanRole,
        },
      },
    });

    if (authErr) {
      return res.status(400).json({
        success: false,
        message: 'Gagal membuat akun auth admin. Periksa email dan konfigurasi.',
        error: authErr.message,
      });
    }

    if (!authData.user?.id) {
      return res.status(500).json({
        success: false,
        message: 'Supabase tidak mengembalikan ID akun admin.',
      });
    }
    const newUserId = authData.user.id;

    // Insert directly into public.admin table
    const { data: newAdmin, error: adminErr } = await client
      .from('admin')
      .upsert({
        id: newUserId,
        email: cleanEmail,
        username: cleanName,
        name: cleanName,
        role: cleanRole,
        detail: detail ? String(detail).trim() : '',
        location: location ? String(location).trim() : '',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' })
      .select()
      .single();

    if (adminErr) {
      return res.status(400).json({
        success: false,
        message: 'Gagal mencatat admin di tabel admin.',
        error: adminErr.message,
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Admin baru berhasil dibuat.',
      data: {
        id: newAdmin.id,
        username: newAdmin.username || newAdmin.name,
        email: newAdmin.email,
        detail: newAdmin.detail || '',
        location: newAdmin.location || '',
        role: newAdmin.role,
      },
    });
  } catch (err) {
    console.error('Create admin error:', err);
    return res.status(500).json({
      success: false,
      message: 'Gagal menambahkan admin.',
      error: err.message,
    });
  }
}

/**
 * Update admin in admin table
 * PUT /api/admins/:id
 * Body: { username, email, detail, location }
 */
async function updateAdmin(req, res) {
  try {
    const { id } = req.params;
    const { username, email, detail, location, role } = req.body;
    const client = req.supabase || supabase;

    const updates = {
      updated_at: new Date().toISOString(),
    };
    if (username !== undefined) {
      updates.username = String(username).trim();
      updates.name = String(username).trim();
    }
    if (email !== undefined) updates.email = String(email).trim().toLowerCase();
    if (detail !== undefined) updates.detail = String(detail).trim();
    if (location !== undefined) updates.location = String(location).trim();
    if (role !== undefined) updates.role = String(role).trim().toLowerCase();

    const { data, error } = await client
      .from('admin')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Gagal memperbarui admin.',
        error: error.message,
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Data admin tidak ditemukan.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Data admin berhasil diperbarui.',
      data: {
        id: data.id,
        username: data.username || data.name,
        email: data.email,
        detail: data.detail || '',
        location: data.location || '',
        role: data.role,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Gagal memperbarui admin.',
      error: err.message,
    });
  }
}

/**
 * Delete admin from admin table
 * DELETE /api/admins/:id
 */
async function deleteAdmin(req, res) {
  try {
    const { id } = req.params;
    const client = req.supabase || supabase;

    const { error } = await client
      .from('admin')
      .delete()
      .eq('id', id);

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Gagal menghapus admin.',
        error: error.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Admin berhasil dihapus.',
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Gagal menghapus admin.',
      error: err.message,
    });
  }
}

/**
 * Get all petugas users from petugas table
 * GET /api/admins/petugas
 */
async function getPetugasList(req, res) {
  try {
    const { q } = req.query;
    const client = req.supabase || supabase;

    let query = client
      .from('petugas')
      .select('id, name, username, email, phone, detail, location, role, updated_at')
      .order('updated_at', { ascending: false });

    if (q) {
      query = query.or(`name.ilike.%${q}%,username.ilike.%${q}%,email.ilike.%${q}%`);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Gagal mengambil daftar petugas.',
        error: error.message,
      });
    }

    const petugas = (data || []).map((p) => ({
      id: p.id,
      name: p.name || p.username || 'Petugas',
      username: p.username || p.name || 'Petugas',
      email: p.email || '',
      phone: p.phone || '',
      detail: p.detail || '',
      location: p.location || '',
      role: p.role || 'petugas',
    }));

    return res.status(200).json({
      success: true,
      count: petugas.length,
      data: petugas,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil daftar petugas.',
      error: err.message,
    });
  }
}

/**
 * Create a new petugas account
 * POST /api/admins/petugas
 * Body: { name, username, email, password, phone, detail, location }
 */
async function createPetugas(req, res) {
  try {
    const { name, username, email, password, phone, detail, location } = req.body;
    const staffName = String(username || name || '').trim();

    if (!staffName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Nama/username, email, dan password wajib diisi untuk membuat akun petugas.',
      });
    }
    if (String(password).length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password petugas minimal terdiri dari 6 karakter.',
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPhone = phone ? String(phone).trim() : '';
    const client = req.supabase || supabase;

    // Check if petugas already exists in petugas table
    const { data: existingPetugas } = await client
      .from('petugas')
      .select('*')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (existingPetugas) {
      const { data: updated, error: updateErr } = await client
        .from('petugas')
        .update({
          name: staffName,
          username: staffName,
          phone: cleanPhone || existingPetugas.phone,
          detail: detail ? String(detail).trim() : existingPetugas.detail,
          location: location ? String(location).trim() : existingPetugas.location,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingPetugas.id)
        .select()
        .single();

      if (updateErr) {
        return res.status(400).json({
          success: false,
          message: 'Gagal memperbarui data petugas.',
          error: updateErr.message,
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Data petugas berhasil diperbarui.',
        data: updated,
      });
    }

    // Register user via Supabase Auth with role: 'petugas'
    const { data: authData, error: authErr } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: {
          name: staffName,
          phone: cleanPhone,
          role: 'petugas',
        },
      },
    });

    if (authErr) {
      return res.status(400).json({
        success: false,
        message: 'Gagal membuat akun auth petugas.',
        error: authErr.message,
      });
    }

    if (!authData.user?.id) {
      return res.status(500).json({
        success: false,
        message: 'Supabase tidak mengembalikan ID akun petugas.',
      });
    }

    const newUserId = authData.user.id;

    // Insert directly into public.petugas table
    const { data: newPetugas, error: petugasErr } = await client
      .from('petugas')
      .upsert({
        id: newUserId,
        email: cleanEmail,
        name: staffName,
        username: staffName,
        phone: cleanPhone,
        role: 'petugas',
        detail: detail ? String(detail).trim() : '',
        location: location ? String(location).trim() : '',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' })
      .select()
      .single();

    if (petugasErr) {
      return res.status(400).json({
        success: false,
        message: 'Gagal mencatat petugas di tabel petugas.',
        error: petugasErr.message,
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Petugas baru berhasil dibuat.',
      data: newPetugas,
    });
  } catch (err) {
    console.error('Create petugas error:', err);
    return res.status(500).json({
      success: false,
      message: 'Gagal menambahkan petugas.',
      error: err.message,
    });
  }
}

/**
 * Update petugas in petugas table
 * PUT /api/admins/petugas/:id
 */
async function updatePetugas(req, res) {
  try {
    const { id } = req.params;
    const { name, username, email, phone, detail, location } = req.body;
    const client = req.supabase || supabase;

    const updates = {
      updated_at: new Date().toISOString(),
    };
    const staffName = username || name;
    if (staffName !== undefined) {
      updates.name = String(staffName).trim();
      updates.username = String(staffName).trim();
    }
    if (email !== undefined) updates.email = String(email).trim().toLowerCase();
    if (phone !== undefined) updates.phone = String(phone).trim();
    if (detail !== undefined) updates.detail = String(detail).trim();
    if (location !== undefined) updates.location = String(location).trim();

    const { data, error } = await client
      .from('petugas')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Gagal memperbarui data petugas.',
        error: error.message,
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Data petugas tidak ditemukan.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Data petugas berhasil diperbarui.',
      data,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Gagal memperbarui data petugas.',
      error: err.message,
    });
  }
}

/**
 * Delete petugas from petugas table
 * DELETE /api/admins/petugas/:id
 */
async function deletePetugas(req, res) {
  try {
    const { id } = req.params;
    const client = req.supabase || supabase;

    const { error } = await client
      .from('petugas')
      .delete()
      .eq('id', id);

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Gagal menghapus petugas.',
        error: error.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Petugas berhasil dihapus.',
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Gagal menghapus petugas.',
      error: err.message,
    });
  }
}

module.exports = {
  getAdmins,
  createAdmin,
  updateAdmin,
  deleteAdmin,
  getPetugasList,
  createPetugas,
  updatePetugas,
  deletePetugas,
};
