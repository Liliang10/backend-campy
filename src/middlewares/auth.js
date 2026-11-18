const { supabase, getAuthenticatedClient } = require('../config/supabase');
const { getUserRoleAndRecord } = require('../utils/userRoleHelper');

/**
 * Middleware that strictly requires a valid Supabase access token.
 * Populates req.user, req.token, req.supabase, req.userRole, and req.userProfile.
 */
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Akses ditolak: token otentikasi tidak ditemukan.',
      });
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: 'Token otentikasi tidak valid atau sudah kedaluwarsa.',
        error: error?.message,
      });
    }

    req.token = token;
    req.user = user;
    req.supabase = getAuthenticatedClient(token);

    // Identify role and profile from role-specific tables (admin, petugas, users)
    const { role, profile, table } = await getUserRoleAndRecord(req.supabase, user.id);
    req.userRole = role || 'user';
    req.userProfile = profile;
    req.userTable = table;

    next();
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Gagal memverifikasi otentikasi pengguna.',
      error: err.message,
    });
  }
}

/**
 * Middleware that populates req.user & req.userRole if token is provided,
 * but does not block if token is absent.
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        req.token = token;
        req.user = user;
        req.supabase = getAuthenticatedClient(token);

        const { role, profile, table } = await getUserRoleAndRecord(req.supabase, user.id);
        req.userRole = role || 'user';
        req.userProfile = profile;
        req.userTable = table;
      }
    }

    if (!req.supabase) {
      req.supabase = supabase;
      req.userRole = 'anon';
    }

    next();
  } catch (err) {
    req.supabase = supabase;
    req.userRole = 'anon';
    next();
  }
}

/**
 * Role-based authorization middleware.
 * Verifies that the authenticated user possesses one of the allowed roles.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Akses ditolak: pengguna belum terautentikasi.',
      });
    }

    const userRole = (req.userRole || 'user').toLowerCase();
    const allowed = roles.map((r) => String(r).toLowerCase());

    // Super Admin inherits full access to all admin and staff routes
    if (userRole === 'super_admin' || userRole === 'superadmin') {
      return next();
    }

    if (!allowed.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: `Akses ditolak: Anda tidak memiliki izin untuk tindakan ini (memerlukan salah satu role: [${allowed.join(', ')}], role Anda: "${userRole}").`,
      });
    }

    next();
  };
}

module.exports = {
  requireAuth,
  optionalAuth,
  requireRole,
};
