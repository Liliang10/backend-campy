const { supabase } = require('../config/supabase');

/**
 * Calculate checkout totals derived strictly from product prices in database
 * POST /api/checkout/calculate
 * Body: { deliveryMethod: 'pickup' | 'delivery', items: [{ productId, qty }] }
 */
async function calculateCheckout(req, res) {
  try {
    const { deliveryMethod = 'pickup', delivery_method, items = [] } = req.body;
    const client = req.supabase || supabase;

    const dMethod = String(deliveryMethod || delivery_method || 'pickup').toLowerCase();
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

    const isDelivery = dMethod === 'delivery';
    const deliveryFee = isDelivery ? 20000 : 0;

    let subtotal = 0;
    let itemsCount = 0;
    const verifiedItems = [];

    for (const item of items) {
      const productId = item.productId || item.product_id;
      const qty = Number.parseInt(item.qty, 10);
      if (!productId || !Number.isInteger(qty) || qty <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Setiap item harus memiliki productId dan qty lebih dari 0.',
        });
      }

      const { data: product, error } = await client
        .from('products')
        .select('id, name, price, stock')
        .eq('id', productId)
        .maybeSingle();

      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Gagal memverifikasi harga produk.',
          error: error.message,
        });
      }
      if (!product) {
        return res.status(400).json({
          success: false,
          message: `Produk dengan ID "${productId}" tidak ditemukan.`,
        });
      }

      const itemSubtotal = product.price * qty;
      subtotal += itemSubtotal;
      itemsCount += qty;
      verifiedItems.push({
        productId: product.id,
        name: product.name,
        price: product.price,
        qty,
        subtotal: itemSubtotal,
        availableStock: product.stock,
      });
    }

    const total = subtotal + deliveryFee;

    return res.status(200).json({
      success: true,
      data: {
        deliveryMethod: isDelivery ? 'delivery' : 'pickup',
        deliveryFee,
        subtotal,
        total,
        itemsCount,
        items: verifiedItems,
        formatted: {
          subtotal: `Rp ${subtotal.toLocaleString('id-ID')}`,
          deliveryFee: `Rp ${deliveryFee.toLocaleString('id-ID')}`,
          total: `Rp ${total.toLocaleString('id-ID')}`,
        },
      },
    });
  } catch (err) {
    console.error('Calculate checkout error:', err);
    return res.status(500).json({
      success: false,
      message: 'Gagal menghitung kalkulasi checkout.',
      error: err.message,
    });
  }
}

module.exports = {
  calculateCheckout,
};
