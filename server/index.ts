import http from "http";
import express from "express";
import { Server, Socket } from "socket.io";
import { nanoid } from "nanoid";
import { Chess } from "chess.js";
import path from "path";
import { fileURLToPath } from "url";
import { Player, EndReason, GameStatus, Proposal } from "./shared_types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const engineLoaderPath = path.resolve(__dirname, "./load_engine.cjs");
const { default: loadEngine } = await import(engineLoaderPath);

type Engine = ReturnType<typeof loadEngine>;
const DISCONNECT_GRACE_MS = 20000;
const STOCKFISH_SEARCH_DEPTH = 15;

const stockfishPath = path.join(
  process.cwd(),
  "node_modules",
  "stockfish",
  "src",
  "stockfish-nnue-16.js"
);

const reasonMessages: Record<string, (winner: string | null) => string> = {
  [EndReason.Checkmate]: (winner) =>
    `☑️ Checkmate!\n${
      winner ? winner.charAt(0).toUpperCase() + winner.slice(1) : ""
    } wins!`,
  [EndReason.Stalemate]: () => `🤝 Game drawn by stalemate.`,
  [EndReason.Threefold]: () => `🤝 Game drawn by threefold repetition.`,
  [EndReason.Insufficient]: () => `🤝 Game drawn by insufficient material.`,
  [EndReason.DrawRule]: () => `🤝 Game drawn by rule (e.g. fifty-move).`,
  [EndReason.Resignation]: (winner) =>
    `🏳️ Resignation!\n${
      winner ? winner.charAt(0).toUpperCase() + winner.slice(1) : ""
    } wins!`,
  [EndReason.DrawAgreement]: () => `🤝 Draw agreed.`,
  [EndReason.Timeout]: (winner) =>
    `⏱️ Time!\n${
      winner ? winner.charAt(0).toUpperCase() + winner.slice(1) : ""
    } wins!`,
  [EndReason.Abandonment]: (winner) =>
    `🚫 Forfeit!\n${
      winner ? winner.charAt(0).toUpperCase() + winner.slice(1) : ""
    } wins as the opposing team is empty.`,
};

type Side = "white" | "black" | "spectator";
type PlayerSide = "white" | "black";

type Session = {
  pid: string;
  name: string;
  side: Side;
  reconnectTimer?: NodeJS.Timeout;
};

interface GameState {
  whiteIds: Set<string>;
  blackIds: Set<string>;
  moveNumber: number;
  side: PlayerSide;
  // UPDATED: Store name with the proposal
  proposals: Map<string, { lan: string; san: string; name: string }>;
  whiteTime: number;
  blackTime: number;
  timerInterval?: NodeJS.Timeout;
  engine: Engine;
  chess: Chess;
  status: GameStatus;
  endReason?: string;
  endWinner?: string | null;
  drawOffer?: "white" | "black";
}

const sessions = new Map<string, Session>();
let gameState: GameState;
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
  pingInterval: 5000,
  pingTimeout: 5000,
});

function getCleanPgn(chess: Chess): string {
  const fullPgn = chess.pgn();
  return fullPgn.replace(/^\[.*\]\n/gm, "").trim();
}

function broadcastPlayers() {
  const onlinePids = new Set<string>();
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.pid) {
      onlinePids.add(socket.data.pid);
    }
  }

  const spectators: Player[] = [];
  const whitePlayers: Player[] = [];
  const blackPlayers: Player[] = [];

  for (const sess of sessions.values()) {
    const p: Player = {
      id: sess.pid,
      name: sess.name,
      connected: onlinePids.has(sess.pid),
    };
    if (sess.side === "white") whitePlayers.push(p);
    else if (sess.side === "black") blackPlayers.push(p);
    else spectators.push(p);
  }
  io.emit("players", { spectators, whitePlayers, blackPlayers });
}

function sendSystemMessage(message: string) {
  io.emit("chat_message", {
    sender: "System",
    senderId: "system",
    message,
    system: true,
  });
}

