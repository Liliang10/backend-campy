const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');
const { optionalAuth } = require('../middlewares/auth');

// POST /api/ai/chat (accessible to both logged in and guest users)
router.post('/chat', optionalAuth, aiController.chat);

module.exports = router;
