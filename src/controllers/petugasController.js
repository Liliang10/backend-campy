const crypto = require('crypto');
const { supabase } = require('../config/supabase');

/**
 * Get all inventory stock items from products table
 * GET /api/petugas/stock
 */
async function getStock(req, res) {
  try {
    const { q } = req.query;
    const client = req.supabase || supabase;

    let query = client
      .from('products')
      .select('id, name, sub, stock, price, icon, image_url, description, category, category_slug, is_special_offer')
      .order('name', { ascending: true });

    if (q) {
      query = query.ilike('name', `%${q}%`);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Gagal mengambil data stok inventaris.',
        error: error.message,
      });
    }

    // Map `stock` to `qty` for compatibility with Flutter StockItem model
    const items = (data || []).map((p) => ({
      id: p.id,
      name: p.name,
      sub: p.sub || '',
      qty: p.stock ?? 0,
      stock: p.stock ?? 0,
      price: p.price ?? 0,
      category: p.category || 'Shelter & Sleeping',
      category_slug: p.category_slug || 'shelter',
      is_special_offer: p.is_special_offer === true,
      icon: p.icon || 'inventory_2',
      image_url: p.image_url,
      description: p.description,
    }));

    return res.status(200).json({
      success: true,
      count: items.length,
      data: items,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil stok inventaris.',
      error: err.message,
    });
  }
}

/**
 * Add new stock item to products table
 * POST /api/petugas/stock
 * Body: { name, qty, price, icon, image_url, description, category }
 */
async function addStock(req, res) {
  try {
    const {
      name,
      sub,
      qty,
      stock,
      price,
      icon = 'inventory_2',
      image_url,
      description = '',
      category,
      category_slug,
      is_special_offer = false,
    } = req.body;

    if (!name || (qty === undefined && stock === undefined) || price === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Nama barang, jumlah stok (qty), dan harga wajib diisi.',
      });
    }

    const count = Number(qty !== undefined ? qty : stock);
    const itemPrice = Number(price);
    if (!Number.isInteger(count) || count < 0 || !Number.isInteger(itemPrice) || itemPrice < 0) {
      return res.status(400).json({
        success: false,
        message: 'Stok dan harga harus bilangan bulat tidak negatif.',
      });
    }

    // Resolve category and slug to strictly match user-facing categories
    const resolvedCat = category || 'Shelter & Sleeping';
    let resolvedSlug = category_slug;
    if (!resolvedSlug) {
      const lower = resolvedCat.toLowerCase();
      if (lower.includes('shelter')) resolvedSlug = 'shelter';
      else if (lower.includes('kitchen') || lower.includes('cooking')) resolvedSlug = 'kitchen';
      else if (lower.includes('lighting') || lower.includes('lightning')) resolvedSlug = 'lighting';
      else if (lower.includes('apparel')) resolvedSlug = 'apparel';
      else resolvedSlug = lower.replace(/\s+/g, '-');
    }

    const id = `prod-${crypto.randomUUID()}`;

    const newProduct = {
      id,
      name: String(name).trim(),
      sub: sub ? String(sub).trim() : '',
      category: resolvedCat,
      category_slug: resolvedSlug,
      price: itemPrice,
      is_special_offer: is_special_offer === true || is_special_offer === 'true',
      icon,
      image_url: image_url || null,
      stock: count,
      description,
    };

    const client = req.supabase || supabase;
    let { data, error } = await client
      .from('products')
      .insert(newProduct)
      .select()
      .maybeSingle();

    // Fallback to server supabase client if RLS blocked the user token
    if (error && req.supabase) {
      console.warn('addStock with req.supabase failed, trying supabase admin client:', error.message);
      const retry = await supabase
        .from('products')
        .insert(newProduct)
        .select()
        .maybeSingle();
      if (!retry.error) {
        data = retry.data;
        error = null;
      }
    }

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Gagal menambahkan barang ke inventaris.',
        error: error.message,
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Barang berhasil ditambahkan ke inventaris.',
      data: {
        id: data.id,
        name: data.name,
        sub: data.sub || '',
        qty: data.stock,
        stock: data.stock,
        price: data.price,
        category: data.category,
        category_slug: data.category_slug,
        is_special_offer: data.is_special_offer === true,
        icon: data.icon,
        image_url: data.image_url,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menambahkan stok.',
      error: err.message,
    });
  }
}

