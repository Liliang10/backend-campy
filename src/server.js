const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const checkoutRoutes = require('./routes/checkoutRoutes');
const orderRoutes = require('./routes/orderRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const wishlistRoutes = require('./routes/wishlistRoutes');
const adminRoutes = require('./routes/adminRoutes');
const petugasRoutes = require('./routes/petugasRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const aiRoutes = require('./routes/aiRoutes');
const { errorHandler, notFoundHandler } = require('./middlewares/errorHandler');

const app = express();
const defaultPort = parseInt(process.env.PORT, 10) || 5000;
const corsOrigin = process.env.CORS_ORIGIN || '*';

// Middlewares
app.use(cors({
  origin: corsOrigin === '*' ? '*' : corsOrigin.split(','),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// Health Check Endpoint (used by Flutter ApiService.isBackendConnected)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime: `${Math.floor(process.uptime())}s`,
    timestamp: new Date().toISOString(),
    service: 'Campy Express Backend',
  });
});

// Root API Welcome & Overview
app.get('/', (req, res) => {
  res.status(200).json({
    name: 'Campy Backend API',
    version: '1.0.0',
    description: 'REST API untuk aplikasi rental dan perlengkapan camping Campy berbasis Express & Supabase',
    endpoints: {
      health: 'GET /health',
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        staffLogin: 'POST /api/auth/staff-login',
        refresh: 'POST /api/auth/refresh',
        profile: 'GET /api/auth/profile, PUT /api/auth/profile',
      },
      products: {
        list: 'GET /api/products',
        detail: 'GET /api/products/:id',
        create: 'POST /api/products (Staff only)',
        update: 'PUT /api/products/:id (Staff only)',
        delete: 'DELETE /api/products/:id (Staff only)',
      },
      checkout: {
        calculate: 'POST /api/checkout/calculate',
      },
      orders: {
        create: 'POST /api/orders',
        list: 'GET /api/orders',
        detail: 'GET /api/orders/:id',
        submitReturnPhoto: 'POST /api/orders/:id/return-photo',
        reviewReturn: 'PATCH /api/orders/:id/return-review',
        updateStatus: 'PATCH /api/orders/:id/status',
      },
      transactions: {
        create: 'POST /api/transactions',
        list: 'GET /api/transactions',
        detail: 'GET /api/transactions/:id',
      },
      wishlist: {
        list: 'GET /api/wishlist',
        add: 'POST /api/wishlist',
        remove: 'DELETE /api/wishlist/:productId',
      },
      admins: {
        list: 'GET /api/admins (Admin only)',
        create: 'POST /api/admins (Admin only)',
        update: 'PUT /api/admins/:id (Admin only)',
        delete: 'DELETE /api/admins/:id (Admin only)',
        petugasList: 'GET /api/admins/petugas (Admin only)',
        createPetugas: 'POST /api/admins/petugas (Admin only)',
        updatePetugas: 'PUT /api/admins/petugas/:id (Admin only)',
        deletePetugas: 'DELETE /api/admins/petugas/:id (Admin only)',
      },
      petugas: {
        stockList: 'GET /api/petugas/stock (Petugas & Admin)',
        addStock: 'POST /api/petugas/stock (Petugas & Admin)',
        updateStock: 'PUT /api/petugas/stock/:id (Petugas & Admin)',
        deleteStock: 'DELETE /api/petugas/stock/:id (Petugas & Admin)',
      },
      upload: {
        uploadImage: 'POST /api/upload (Petugas & Admin, multipart/form-data field: image)',
      },
    },
  });
});

// Register API Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/admins', adminRoutes);
app.use('/api/petugas', petugasRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/ai', aiRoutes);

// 404 & Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

// Start Server with resilient port fallback
function startServer(portToTry) {
  const server = app.listen(portToTry, '0.0.0.0', () => {
    console.log(`=================================================`);
    console.log(`🏕️  Campy Express Backend running on port ${portToTry}`);
    console.log(`📡 Local: http://localhost:${portToTry}`);
    console.log(`🌐 Network: http://0.0.0.0:${portToTry}`);
    console.log(`🩺 Health check: http://localhost:${portToTry}/health`);
    console.log(`=================================================`);
  });

  server.on('error', (err) => {
    if ((err.code === 'EACCES' || err.code === 'EADDRINUSE') && portToTry < defaultPort + 10) {
      console.warn(`⚠️  Port ${portToTry} is not accessible (${err.code}). Trying port ${portToTry + 1}...`);
      startServer(portToTry + 1);
    } else {
      console.error('Server failed to start:', err);
    }
  });

  return server;
}

if (process.env.NODE_ENV !== 'test') {
  startServer(defaultPort);
}

module.exports = app;
