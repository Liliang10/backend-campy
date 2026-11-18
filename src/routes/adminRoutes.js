const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireAuth, requireRole } = require('../middlewares/auth');

// All admin routes strictly require authentication and role 'admin' or 'super_admin'
router.use(requireAuth);
router.use(requireRole('admin', 'super_admin', 'superadmin'));

// Admin CRUD
router.get('/', adminController.getAdmins);
router.post('/', adminController.createAdmin);
router.put('/:id', adminController.updateAdmin);
router.delete('/:id', adminController.deleteAdmin);

// Petugas management by Admin
router.get('/petugas', adminController.getPetugasList);
router.post('/petugas', adminController.createPetugas);
router.put('/petugas/:id', adminController.updatePetugas);
router.delete('/petugas/:id', adminController.deletePetugas);

module.exports = router;
