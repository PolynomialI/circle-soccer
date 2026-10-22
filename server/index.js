import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { Lobby } from './lobby.js';

export function createGameServer() {
  const app = express();
  const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
  app.use(express.static(publicDir));
  app.get('/healthz', (req, res) => res.send('ok'));

  const httpServer = createServer(app);
  const io = new Server(httpServer, { pingInterval: 10000, pingTimeout: 8000 });
  const lobby = new Lobby(io);
  lobby.start();
  return { httpServer, io, lobby };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { httpServer } = createGameServer();
  const port = Number(process.env.PORT) || 3000;
  httpServer.listen(port, () => console.log(`Circle Soccer listening on http://localhost:${port}`));
}
