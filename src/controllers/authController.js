const { supabase } = require('../config/supabase');
const { getUserRoleAndRecord } = require('../utils/userRoleHelper');

/**
 * Register a new user
 * POST /api/auth/register
 * Body: { email, password, name, phone, role?: 'user' | 'admin' | 'petugas' }
 */
async function register(req, res) {
  try {
    const { email, password, name, phone, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email dan password wajib diisi.',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password minimal terdiri dari 6 karakter.',
      });
    }

    const cleanRole = (role || 'user').toString().trim().toLowerCase();
    const targetRole = ['super_admin', 'superadmin', 'admin', 'petugas', 'user'].includes(cleanRole) ? cleanRole : 'user';
    const cleanName = name ? String(name).trim() : '';
    const cleanPhone = phone ? String(phone).trim() : '';
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanDetail = req.body.detail ? String(req.body.detail).trim() : '';
    const cleanLocation = req.body.location ? String(req.body.location).trim() : '';

    // 1. Sign up through Supabase Auth with role in metadata for automatic triggers
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: {
          name: cleanName,
          phone: cleanPhone,
          role: targetRole,
        },
      },
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Registrasi gagal. Periksa email dan kata sandi Anda.',
        error: error.message,
      });
    }

    const user = data.user;
    const session = data.session;
    const requiresEmailConfirmation = !session && (!user || !user.email_confirmed_at);

    // 2. Insert/upsert directly into the role-specific table (users, admin, or petugas)
    if (user?.id) {
      try {
        if (['admin', 'super_admin', 'superadmin'].includes(targetRole)) {
          const roleValue = (targetRole === 'super_admin' || targetRole === 'superadmin') ? 'super_admin' : 'admin';
          await supabase.from('admin').upsert({
            id: user.id,
            email: cleanEmail,
            username: cleanName,
            name: cleanName,
            phone: cleanPhone,
            detail: cleanDetail || (roleValue === 'super_admin' ? 'Super Administrator' : 'Administrator'),
            location: cleanLocation || 'Campy HQ',
            role: roleValue,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'id' });
        } else if (targetRole === 'petugas') {
          await supabase.from('petugas').upsert({
            id: user.id,
            email: cleanEmail,
            name: cleanName,
            username: cleanName,
            phone: cleanPhone,
            detail: cleanDetail || 'Petugas Inventaris',
            location: cleanLocation || 'Campy Store',
            role: 'petugas',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'id' });
        } else {
          await supabase.from('users').upsert({
            id: user.id,
            email: cleanEmail,
            name: cleanName,
            full_name: cleanName,
            phone: cleanPhone,
            role: 'user',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'id' });
        }
      } catch (insertErr) {
        console.warn(`Direct insert into role table ${targetRole} warning:`, insertErr.message);
      }
    }

    return res.status(201).json({
      success: true,
      message: requiresEmailConfirmation
        ? 'Registrasi berhasil! Silakan periksa email Anda untuk konfirmasi sebelum masuk.'
        : 'Registrasi berhasil!',
      requiresEmailConfirmation,
      data: {
        user,
        role: targetRole,
        accessToken: session?.access_token || null,
        refreshToken: session?.refresh_token || null,
      },
    });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server saat registrasi.',
      error: err.message,
    });
  }
}

/**
 * Login user
 * POST /api/auth/login
 * Body: { email, password }
 */
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email dan password wajib diisi.',
      });
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error || !data.session) {
      return res.status(401).json({
        success: false,
        message: 'Email atau password salah.',
      });
    }

    // Fetch user info from role-specific tables (admin, petugas, or users)
    const { role, profile } = await getUserRoleAndRecord(supabase, data.user.id);
    const resolvedRole = role || data.user.user_metadata?.role || 'user';

    return res.status(200).json({
      success: true,
      message: 'Login berhasil.',
      data: {
        user: data.user,
        profile: profile || {
          id: data.user.id,
          email: data.user.email,
          full_name: data.user.user_metadata?.name || '',
          name: data.user.user_metadata?.name || '',
          phone: data.user.user_metadata?.phone || '',
          role: resolvedRole,
        },
        role: resolvedRole,
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server saat login.',
      error: err.message,
    });
  }
}

/**
 * Staff login for Admin & Petugas
 * POST /api/auth/staff-login
 * Body: { email, password, role: 'admin' | 'petugas' }
 */
async function staffLogin(req, res) {
  try {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, dan role (admin/petugas) wajib diisi.',
      });
    }

    const targetRole = String(role).trim().toLowerCase();
    if (!['admin', 'petugas', 'super_admin', 'superadmin'].includes(targetRole)) {
      return res.status(400).json({
        success: false,
        message: 'Role staff hanya boleh "admin", "super_admin", atau "petugas".',
      });
    }

    // Sign in through Supabase Auth
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error || !data.session) {
      return res.status(401).json({
        success: false,
        message: 'Email atau password staff tidak valid.',
      });
    }

    // Verify directly in the specific role table
    const targetTable = ['admin', 'super_admin', 'superadmin'].includes(targetRole) ? 'admin' : 'petugas';
    const { data: staffRecord, error: staffErr } = await supabase
      .from(targetTable)
      .select('*')
      .eq('id', data.user.id)
      .maybeSingle();

    const actualRole = staffRecord?.role || data.user.user_metadata?.role || targetRole;

    if (targetRole === 'petugas') {
      if (actualRole !== 'petugas') {
        return res.status(403).json({
          success: false,
          message: 'Akses ditolak: akun ini bukan petugas.',
        });
      }
    } else {
      // admin or super_admin
      if (!['admin', 'super_admin', 'superadmin'].includes(actualRole)) {
        return res.status(403).json({
          success: false,
          message: 'Akses ditolak: akun ini tidak terdaftar sebagai staf administrator.',
        });
      }
    }

    const staffName = staffRecord?.username || staffRecord?.name || data.user.user_metadata?.name || data.user.email;
    const resolvedRole = staffRecord?.role || actualRole;

    return res.status(200).json({
      success: true,
      message: `Login ${resolvedRole} berhasil.`,
      data: {
        role: resolvedRole,
        name: staffName,
        email: data.user.email,
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        user: data.user,
        profile: {
          id: staffRecord?.id || data.user.id,
          email: staffRecord?.email || data.user.email,
          full_name: staffName,
          detail: staffRecord?.detail || '',
          location: staffRecord?.location || '',
          role: resolvedRole,
        },
      },
    });
  } catch (err) {
    console.error('Staff login error:', err);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat memproses login staff.',
      error: err.message,
    });
  }
}

