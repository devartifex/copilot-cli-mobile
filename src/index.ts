import http from 'http';
import { app, sessionMiddleware } from './server';
import { setupWebSocket } from './ws/handler';
import { config } from './config';

const server = http.createServer(app);
setupWebSocket(server, sessionMiddleware);

server.listen(config.port, () => {
  console.log('');
  console.log('  🤖 Copilot CLI Web');
  console.log('  ──────────────────');
  console.log(`  Mode:  ${config.isDev ? 'Development' : 'Production'}`);
  console.log(`  URL:   ${config.baseUrl}`);
  console.log(`  Port:  ${config.port}`);
  console.log('');
});
