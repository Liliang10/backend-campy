const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { supabase } = require('../config/supabase');

// Local uploads directory
const uploadsDir = path.resolve(__dirname, '../../public/uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer with memory storage & 5MB size limit
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 Megabytes
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'application/octet-stream',
    ];
    const extension = path.extname(file.originalname || '').toLowerCase();
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', ''];

    if (allowedExtensions.includes(extension) || allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Format file tidak didukung. Hanya file JPG, PNG, atau WEBP yang diperbolehkan.'));
    }
  },
});

/**
 * Upload image to Supabase Storage bucket 'product-images'
 * with automatic fallback to local static storage
 * POST /api/upload
 */
async function uploadImage(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Tidak ada file gambar yang diunggah.',
      });
    }

    let ext = path.extname(req.file.originalname || '').toLowerCase();
    if (!ext || ext === '') {
      if (req.file.mimetype === 'image/png') ext = '.png';
      else if (req.file.mimetype === 'image/webp') ext = '.webp';
      else ext = '.jpg';
    }

    const filename = `product-${crypto.randomUUID()}${ext}`;
    const contentType = req.file.mimetype === 'application/octet-stream'
      ? (ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg')
      : req.file.mimetype;

    // 1. Always save a copy locally to public/uploads as guaranteed fallback
    const localFilePath = path.join(uploadsDir, filename);
    try {
      fs.writeFileSync(localFilePath, req.file.buffer);
    } catch (fsErr) {
      console.warn('Failed to save local image backup:', fsErr.message);
    }

    const localUrl = `${req.protocol}://${req.get('host')}/uploads/${filename}`;

    // 2. Try uploading to Supabase Storage bucket 'product-images'
    let publicUrl = null;
    const client = req.supabase || supabase;

    try {
      const { data, error } = await client.storage
        .from('product-images')
        .upload(filename, req.file.buffer, {
          contentType,
          upsert: true,
        });

      if (!error && data) {
        const { data: publicUrlData } = client.storage
          .from('product-images')
          .getPublicUrl(filename);
        if (publicUrlData?.publicUrl) {
          publicUrl = publicUrlData.publicUrl;
        }
      } else {
        // If user client failed with RLS, attempt with supabase default client
        const retry = await supabase.storage
          .from('product-images')
          .upload(filename, req.file.buffer, {
            contentType,
            upsert: true,
          });

        if (!retry.error) {
          const { data: retryUrlData } = supabase.storage
            .from('product-images')
            .getPublicUrl(filename);
          if (retryUrlData?.publicUrl) {
            publicUrl = retryUrlData.publicUrl;
          }
        } else {
          console.warn('Supabase storage upload failed, using local URL fallback:', retry.error.message);
        }
      }
    } catch (storageErr) {
      console.warn('Supabase storage exception, using local URL fallback:', storageErr.message);
    }

    // 3. Use public Supabase URL if available, otherwise local URL
    const finalUrl = publicUrl || localUrl;

    return res.status(200).json({
      success: true,
      message: 'Gambar berhasil diunggah.',
      data: {
        url: finalUrl,
        filename,
      },
    });
  } catch (err) {
    console.error('Upload handler exception:', err);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengunggah gambar.',
      error: err.message,
    });
  }
}

module.exports = {
  upload,
  uploadImage,
};