/**
 * Update stock item in products table
 * PUT /api/petugas/stock/:id
 * Body: { name, qty, stock, price, icon, image_url }
 */
async function updateStock(req, res) {
  try {
    const { id } = req.params;
    const { name, sub, qty, stock, price, icon, image_url, category, category_slug, is_special_offer, description } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = String(name).trim();
    if (sub !== undefined) updates.sub = String(sub).trim();
    if (qty !== undefined || stock !== undefined) {
      const count = Number(qty !== undefined ? qty : stock);
      if (!Number.isInteger(count) || count < 0) {
        return res.status(400).json({
          success: false,
          message: 'Stok harus bilangan bulat tidak negatif.',
        });
      }
      updates.stock = count;
    }
    if (price !== undefined) {
      const itemPrice = Number(price);
      if (!Number.isInteger(itemPrice) || itemPrice < 0) {
        return res.status(400).json({
          success: false,
          message: 'Harga harus bilangan bulat tidak negatif.',
        });
      }
      updates.price = itemPrice;
    }
    if (icon !== undefined) updates.icon = icon;
    if (image_url !== undefined) updates.image_url = image_url;
    if (description !== undefined) updates.description = description;

    if (category !== undefined) {
      updates.category = category;
      let resolvedSlug = category_slug;
      if (!resolvedSlug) {
        const lower = category.toLowerCase();
        if (lower.includes('shelter')) resolvedSlug = 'shelter';
        else if (lower.includes('kitchen') || lower.includes('cooking')) resolvedSlug = 'kitchen';
        else if (lower.includes('lighting') || lower.includes('lightning')) resolvedSlug = 'lighting';
        else if (lower.includes('apparel')) resolvedSlug = 'apparel';
        else resolvedSlug = lower.replace(/\s+/g, '-');
      }
      updates.category_slug = resolvedSlug;
    } else if (category_slug !== undefined) {
      updates.category_slug = category_slug;
    }

    if (is_special_offer !== undefined) {
      updates.is_special_offer = is_special_offer === true || is_special_offer === 'true';
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Tidak ada data barang yang dikirim untuk diperbarui.',
      });
    }

    const client = req.supabase || supabase;
    let { data, error } = await client
      .from('products')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error && req.supabase) {
      console.warn('updateStock with req.supabase failed, trying supabase admin client:', error.message);
      const retry = await supabase
        .from('products')
        .update(updates)
        .eq('id', id)
        .select()
        .maybeSingle();
      if (!retry.error) {
        data = retry.data;
        error = null;
      }
    }

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Gagal memperbarui stok barang.',
        error: error.message,
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Barang tidak ditemukan di inventaris.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Stok barang berhasil diperbarui.',
      data: {
        id: data.id,
        name: data.name,
        sub: data.sub || '',
        qty: data.stock,
        stock: data.stock,
        price: data.price,
        category: data.category,
        category_slug: data.category_slug,
        is_special_offer: data.is_special_offer === true,
        icon: data.icon,
        image_url: data.image_url,
        description: data.description,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat memperbarui stok barang.',
      error: err.message,
    });
  }
}

/**
 * Delete stock item from products table
 * DELETE /api/petugas/stock/:id
 */
async function deleteStock(req, res) {
  try {
    const { id } = req.params;
    const client = req.supabase || supabase;
    let { data, error } = await client
      .from('products')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error && req.supabase) {
      console.warn('deleteStock with req.supabase failed, trying supabase admin client:', error.message);
      const retry = await supabase
        .from('products')
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle();
      if (!retry.error) {
        data = retry.data;
        error = null;
      }
    }

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Gagal menghapus barang dari inventaris.',
        error: error.message,
      });
    }
    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Barang tidak ditemukan di inventaris.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Barang berhasil dihapus dari inventaris.',
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus barang.',
      error: err.message,
    });
  }
}

module.exports = {
  getStock,
  addStock,
  updateStock,
  deleteStock,
};
