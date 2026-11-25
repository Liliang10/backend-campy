const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const { storeImage } = require('./uploadController');

/**
 * Direct fallback for creating order when RPC function is not installed in Supabase
 */
async function createOrderDirect(req, res, {
  items,
  dMethod,
  pMethod,
  address,
  rentalDurationDays,
}) {
  try {
    const client = req.supabase || supabase;
    const userId = req.user.id;

    // 1. Fetch products from DB
    const productIds = items.map((i) => i.product_id);
    const { data: dbProducts, error: prodErr } = await client
      .from('products')
      .select('id, name, sub, price, stock')
      .in('id', productIds);

    if (prodErr || !dbProducts) {
      return res.status(400).json({
        success: false,
        message: 'Gagal memverifikasi produk di database.',
        error: prodErr?.message,
      });
    }

    const prodMap = new Map(dbProducts.map((p) => [p.id, p]));

    // 2. Validate stock and calculate subtotal
    let subtotal = 0;
    const verifiedItems = [];

    for (const item of items) {
      const p = prodMap.get(item.product_id);
      if (!p) {
        return res.status(400).json({
          success: false,
          message: `Produk dengan ID "${item.product_id}" tidak ditemukan.`,
        });
      }
      if (p.stock < item.qty) {
        return res.status(400).json({
          success: false,
          message: `Stok tidak mencukupi untuk "${p.name}" (tersedia: ${p.stock}, diminta: ${item.qty}).`,
        });
      }

      subtotal += p.price * item.qty;
      verifiedItems.push({
        product_id: p.id,
        product_name: p.name,
        product_sub: p.sub || '',
        qty: item.qty,
        unit_price: p.price,
      });
    }

    const deliveryFee = dMethod === 'delivery' ? 20000 : 0;
    const total = subtotal + deliveryFee;
    const orderId = `#ORD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    const now = new Date();
    const jakartaNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const dateFormatted = `${String(jakartaNow.getUTCDate()).padStart(2, '0')}/${String(jakartaNow.getUTCMonth() + 1).padStart(2, '0')}/${jakartaNow.getUTCFullYear()}`;
    const endDate = new Date(
      Date.UTC(
        jakartaNow.getUTCFullYear(),
        jakartaNow.getUTCMonth(),
        jakartaNow.getUTCDate() + rentalDurationDays,
      ),
    );
    const endDateFormatted = `${String(endDate.getUTCDate()).padStart(2, '0')}/${String(endDate.getUTCMonth() + 1).padStart(2, '0')}/${endDate.getUTCFullYear()}`;
    const dateRange = `${dateFormatted} – ${endDateFormatted}`;

    let resolvedAddress = address;
    if (dMethod === 'delivery' && !resolvedAddress) {
      try {
        const { data: prof } = await client.from('profiles').select('address').eq('id', userId).maybeSingle();
        if (prof?.address) resolvedAddress = prof.address;
      } catch (_) {}
    }

    const location = dMethod === 'delivery'
      ? (resolvedAddress || 'Alamat Pengiriman Pemesan')
      : 'Campy Store (Self Pick-Up)';

    const firstItem = verifiedItems[0];

    // 3. Insert order
    const orderRecord = {
      id: orderId,
      user_id: userId,
      product_name: firstItem.product_name,
      product_sub: firstItem.product_sub,
      qty: verifiedItems.length,
      unit_price: firstItem.unit_price,
      subtotal,
      delivery_method: dMethod,
      delivery_fee: deliveryFee,
      total,
      date: dateRange,
      status: 'active',
      location,
      payment_method: pMethod,
      rental_duration_days: rentalDurationDays,
      return_deadline: `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, '0')}-${String(endDate.getUTCDate()).padStart(2, '0')}`,
      created_at: now.toISOString(),
    };

    const { data: createdOrder, error: orderErr } = await client
      .from('orders')
      .insert(orderRecord)
      .select()
      .single();

    if (orderErr) {
      return res.status(400).json({
        success: false,
        message: 'Gagal mencatat pesanan di database.',
        error: orderErr.message,
      });
    }

    // 4. Insert order items & update product stocks
    const orderItemRecords = verifiedItems.map((vi) => ({
      order_id: orderId,
      product_id: vi.product_id,
      product_name: vi.product_name,
      product_sub: vi.product_sub,
      qty: vi.qty,
      unit_price: vi.unit_price,
    }));

    try {
      await client.from('order_items').insert(orderItemRecords);
    } catch (itemErr) {
      console.warn('Warning inserting order_items:', itemErr.message);
    }

    // Deduct stock for each product
    for (const item of verifiedItems) {
      const p = prodMap.get(item.product_id);
      const remainingStock = Math.max(0, p.stock - item.qty);
      await client
        .from('products')
        .update({ stock: remainingStock })
        .eq('id', item.product_id);
    }

    return res.status(201).json({
      success: true,
      message: 'Pesanan berhasil dibuat.',
      data: {
        ...createdOrder,
        items: verifiedItems,
      },
    });
  } catch (err) {
    console.error('createOrderDirect error:', err);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat memproses pesanan langsung.',
      error: err.message,
    });
  }
}

/**
 * Create a new order (calling RPC create_order for atomic stock & price verification)
 * POST /api/orders
 * Body: { items: [{ productId, qty }], deliveryMethod, paymentMethod, deliveryAddress }
 */
async function createOrder(req, res) {
  try {
    const {
      items,
      deliveryMethod = 'pickup',
      delivery_method,
      paymentMethod = 'BCA',
      payment_method,
      rentalDurationDays,
      rental_duration_days,
      deliveryAddress,
      delivery_address,
      location,
    } = req.body;

    const dMethod = String(deliveryMethod || delivery_method || 'pickup').toLowerCase();
    const pMethod = paymentMethod || payment_method || 'BCA';
    const address = deliveryAddress || delivery_address || location || null;
    const durationDays = Number.parseInt(
      rentalDurationDays ?? rental_duration_days ?? 1,
      10,
    );

    if (!['pickup', 'delivery'].includes(dMethod)) {
      return res.status(400).json({
        success: false,
        message: 'Metode pengiriman harus pickup atau delivery.',
      });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Pesanan harus memiliki minimal 1 item.',
      });
    }
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365) {
      return res.status(400).json({
        success: false,
        message: 'Durasi sewa harus antara 1 sampai 365 hari.',
      });
    }

    const quantities = new Map();
    for (const item of items) {
      const productId = item.productId || item.product_id;
      const qty = Number.parseInt(item.qty, 10);
      if (!productId || !Number.isInteger(qty) || qty <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Setiap item harus memiliki productId dan qty lebih dari 0.',
        });
      }
      quantities.set(productId, (quantities.get(productId) || 0) + qty);
    }

    const mappedItems = [...quantities].map(([product_id, qty]) => ({ product_id, qty }));
    const { data: rpcData, error: rpcError } = await req.supabase.rpc('create_order', {
      p_items: mappedItems,
      p_delivery_method: dMethod,
      p_payment_method: pMethod,
      p_delivery_address: address,
      p_rental_duration_days: durationDays,
    });

    if (rpcError) {
      const schemaMissing = rpcError.code === 'PGRST202' || rpcError.code === '42883' || rpcError.message?.includes('not find the function');
      if (schemaMissing) {
        console.warn('RPC create_order not found in Supabase. Using resilient direct creation fallback...');
        return await createOrderDirect(req, res, {
          items: mappedItems,
          dMethod,
          pMethod,
          address,
          rentalDurationDays: durationDays,
        });
      }

      return res.status(400).json({
        success: false,
        message: rpcError.message || 'Gagal membuat pesanan.',
        error: rpcError.message,
      });
    }

    if (!rpcData) {
      return res.status(500).json({
        success: false,
        message: 'Database tidak mengembalikan data pesanan.',
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Pesanan berhasil dibuat.',
      data: rpcData,
    });
  } catch (err) {
    console.error('Create order exception:', err);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat memproses pesanan.',
      error: err.message,
    });
  }
}

/**
 * Get orders list
 * Regular users only see their own orders. Staff sees all orders.
 * GET /api/orders
 * Query params: status, limit, offset
 */
async function getOrders(req, res) {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    const client = req.supabase || supabase;
    const isStaff = ['admin', 'petugas'].includes(req.userRole);

    let query = client
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

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
        message: 'Gagal mengambil riwayat pesanan.',
        error: error.message,
      });
    }

    // Attempt to load order_items for these orders if available
    const orderIds = (data || []).map((o) => o.id);
    const itemsByOrder = {};
    if (orderIds.length > 0) {
      try {
        const { data: itemRows } = await client
          .from('order_items')
          .select('*')
          .in('order_id', orderIds);

        if (itemRows) {
          for (const item of itemRows) {
            if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
            itemsByOrder[item.order_id].push(item);
          }
        }
      } catch (e) {
        console.warn('Could not query order_items directly:', e.message);
      }
    }

    const mappedOrders = (data || []).map((o) => {
      const orderItems = itemsByOrder[o.id] || o.order_items || [];
      return {
        id: o.id,
        productName: o.product_name,
        productSub: o.product_sub,
        qty: o.qty,
        unitPrice: o.unit_price,
        subtotal: o.subtotal,
        deliveryMethod: o.delivery_method,
        deliveryFee: o.delivery_fee,
        total: o.total,
        date: o.date,
        status: o.status,
        location: o.location,
        paymentMethod: o.payment_method,
        rentalDurationDays: o.rental_duration_days || 1,
        returnDeadline: o.return_deadline,
        returnPhotoUrl: o.return_photo_url,
        returnStatus: o.return_status || 'not_submitted',
        createdAt: o.created_at,
        items: orderItems.map((it) => ({
          id: it.id,
          productId: it.product_id,
          productName: it.product_name,
          productSub: it.product_sub,
          qty: it.qty,
          unitPrice: it.unit_price,
        })),
      };
    });

    return res.status(200).json({
      success: true,
      count: mappedOrders.length,
      data: mappedOrders,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil riwayat pesanan.',
      error: err.message,
    });
  }
}

/**
 * Get single order by ID
 * GET /api/orders/:id
 */
async function getOrderById(req, res) {
  try {
    const { id } = req.params;
    const client = req.supabase || supabase;
    const isStaff = ['admin', 'petugas'].includes(req.userRole);

    let query = client
      .from('orders')
      .select('*')
      .eq('id', id);

    if (!isStaff) {
      query = query.eq('user_id', req.user.id);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Gagal mengambil detail pesanan.',
        error: error.message,
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Pesanan tidak ditemukan.',
      });
    }

    let items = [];
    try {
      const { data: itemRows } = await client
        .from('order_items')
        .select('*')
        .eq('order_id', id);
      if (itemRows) items = itemRows;
    } catch (_) {}

    return res.status(200).json({
      success: true,
      data: {
        id: data.id,
        productName: data.product_name,
        productSub: data.product_sub,
        qty: data.qty,
        unitPrice: data.unit_price,
        subtotal: data.subtotal,
        deliveryMethod: data.delivery_method,
        deliveryFee: data.delivery_fee,
        total: data.total,
        date: data.date,
        status: data.status,
        location: data.location,
        paymentMethod: data.payment_method,
        rentalDurationDays: data.rental_duration_days || 1,
        returnDeadline: data.return_deadline,
        returnPhotoUrl: data.return_photo_url,
        returnStatus: data.return_status || 'not_submitted',
        createdAt: data.created_at,
        items: items.map((it) => ({
          id: it.id,
          productId: it.product_id,
          productName: it.product_name,
          productSub: it.product_sub,
          qty: it.qty,
          unitPrice: it.unit_price,
        })),
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server.',
      error: err.message,
    });
  }
}

async function uploadReturnPhoto(req, res) {
  try {
    const { id } = req.params;
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Pilih foto barang yang akan dikembalikan.',
      });
    }

    const client = req.supabase || supabase;
    const { data: order, error: orderError } = await client
      .from('orders')
      .select('id, user_id, status, return_status')
      .eq('id', id)
      .maybeSingle();

    if (orderError) {
      return res.status(400).json({
        success: false,
        message: 'Gagal memeriksa pesanan.',
        error: orderError.message,
      });
    }
    if (!order || order.user_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Pesanan tidak ditemukan atau bukan milik Anda.',
      });
    }
    if (order.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Pengembalian hanya dapat diajukan untuk pesanan aktif.',
      });
    }
    if (['pending_review', 'approved'].includes(order.return_status)) {
      return res.status(400).json({
        success: false,
        message: 'Foto pengembalian sudah diajukan atau telah dikonfirmasi.',
      });
    }

    const { url } = await storeImage(req.file, req, 'return');
    const { data, error } = await client.rpc('submit_order_return', {
      p_order_id: id,
      p_photo_url: url,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message || 'Gagal mengajukan pengembalian.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Foto pengembalian berhasil dikirim untuk dikonfirmasi petugas.',
      data,
    });
  } catch (err) {
    console.error('Upload return photo error:', err);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengirim foto pengembalian.',
      error: err.message,
    });
  }
}

async function reviewOrderReturn(req, res) {
  try {
    const { id } = req.params;
    const decision = String(req.body.decision || '').toLowerCase();
    if (!['admin', 'petugas', 'super_admin', 'superadmin'].includes(req.userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Hanya petugas yang dapat mengonfirmasi pengembalian.',
      });
    }
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: 'Keputusan harus approved atau rejected.',
      });
    }

    const client = req.supabase || supabase;
    const { data, error } = await client.rpc('review_order_return', {
      p_order_id: id,
      p_decision: decision,
    });
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message || 'Gagal memproses konfirmasi pengembalian.',
      });
    }

    return res.status(200).json({
      success: true,
      message: decision === 'approved'
        ? 'Pengembalian berhasil dikonfirmasi.'
        : 'Pengajuan pengembalian ditolak.',
      data,
    });
  } catch (err) {
    console.error('Review return error:', err);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengonfirmasi pengembalian.',
      error: err.message,
    });
  }
}

/**
 * Update order status
 * PATCH /api/orders/:id/status
 * Body: { status: 'completed' | 'cancelled' | 'active' }
 */
async function updateOrderStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const client = req.supabase || supabase;
    const isStaff = ['admin', 'petugas'].includes(req.userRole);

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status wajib ditentukan (active / completed / cancelled).',
      });
    }

    const targetStatus = status.toLowerCase();
    if (!['active', 'completed', 'cancelled'].includes(targetStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Nilai status hanya boleh "active", "completed", atau "cancelled".',
      });
    }

    // Non-staff users can only cancel their own order
    if (!isStaff && targetStatus !== 'cancelled') {
      return res.status(403).json({
        success: false,
        message: 'Hanya staff yang berhak mengubah status pesanan selain pembatalan.',
      });
    }

    let query = client
      .from('orders')
      .update({ status: targetStatus })
      .eq('id', id);

    if (!isStaff) {
      query = query.eq('user_id', req.user.id);
    }

    const { data, error } = await query.select().maybeSingle();

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Gagal memperbarui status pesanan.',
        error: error.message,
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Pesanan tidak ditemukan atau Anda tidak memiliki izin.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Status pesanan berhasil diperbarui.',
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
  createOrder,
  getOrders,
  getOrderById,
  updateOrderStatus,
  uploadReturnPhoto,
  reviewOrderReturn,
};
