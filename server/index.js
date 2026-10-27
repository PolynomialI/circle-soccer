import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { Lobby } from './lobby.js';
import { PlayerHistory, createRedisStore } from './history.js';

export function createGameServer() {
  const app = express();
  const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
  app.use(express.static(publicDir));
  app.get('/healthz', (req, res) => res.send('ok'));

  const httpServer = createServer(app);
  const io = new Server(httpServer, { pingInterval: 10000, pingTimeout: 8000 });
  const history = new PlayerHistory();
  if (process.env.REDIS_URL) {
    // Persist player history (e.g. to a Render Key Value instance); keep running in memory if it fails.
    createRedisStore(process.env.REDIS_URL)
      .then(async (store) => {
        history.store = store;
        await history.load();
        console.log('Player history: persistent store connected');
      })
      .catch((err) => console.error('Player history: store unavailable, keeping it in memory only:', err.message));
  }
  const lobby = new Lobby(io, { history });
  lobby.start();
  return { httpServer, io, lobby };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { httpServer } = createGameServer();
  const port = Number(process.env.PORT) || 3000;
  httpServer.listen(port, () => console.log(`Circle Soccer listening on http://localhost:${port}`));
}
