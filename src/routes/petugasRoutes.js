const express = require('express');
const router = express.Router();
const petugasController = require('../controllers/petugasController');
const { requireAuth, requireRole } = require('../middlewares/auth');

// All stock routes strictly require authentication and role 'petugas' or 'admin'
router.use(requireAuth);
router.use(requireRole('petugas', 'admin'));

router.get('/stock', petugasController.getStock);
router.post('/stock', petugasController.addStock);
router.put('/stock/:id', petugasController.updateStock);
router.delete('/stock/:id', petugasController.deleteStock);

module.exports = router;
