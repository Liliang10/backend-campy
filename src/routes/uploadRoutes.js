const express = require('express');
const router = express.Router();
const { upload, uploadImage } = require('../controllers/uploadController');
const { requireAuth, requireRole } = require('../middlewares/auth');

// Protected upload route: only staff (admin & petugas) can upload product images
router.post(
  '/',
  requireAuth,
  requireRole('admin', 'petugas'),
  (req, res, next) => {
    upload.single('image')(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message || 'File upload error',
        });
      }
      next();
    });
  },
  uploadImage
);

module.exports = router;

