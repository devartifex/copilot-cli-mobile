import http from 'http';
import { app, sessionMiddleware } from './server.js';
import { setupWebSocket } from './ws/handler.js';
import { config } from './config.js';

const server = http.createServer(app);
setupWebSocket(server, sessionMiddleware);

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Error: Port ${config.port} is already in use.`);
    console.error(`  Stop the existing process or set a different PORT env var.\n`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});

server.listen(config.port, () => {
  console.log('');
  console.log('  Copilot CLI Mobile');
  console.log('  ──────────────────');
  console.log(`  Mode:  ${config.isDev ? 'Development' : 'Production'}`);
  console.log(`  URL:   ${config.baseUrl}`);
  console.log(`  Port:  ${config.port}`);
  console.log('');
});