function endGame(reason: string, winner: string | null = null) {
  if (gameState.status === GameStatus.Over) return;
  if (gameState.timerInterval) clearInterval(gameState.timerInterval);
  gameState.engine.quit();

  gameState.status = GameStatus.Over;
  gameState.endReason = reason;
  gameState.endWinner = winner;

  const message = reasonMessages[reason]
    ? reasonMessages[reason](winner)
    : `🎉 Game over! ${
        winner ? winner.charAt(0).toUpperCase() + winner.slice(1) : ""
      } wins!`;

  sendSystemMessage(message);
  broadcastPlayers();

  gameState.drawOffer = undefined;
  const pgn = getCleanPgn(gameState.chess);
  io.emit("game_over", { reason, winner, pgn });
  io.emit("draw_offer_update", { side: null });
}

function startClock() {
  if (gameState.status !== GameStatus.AwaitingProposals) return;
  if (gameState.timerInterval) clearInterval(gameState.timerInterval);

  io.emit("clock_update", {
    whiteTime: gameState.whiteTime,
    blackTime: gameState.blackTime,
  });

  gameState.timerInterval = setInterval(() => {
    if (gameState.side === "white") gameState.whiteTime--;
    else gameState.blackTime--;

    io.emit("clock_update", {
      whiteTime: gameState.whiteTime,
      blackTime: gameState.blackTime,
    });

    if (gameState.whiteTime <= 0 || gameState.blackTime <= 0) {
      const winner = gameState.side === "white" ? "black" : "white";
      endGame(EndReason.Timeout, winner);
    }
  }, 1000);
}

async function chooseBestMove(
  engine: Engine,
  fen: string,
  candidates: string[]
) {
  if (new Set(candidates).size === 1) {
    return candidates[0];
  }
  return new Promise<string>((resolve) => {
    engine.send(`position fen ${fen}`);
    const goCommand = `go depth ${STOCKFISH_SEARCH_DEPTH} searchmoves ${candidates.join(
      " "
    )}`;
    engine.send(goCommand, (output: string) => {
      if (output.startsWith("bestmove")) {
        resolve(output.split(" ")[1]);
      }
    });
  });
}

