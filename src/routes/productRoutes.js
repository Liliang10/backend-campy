const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { requireAuth, requireRole, optionalAuth } = require('../middlewares/auth');

// Public catalog endpoints
router.get('/', optionalAuth, productController.getProducts);
router.get('/:id', optionalAuth, productController.getProductById);

// Staff-protected mutation endpoints
router.post('/', requireAuth, requireRole('admin', 'petugas'), productController.createProduct);
router.put('/:id', requireAuth, requireRole('admin', 'petugas'), productController.updateProduct);
router.delete('/:id', requireAuth, requireRole('admin', 'petugas'), productController.deleteProduct);

module.exports = router;
