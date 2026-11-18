const crypto = require('crypto');
const { supabase } = require('../config/supabase');

/**
 * Get all products with optional filtering and search
 * GET /api/products
 * Query: category, category_slug, special_offers, is_special_offer, q, search, sort
 */
async function getProducts(req, res) {
  try {
    const { category, category_slug, special_offers, is_special_offer, q, search, sort } = req.query;
    const client = req.supabase || supabase;

    let query = client.from('products').select('*');

    const cat = category_slug || category;
    if (cat) {
      if (cat.toLowerCase() === 'shelter') {
        query = query.or('category_slug.eq.shelter,category.ilike.%Shelter%');
      } else if (cat.toLowerCase() === 'kitchen') {
        query = query.or('category_slug.eq.kitchen,category.ilike.%Kitchen%');
      } else if (cat.toLowerCase() === 'lighting') {
        query = query.or('category_slug.eq.lighting,category.ilike.%Lighting%');
      } else if (cat.toLowerCase() === 'apparel') {
        query = query.or('category_slug.eq.apparel,category.ilike.%Apparel%');
      } else {
        query = query.or(`category_slug.eq.${cat},category.ilike.%${cat}%`);
      }
    }

    const special = special_offers !== undefined ? special_offers : is_special_offer;
    if (special !== undefined) {
      const isSpec = String(special) === 'true' || special === '1';
      query = query.eq('is_special_offer', isSpec);
    }

    const searchTerm = q || search;
    if (searchTerm) {
      query = query.or(`name.ilike.%${searchTerm}%,sub.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);
    }

    if (sort === 'price_asc') {
      query = query.order('price', { ascending: true });
    } else if (sort === 'price_desc') {
      query = query.order('price', { ascending: false });
    } else {
      query = query.order('created_at', { ascending: true });
    }

    const { data, error } = await query;

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Gagal mengambil data produk.',
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
      message: 'Terjadi kesalahan saat mengambil produk.',
      error: err.message,
    });
  }
}

/**
 * Get single product by ID
 * GET /api/products/:id
 */
async function getProductById(req, res) {
  try {
    const { id } = req.params;
    const client = req.supabase || supabase;

    const { data, error } = await client
      .from('products')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) {
      return res.status(404).json({
        success: false,
        message: 'Produk tidak ditemukan.',
      });
    }

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil produk.',
      error: err.message,
    });
  }
}

/**
 * Create a new product (Staff: Admin & Petugas)
 * POST /api/products
 */
async function createProduct(req, res) {
  try {
    const {
      name,
      sub,
      category,
      category_slug,
      price,
      is_special_offer = false,
      icon = 'inventory_2',
      asset = null,
      image_url = null,
      stock = 0,
      description = '',
    } = req.body;

    const parsedPrice = Number(price);
    const parsedStock = Number(stock);
    if (!name || !Number.isInteger(parsedPrice) || parsedPrice < 0 ||
        !Number.isInteger(parsedStock) || parsedStock < 0) {
      return res.status(400).json({
        success: false,
        message: 'Nama wajib diisi, harga harus bilangan bulat tidak negatif, dan stok harus bilangan bulat tidak negatif.',
      });
    }

    const id = `prod-${crypto.randomUUID()}`;
    const newProduct = {
      id,
      name: String(name).trim(),
      sub: sub ? String(sub).trim() : '',
      category: category ? String(category).trim() : 'General',
      category_slug: category_slug || (category ? String(category).trim().toLowerCase().replace(/\s+/g, '-') : 'general'),
      price: parsedPrice,
      is_special_offer: is_special_offer === true || is_special_offer === 'true',
      icon: icon || 'inventory_2',
      asset: asset || null,
      image_url: image_url || null,
      stock: parsedStock,
      description: description || '',
    };

    const client = req.supabase || supabase;
    let { data, error } = await client
      .from('products')
      .insert(newProduct)
      .select()
      .maybeSingle();

    if (error && req.supabase) {
      console.warn('createProduct with req.supabase failed, trying supabase admin client:', error.message);
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
        message: 'Gagal menambahkan produk.',
        error: error.message,
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Produk berhasil ditambahkan.',
      data: data || newProduct,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menambahkan produk.',
      error: err.message,
    });
  }
}

/**
 * Update product (Staff: Admin & Petugas)
 * PUT /api/products/:id
 */
async function updateProduct(req, res) {
  try {
    const { id } = req.params;

    // Strict whitelist fields
    const allowedFields = [
      'name',
      'sub',
      'category',
      'category_slug',
      'price',
      'is_special_offer',
      'icon',
      'asset',
      'image_url',
      'stock',
      'description',
    ];

    const updates = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        if (key === 'price' || key === 'stock') {
          const value = Number(req.body[key]);
          if (!Number.isInteger(value) || value < 0) {
            return res.status(400).json({
              success: false,
              message: `${key === 'price' ? 'Harga' : 'Stok'} harus bilangan bulat tidak negatif.`,
            });
          }
          updates[key] = value;
        } else if (key === 'is_special_offer') {
          if (typeof req.body[key] !== 'boolean') {
            return res.status(400).json({
              success: false,
              message: 'is_special_offer harus bernilai true atau false.',
            });
          }
          updates[key] = req.body[key];
        } else {
          updates[key] = req.body[key];
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Tidak ada data valid yang dikirim untuk diperbarui.',
      });
    }

    const client = req.supabase || supabase;
    const { data, error } = await client
      .from('products')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Gagal memperbarui produk.',
        error: error.message,
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Produk tidak ditemukan.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Produk berhasil diperbarui.',
      data,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat memperbarui produk.',
      error: err.message,
    });
  }
}

/**
 * Delete a product (Staff: Admin & Petugas)
 * DELETE /api/products/:id
 */
async function deleteProduct(req, res) {
  try {
    const { id } = req.params;
    const client = req.supabase || supabase;

    const { data, error } = await client
      .from('products')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Gagal menghapus produk.',
        error: error.message,
      });
    }
    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Produk tidak ditemukan.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Produk berhasil dihapus.',
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus produk.',
      error: err.message,
    });
  }
}

module.exports = {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
};