function tryFinalizeTurn() {
  if (gameState.status !== GameStatus.AwaitingProposals) return;

  // 1. Identify who is currently online (Socket connected)
  const onlinePids = new Set<string>();
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.pid) {
      onlinePids.add(socket.data.pid);
    }
  }

  const sideSet =
    gameState.side === "white" ? gameState.whiteIds : gameState.blackIds;

  // 2. Identify the "Active Team" (Players on this side who are currently online)
  const activeConnected = new Set(
    [...sideSet].filter((pid) => onlinePids.has(pid))
  );

  // 3. Count how many ONLINE players have voted
  const onlineProposalsCount = [...gameState.proposals.keys()].filter((pid) =>
    activeConnected.has(pid)
  ).length;

  // 4. Trigger Condition: Have all currently ONLINE players voted?
  // (We check activeConnected.size > 0 to ensure we don't trigger if the team is empty)
  if (
    activeConnected.size > 0 &&
    onlineProposalsCount === activeConnected.size
  ) {
    gameState.status = GameStatus.FinalizingTurn;
    io.emit("game_status_update", { status: gameState.status });

    if (gameState.timerInterval) {
      clearInterval(gameState.timerInterval);
      gameState.timerInterval = undefined;
    }

    // 5. ACTION: Use ALL proposals for Stockfish, including offline players.
    const allEntries = [...gameState.proposals.entries()];
    const candidatesStr = allEntries.map(([, { lan }]) => lan);

    // Prepare the Official List to send to clients
    const candidatesObjs: Proposal[] = allEntries.map(([id, val]) => ({
      id,
      name: val.name,
      moveNumber: gameState.moveNumber,
      side: gameState.side,
      lan: val.lan,
      san: val.san,
    }));

    const currentFen = gameState.chess.fen();

    chooseBestMove(gameState.engine, currentFen, candidatesStr).then(
      (selLan) => {
        try {
          const from = selLan.slice(0, 2);
          const to = selLan.slice(2, 4);
          const params: any = { from, to };
          if (selLan.length === 5) params.promotion = selLan[4];

          const move = gameState.chess.move(params);
          if (!move) {
            console.error(
              `CRITICAL: Illegal move. FEN: ${currentFen}, Move: ${selLan}`
            );
            return;
          }
          const fen = gameState.chess.fen();

          const currentTime =
            gameState.side === "white"
              ? gameState.whiteTime
              : gameState.blackTime;

          const increment = currentTime <= 60 ? 10 : 3;

          if (gameState.side === "white") gameState.whiteTime += increment;
          else gameState.blackTime += increment;

          io.emit("clock_update", {
            whiteTime: gameState.whiteTime,
            blackTime: gameState.blackTime,
          });

          // 6. CREDIT: Find the winner using the saved name
          const winnerEntry = allEntries.find(([, val]) => val.lan === selLan);
          const winnerId = winnerEntry ? winnerEntry[0] : "unknown";
          const winnerName = winnerEntry ? winnerEntry[1].name : "TeamChess";

          io.emit("move_selected", {
            id: winnerId,
            name: winnerName,
            moveNumber: gameState.moveNumber,
            side: gameState.side,
            lan: selLan,
            san: move.san,
            fen,
            candidates: candidatesObjs, // <--- Send the Official List
          });

          if (gameState.chess.isGameOver()) {
            let reason: string;
            let winner: "white" | "black" | null = null;
            if (gameState.chess.isCheckmate()) {
              reason = EndReason.Checkmate;
              winner = gameState.side;
            } else if (gameState.chess.isStalemate()) {
              reason = EndReason.Stalemate;
            } else if (gameState.chess.isThreefoldRepetition()) {
              reason = EndReason.Threefold;
            } else if (gameState.chess.isInsufficientMaterial()) {
              reason = EndReason.Insufficient;
            } else {
              reason = EndReason.DrawRule;
            }
            endGame(reason, winner);
          } else {
            gameState.proposals.clear();
            gameState.side = gameState.side === "white" ? "black" : "white";
            gameState.moveNumber++;
            gameState.status = GameStatus.AwaitingProposals;
            io.emit("turn_change", {
              moveNumber: gameState.moveNumber,
              side: gameState.side,
            });
            io.emit("game_status_update", { status: gameState.status });
            io.emit("position_update", { fen });
            startClock();
          }
        } catch (e) {
          console.error(
            `CRITICAL: Error on move. FEN: ${currentFen}, Move: ${selLan}`,
            e
          );
          gameState.status = GameStatus.AwaitingProposals;
        }
      }
    );
  }
}

function endIfOneSided() {
  if (
    gameState.status === GameStatus.Lobby ||
    gameState.status === GameStatus.Over
  )
    return;

  const whiteAlive = gameState.whiteIds.size > 0;
  const blackAlive = gameState.blackIds.size > 0;
  if (whiteAlive && blackAlive) return;

  const winner = whiteAlive ? "white" : blackAlive ? "black" : null;
  endGame(EndReason.Abandonment, winner);
}

function leave(this: Socket) {
  const socket = this;
  const pid = socket.data.pid as string | undefined;
  if (!pid) return;
  const sess = sessions.get(pid);
  if (!sess) return;

  const finalize = () => {
    // UPDATED: Only remove player from "Active" lists.
    // Do NOT delete their proposal.
    if (sess.side === "white") gameState.whiteIds.delete(pid);
    if (sess.side === "black") gameState.blackIds.delete(pid);

    sessions.delete(pid);

    endIfOneSided();
    tryFinalizeTurn();
    broadcastPlayers();
  };

  if (sess.reconnectTimer) clearTimeout(sess.reconnectTimer);
  sess.reconnectTimer = setTimeout(() => {
    finalize();
  }, DISCONNECT_GRACE_MS);

  broadcastPlayers();
  tryFinalizeTurn();
}

