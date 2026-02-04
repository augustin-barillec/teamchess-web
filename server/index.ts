import http from "http";
import express from "express";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { Chess } from "chess.js";
import { setIO, setGameState } from "./state.js";
import { GameStatus } from "./types.js";
import { DEFAULT_TIME } from "./constants.js";
import { initEngineLoader, createEngine } from "./engine/stockfish.js";
import { setupConnectionHandler } from "./socket/connectionHandler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  console.log("Starting TeamChess server...");
  // Initialize engine loader (async import)
  await initEngineLoader();

  // Create Express app and HTTP server
  const app = express();
  const server = http.createServer(app);

  // Create Socket.io server
  const io = new Server(server, {
    cors: { origin: "*" },
    pingInterval: 5000,
    pingTimeout: 5000,
  });
  // Set global IO instance
  setIO(io);

  // Initialize game state
  const engine = createEngine();
  setGameState({
    whiteIds: new Set(),
    blackIds: new Set(),
    moveNumber: 1,
    side: "white",
    proposals: new Map(),
    whiteTime: DEFAULT_TIME,
    blackTime: DEFAULT_TIME,
    engine,
    chess: new Chess(),
    status: GameStatus.Lobby,
  });
  // Setup socket connection handler
  setupConnectionHandler();

  // Serve static files
  const publicPath = path.join(__dirname, "../client/dist");
  app.use(express.static(publicPath));
  app.get(/.*/, (req, res) => {
    res.sendFile(path.join(publicPath, "index.html"));
  });
  // Start server
  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
    console.log(`🚀 Server listening on port ${PORT}`);
  });
}

startServer();
