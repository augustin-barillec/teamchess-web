import http from "http";
import express from "express";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import {
  setIO,
  setGameState,
  getGameState,
  createInitialGameState,
} from "./state.js";
import { createEngine } from "./engine/stockfish.js";
import { setupConnectionHandler } from "./socket/connectionHandler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  console.log("Starting TeamChess server...");
  const app = express();
  const server = http.createServer(app);

  // Both ends on a 5s ping, so a severed link is noticed within ~10s even when
  // nothing closes the socket outright.
  const io = new Server(server, {
    cors: { origin: "*" },
    pingInterval: 5000,
    pingTimeout: 5000,
  });
  setIO(io);

  const engine = createEngine();
  setGameState(createInitialGameState(engine));

  setupConnectionHandler();

  const publicPath = path.join(__dirname, "../client/dist");
  app.use(express.static(publicPath));
  app.get(/.*/, (req, res) => {
    res.sendFile(path.join(publicPath, "index.html"));
  });

  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
    console.log(`🚀 Server listening on port ${PORT}`);
  });

  const shutdown = () => {
    console.log("Shutting down...");
    getGameState().engine.quit();
    server.close(() => process.exit(0));
    // Force exit if close hangs (e.g. open WebSocket connections)
    setTimeout(() => process.exit(0), 1000);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

startServer();
