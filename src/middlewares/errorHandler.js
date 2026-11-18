/**
 * Global error handler middleware
 */
function errorHandler(err, req, res, next) {
  console.error('Unhandled server error:', err);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Terjadi kesalahan internal server.';

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
}

/**
 * 404 Route Not Found middleware
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    message: `Endpoint ${req.method} ${req.originalUrl} tidak ditemukan.`,
  });
}

module.exports = {
  errorHandler,
  notFoundHandler,
};

