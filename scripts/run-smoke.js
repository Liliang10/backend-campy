process.env.NODE_ENV = 'test';

const path = require('path');
const app = require('../src/server');
const { spawn } = require('child_process');

const server = app.listen(0, '127.0.0.1', () => {
  const address = server.address();
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log('=================================================');
  console.log(`🏕️  Campy Express Backend (Test Mode) on ${baseUrl}`);
  console.log('=================================================\n');

  const smokePath = path.join(__dirname, 'smoke-test.js');
  const env = { ...process.env, API_URL: baseUrl };

  const testProcess = spawn('node', [smokePath], {
    cwd: path.join(__dirname, '..'),
    env,
    stdio: 'inherit',
  });

  testProcess.on('close', (code) => {
    console.log(`\nTests finished with exit code ${code}. Stopping test server...`);
    server.close(() => {
      process.exit(code);
    });
  });
});

server.on('error', (err) => {
  console.error('Failed to start test server:', err);
  process.exit(1);
});
