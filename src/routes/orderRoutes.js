const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { upload } = require('../controllers/uploadController');
const { requireAuth } = require('../middlewares/auth');

// All order routes strictly require authentication
router.use(requireAuth);

router.post('/', orderController.createOrder);
router.get('/', orderController.getOrders);
router.post(
  '/:id/return-photo',
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
  orderController.uploadReturnPhoto,
);
router.patch('/:id/return-review', orderController.reviewOrderReturn);
router.get('/:id', orderController.getOrderById);
router.patch('/:id/status', orderController.updateOrderStatus);

module.exports = router;