/**
 * Refresh access token
 * POST /api/auth/refresh
 * Body: { refreshToken }
 */
async function refreshSession(req, res) {
  try {
    const refreshToken = req.body.refreshToken || req.body.refresh_token;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'refreshToken wajib disertakan.',
      });
    }

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      return res.status(401).json({
        success: false,
        message: 'Gagal memperbarui token sesi.',
        error: error?.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Token berhasil diperbarui.',
      data: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        user: data.user,
      },
    });
  } catch (err) {
    console.error('Refresh session error:', err);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server saat memperbarui token.',
      error: err.message,
    });
  }
}

/**
 * Get current user profile from the corresponding role table
 * GET /api/auth/profile
 */
async function getProfile(req, res) {
  try {
    const userId = req.user.id;
    const client = req.supabase || supabase;
    const userRole = req.userRole || req.user.user_metadata?.role || 'user';
    const targetTable = userRole === 'admin' ? 'admin' : (userRole === 'petugas' ? 'petugas' : 'users');

    const { data, error } = await client
      .from(targetTable)
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    const metaName = req.user.user_metadata?.name || '';
    const metaPhone = req.user.user_metadata?.phone || '';

    // If query returned error (e.g. table column id not yet created in remote DB), return fallback gracefully
    if (error) {
      console.warn(`getProfile warning from table ${targetTable}:`, error.message);
      return res.status(200).json({
        success: true,
        data: {
          id: userId,
          email: req.user.email,
          full_name: metaName,
          name: metaName,
          phone: metaPhone,
          role: userRole,
          address: '',
          avatar_url: null,
          detail: '',
          location: '',
        },
      });
    }

    const full_name = data?.full_name || data?.name || data?.username || metaName || '';
    const phone = data?.phone || metaPhone || '';

    return res.status(200).json({
      success: true,
      data: {
        id: userId,
        email: data?.email || req.user.email,
        full_name,
        name: full_name,
        phone,
        role: userRole,
        address: data?.address || '',
        avatar_url: data?.avatar_url || null,
        detail: data?.detail || '',
        location: data?.location || '',
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil profil.',
      error: err.message,
    });
  }
}

/**
 * Update current user profile in the corresponding role table
 * PUT /api/auth/profile
 */
async function updateProfile(req, res) {
  try {
    const userId = req.user.id;
    const client = req.supabase || supabase;
    const userRole = req.userRole || req.user.user_metadata?.role || 'user';
    const targetTable = userRole === 'admin' ? 'admin' : (userRole === 'petugas' ? 'petugas' : 'users');
    const { full_name, name, phone, address, avatar_url, detail, location } = req.body;

    const updates = {
      updated_at: new Date().toISOString(),
    };

    const newName = full_name !== undefined ? full_name : name;
    if (newName !== undefined) {
      if (targetTable === 'users') {
        updates.full_name = newName;
        updates.name = newName;
      } else {
        updates.name = newName;
        updates.username = newName;
      }
    }
    if (phone !== undefined) updates.phone = phone;
    if (detail !== undefined) updates.detail = detail;
    if (location !== undefined) updates.location = location;

    if (targetTable === 'users') {
      if (address !== undefined) updates.address = address;
      if (avatar_url !== undefined) updates.avatar_url = avatar_url;
    }

    const { data, error } = await client
      .from(targetTable)
      .update(updates)
      .eq('id', userId)
      .select()
      .maybeSingle();

    if (error) {
      console.warn(`updateProfile warning on table ${targetTable}:`, error.message);
      // Return 200 with sanitized response
      return res.status(200).json({
        success: true,
        message: 'Profil berhasil diperbarui.',
        data: {
          id: userId,
          email: req.user.email,
          full_name: newName || req.user.user_metadata?.name || '',
          phone: phone || '',
          address: address || '',
          avatar_url: avatar_url || null,
          detail: detail || '',
          location: location || '',
          role: userRole,
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Profil berhasil diperbarui.',
      data: {
        id: userId,
        email: data?.email || req.user.email,
        full_name: data?.full_name || data?.name || data?.username || newName || '',
        phone: data?.phone || '',
        address: data?.address || '',
        avatar_url: data?.avatar_url || null,
        detail: data?.detail || '',
        location: data?.location || '',
        role: userRole,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat memperbarui profil.',
      error: err.message,
    });
  }
}

module.exports = {
  register,
  login,
  staffLogin,
  refreshSession,
  getProfile,
  updateProfile,
};
