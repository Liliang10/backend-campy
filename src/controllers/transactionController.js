const crypto = require('crypto');
const { supabase } = require('../config/supabase');

/**
 * Format current date: DD/MM/YYYY
 */
function getFormattedDate() {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const y = d.getFullYear();
  return `${day}/${m}/${y}`;
}

/**
 * Format current time: HH:mm WIB
 */
function getFormattedTime() {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m} WIB`;
}

/**
 * Record a new payment transaction
 * Validates order ownership and automatically derives amount from orders.total (ignoring client amount)
 * POST /api/transactions
 * Body: { orderId, paymentMethod, status, recipient }
 */
async function createTransaction(req, res) {
  try {
    const {
      orderId,
      order_id,
      paymentMethod,
      payment_method,
      status = 'success',
      recipient,
    } = req.body;

    const ordId = orderId || order_id;
    if (!ordId) {
      return res.status(400).json({
        success: false,
        message: 'orderId wajib disertakan.',
      });
    }

    const client = req.supabase || supabase;
    const isStaff = ['admin', 'petugas'].includes(req.userRole);

    // Fetch order to validate ownership & true amount
    const { data: order, error: orderErr } = await client
      .from('orders')
      .select('*')
      .eq('id', ordId)
      .maybeSingle();

    if (orderErr || !order) {
      return res.status(404).json({
        success: false,
        message: `Pesanan dengan ID "${ordId}" tidak ditemukan.`,
      });
    }

    // Verify order ownership for regular users
    if (!isStaff && order.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak: pesanan ini bukan milik Anda.',
      });
    }

    // Force verified amount directly from order.total
    const verifiedAmount = order.total || order.subtotal || 0;
    const payStatus = String(status).toLowerCase();
    if (!['success', 'failed'].includes(payStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Status transaksi harus success atau failed.',
      });
    }

    const trxId = `TRX-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const payMethod = paymentMethod || payment_method || order.payment_method || 'BCA';
    const trxRecipient = recipient || 'Campy';

    const newTransaction = {
      id: trxId,
      user_id: order.user_id,
      order_id: ordId,
      amount: verifiedAmount,
      date: getFormattedDate(),
      time: getFormattedTime(),
      status: payStatus,
      payment_method: payMethod,
      recipient: trxRecipient,
    };

    const { data, error } = await client
      .from('transactions')
      .insert(newTransaction)
      .select()
      .maybeSingle();

    if (error) {
      console.error('Supabase createTransaction error:', error);
      return res.status(400).json({
        success: false,
        message: 'Gagal mencatat transaksi pembayaran.',
        error: error.message,
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Transaksi berhasil dicatat.',
      data: data || newTransaction,
    });
  } catch (err) {
    console.error('Create transaction exception:', err);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat memproses transaksi.',
      error: err.message,
    });
  }
}

/**
 * Get transactions history
 * Regular users only see their own transactions. Staff sees all.
 * GET /api/transactions
 */
async function getTransactions(req, res) {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    const client = req.supabase || supabase;
    const isStaff = ['admin', 'petugas'].includes(req.userRole);

    let query = client
      .from('transactions')
      .select('*')
      .order('created_at', { ascending: false })
      .range(parseInt(offset, 10), parseInt(offset, 10) + parseInt(limit, 10) - 1);

    if (!isStaff) {
      query = query.eq('user_id', req.user.id);
    }

    if (status) {
      query = query.eq('status', status.toLowerCase());
    }

    const { data, error } = await query;

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Gagal mengambil riwayat transaksi.',
        error: error.message,
      });
    }

    return res.status(200).json({
      success: true,
      count: data?.length || 0,
      data: data || [],
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil riwayat transaksi.',
      error: err.message,
    });
  }
}

/**
 * Get single transaction by ID
 * GET /api/transactions/:id
 */
async function getTransactionById(req, res) {
  try {
    const { id } = req.params;
    const client = req.supabase || supabase;
    const isStaff = ['admin', 'petugas'].includes(req.userRole);

    let query = client
      .from('transactions')
      .select('*')
      .eq('id', id);

    if (!isStaff) {
      query = query.eq('user_id', req.user.id);
    }

    const { data, error } = await query.maybeSingle();

    if (error || !data) {
      return res.status(404).json({
        success: false,
        message: 'Transaksi tidak ditemukan atau Anda tidak memiliki akses.',
      });
    }

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server.',
      error: err.message,
    });
  }
}

module.exports = {
  createTransaction,
  getTransactions,
  getTransactionById,
};