io.on("connection", (socket: Socket) => {
  const { pid: providedPid, name: providedName } =
    (socket.handshake.auth as { pid?: string; name?: string }) || {};

  const pid = providedPid && sessions.has(providedPid) ? providedPid : nanoid();
  let sess = sessions.get(pid);

  if (!sess) {
    sess = { pid, name: providedName || "Player", side: "spectator" };
    sessions.set(pid, sess);
  } else {
    if (sess.reconnectTimer) {
      clearTimeout(sess.reconnectTimer);
      sess.reconnectTimer = undefined;
    }
    if (providedName) sess.name = providedName;
  }

  socket.data.pid = pid;
  socket.data.name = sess.name;
  socket.data.side = sess.side;

  socket.emit("session", { id: pid, name: sess.name });
  socket.emit("game_status_update", { status: gameState.status });

  socket.emit("clock_update", {
    whiteTime: gameState.whiteTime,
    blackTime: gameState.blackTime,
  });

  if (gameState.status !== GameStatus.Lobby) {
    const currentProposals = Array.from(gameState.proposals.entries()).map(
      ([pid, proposal]) => ({
        id: pid,
        name: proposal.name, // Use the name from the proposal
        moveNumber: gameState.moveNumber,
        side: gameState.side,
        lan: proposal.lan,
        san: proposal.san,
      })
    );
    socket.emit("game_started", {
      moveNumber: gameState.moveNumber,
      side: gameState.side,
      proposals: currentProposals,
    });
    socket.emit("position_update", { fen: gameState.chess.fen() });
    socket.emit("clock_update", {
      whiteTime: gameState.whiteTime,
      blackTime: gameState.blackTime,
    });
    if (gameState.drawOffer) {
      socket.emit("draw_offer_update", { side: gameState.drawOffer });
    }
    if (gameState.status === GameStatus.Over) {
      socket.emit("game_over", {
        reason: gameState.endReason,
        winner: gameState.endWinner,
        pgn: getCleanPgn(gameState.chess),
      });
    }
  }

  broadcastPlayers();

  socket.on("set_name", (name: string) => {
    const newName = name.trim().slice(0, 30);
    if (newName) {
      const sess = sessions.get(pid);
      if (sess) {
        sess.name = newName;
        socket.data.name = newName;
        broadcastPlayers();
        socket.emit("session", { id: pid, name: sess.name });
      }
    }
  });

  socket.on("join_side", ({ side }, cb) => {
    const currentSess = sessions.get(pid);
    if (!currentSess) return;

    const prevSide = currentSess.side;
    currentSess.side = side;
    socket.data.side = side;

    if (gameState.status !== GameStatus.Lobby) {
      if (prevSide === "white") gameState.whiteIds.delete(pid);
      else if (prevSide === "black") gameState.blackIds.delete(pid);

      if (side === "white") gameState.whiteIds.add(pid);
      else if (side === "black") gameState.blackIds.add(pid);

      endIfOneSided();
    }
    broadcastPlayers();
    tryFinalizeTurn();
    cb?.({ success: true });
  });

  socket.on("reset_game", (cb) => {
    if (gameState.timerInterval) clearInterval(gameState.timerInterval);
    const engine = loadEngine(stockfishPath);
    engine.send("uci");

    gameState = {
      ...gameState,
      whiteIds: new Set(),
      blackIds: new Set(),
      moveNumber: 1,
      side: "white",
      proposals: new Map(),
      whiteTime: 600,
      blackTime: 600,
      timerInterval: undefined,
      engine,
      chess: new Chess(),
      status: GameStatus.Lobby,
      endReason: undefined,
      endWinner: undefined,
      drawOffer: undefined,
    };
    io.emit("game_reset");

    io.emit("clock_update", {
      whiteTime: gameState.whiteTime,
      blackTime: gameState.blackTime,
    });

    sendSystemMessage(`${socket.data.name} has reset the game.`);
    cb?.({ success: true });
  });

  socket.on("play_move", (lan: string, cb) => {
    if (gameState.status === GameStatus.Lobby) {
      if (socket.data.side !== "white") {
        return cb?.({ error: "Only the White team can start the game." });
      }

      const whites = new Set<string>();
      const blacks = new Set<string>();
      for (const s of sessions.values()) {
        if (s.side === "white") whites.add(s.pid);
        else if (s.side === "black") blacks.add(s.pid);
      }
      if (blacks.size === 0) {
        return cb?.({
          error: "Both teams must have at least one player to start.",
        });
      }

      gameState.status = GameStatus.AwaitingProposals;
      gameState.whiteIds = whites;
      gameState.blackIds = blacks;

      io.emit("game_started", {
        moveNumber: 1,
        side: "white",
        proposals: [],
      });
      io.emit("position_update", { fen: gameState.chess.fen() });
      startClock();
      sendSystemMessage(
        `${socket.data.name} has started the game by playing the first move.`
      );
    } else if (gameState.status !== GameStatus.AwaitingProposals) {
      return cb?.({ error: "Not accepting proposals right now." });
    }

    const active =
      gameState.side === "white" ? gameState.whiteIds : gameState.blackIds;

    if (!active.has(pid)) return cb?.({ error: "Not your turn." });
    if (gameState.proposals.has(pid)) return cb?.({ error: "Already moved." });

    if (gameState.drawOffer && socket.data.side !== gameState.drawOffer) {
      gameState.drawOffer = undefined;
      io.emit("draw_offer_update", { side: null });
      sendSystemMessage(
        `${socket.data.name} proposed a move, automatically rejecting the draw offer.`
      );
    }

    let move;
    try {
      const tempChess = new Chess(gameState.chess.fen());
      move = tempChess.move(lan);
    } catch (e) {
      return cb?.({ error: "Illegal move format." });
    }
    if (!move) return cb?.({ error: "Illegal move." });

    // UPDATED: Store the name here!
    gameState.proposals.set(pid, {
      lan,
      san: move.san,
      name: socket.data.name,
    });

    io.emit("move_submitted", {
      id: pid,
      name: socket.data.name,
      moveNumber: gameState.moveNumber,
      side: gameState.side,
      lan,
      san: move.san,
    });

    tryFinalizeTurn();
    cb?.({});
  });

  socket.on("chat_message", (message: string) => {
    if (!message.trim()) return;
    io.emit("chat_message", {
      sender: socket.data.name,
      senderId: pid,
      message: message.trim(),
    });
  });

  socket.on("resign", () => {
    if (
      gameState.status !== GameStatus.AwaitingProposals ||
      socket.data.side === "spectator"
    )
      return;
    const winner = socket.data.side === "white" ? "black" : "white";
    sendSystemMessage(
      `${socket.data.name} resigns on behalf of the ${socket.data.side} team.`
    );
    endGame(EndReason.Resignation, winner);
  });

  socket.on("offer_draw", () => {
    if (
      gameState.status !== GameStatus.AwaitingProposals ||
      socket.data.side === "spectator"
    )
      return;
    if (gameState.drawOffer) return;
    gameState.drawOffer = socket.data.side;
    io.emit("draw_offer_update", { side: socket.data.side });
    sendSystemMessage(
      `${socket.data.name} offers a draw on behalf of the ${socket.data.side} team.`
    );
  });

  socket.on("accept_draw", () => {
    if (
      gameState.status !== GameStatus.AwaitingProposals ||
      socket.data.side === "spectator"
    )
      return;
    if (!gameState.drawOffer || gameState.drawOffer === socket.data.side)
      return;
    sendSystemMessage(`${socket.data.name} accepts the draw offer.`);
    endGame(EndReason.DrawAgreement, null);
  });

  socket.on("reject_draw", () => {
    if (
      gameState.status !== GameStatus.AwaitingProposals ||
      socket.data.side === "spectator"
    )
      return;
    if (!gameState.drawOffer || gameState.drawOffer === socket.data.side)
      return;
    gameState.drawOffer = undefined;
    io.emit("draw_offer_update", { side: null });
    sendSystemMessage(`${socket.data.name} rejects the draw offer.`);
  });

  socket.on("disconnect", () => leave.call(socket));
});

function startServer() {
  console.log("Starting TeamChess server...");

  const engine = loadEngine(stockfishPath);
  engine.send("uci");

  gameState = {
    whiteIds: new Set(),
    blackIds: new Set(),
    moveNumber: 1,
    side: "white",
    proposals: new Map(),
    whiteTime: 600,
    blackTime: 600,
    engine,
    chess: new Chess(),
    status: GameStatus.Lobby,
  };

  const publicPath = path.join(__dirname, "..", "public");
  app.use(express.static(publicPath));
  app.get(/.*/, (req, res) => {
    res.sendFile(path.join(publicPath, "index.html"));
  });

  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
    console.log(`🚀 Server listening on port ${PORT}`);
  });
}

startServer();
