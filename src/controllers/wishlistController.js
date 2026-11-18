const { supabase } = require('../config/supabase');

/**
 * Get wishlist items for current user (including complete product data)
 * GET /api/wishlist
 */
async function getWishlist(req, res) {
  try {
    const client = req.supabase || supabase;
    const userId = req.user.id;

    // Try joining with products table
    const { data, error } = await client
      .from('wishlists')
      .select('id, user_id, product_id, created_at, products(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (!error && data) {
      // Return list of products with their wishlist info
      const mapped = data.map((item) => ({
        id: item.id,
        wishlist_id: item.id,
        product_id: item.product_id,
        created_at: item.created_at,
        product: item.products,
        // Also spread product fields at top level for easy Flutter parsing
        ...(item.products || {}),
      }));

      return res.status(200).json({
        success: true,
        count: mapped.length,
        data: mapped,
      });
    }

    // Fallback: query wishlists then query products by IDs
    const { data: rawWishlists, error: rawErr } = await client
      .from('wishlists')
      .select('*')
      .eq('user_id', userId);

    if (rawErr) {
      return res.status(400).json({
        success: false,
        message: 'Gagal mengambil data wishlist.',
        error: rawErr.message,
      });
    }

    const prodIds = (rawWishlists || []).map((w) => w.product_id).filter(Boolean);
    let productsMap = {};
    if (prodIds.length > 0) {
      const { data: prods } = await client
        .from('products')
        .select('*')
        .in('id', prodIds);
      if (prods) {
        productsMap = Object.fromEntries(prods.map((p) => [p.id, p]));
      }
    }

    const result = (rawWishlists || []).map((w) => ({
      id: w.id,
      wishlist_id: w.id,
      product_id: w.product_id,
      created_at: w.created_at,
      product: productsMap[w.product_id] || null,
      ...(productsMap[w.product_id] || {}),
    }));

    return res.status(200).json({
      success: true,
      count: result.length,
      data: result,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil wishlist.',
      error: err.message,
    });
  }
}

/**
 * Add product to wishlist (idempotent, ignores duplicate)
 * POST /api/wishlist
 * Body: { productId }
 */
async function addToWishlist(req, res) {
  try {
    const { productId, product_id } = req.body;
    const prodId = productId || product_id;

    if (!prodId) {
      return res.status(400).json({
        success: false,
        message: 'productId wajib disertakan.',
      });
    }

    const client = req.supabase || supabase;
    const userId = req.user.id;

    // Check if already in wishlist
    const { data: existing } = await client
      .from('wishlists')
      .select('*')
      .eq('user_id', userId)
      .eq('product_id', prodId)
      .maybeSingle();

    if (existing) {
      return res.status(200).json({
        success: true,
        message: 'Produk sudah ada di wishlist.',
        data: existing,
      });
    }

    // Insert new wishlist item
    const { data, error } = await client
      .from('wishlists')
      .insert({
        user_id: userId,
        product_id: prodId,
      })
      .select()
      .maybeSingle();

    if (error) {
      // Check if duplicate violation
      if (error.code === '23505') {
        return res.status(200).json({
          success: true,
          message: 'Produk sudah ada di wishlist.',
        });
      }

      return res.status(400).json({
        success: false,
        message: 'Gagal menambahkan ke wishlist.',
        error: error.message,
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Produk berhasil ditambahkan ke wishlist.',
      data,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menambahkan wishlist.',
      error: err.message,
    });
  }
}

/**
 * Remove product from wishlist
 * DELETE /api/wishlist/:productId
 */
async function removeFromWishlist(req, res) {
  try {
    const { productId } = req.params;
    const client = req.supabase || supabase;
    const userId = req.user.id;

    const { error } = await client
      .from('wishlists')
      .delete()
      .eq('user_id', userId)
      .eq('product_id', productId);

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Gagal menghapus dari wishlist.',
        error: error.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Produk berhasil dihapus dari wishlist.',
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus wishlist.',
      error: err.message,
    });
  }
}

module.exports = {
  getWishlist,
  addToWishlist,
  removeFromWishlist,
};
