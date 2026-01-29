import http from "http";
import express from "express";
import { Server, Socket } from "socket.io";
import { nanoid } from "nanoid";
import { Chess } from "chess.js";
import path from "path";
import { fileURLToPath } from "url";
import {
  Player,
  EndReason,
  GameStatus,
  Proposal,
  VoteType,
} from "./shared_types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const engineLoaderPath = path.resolve(__dirname, "./load_engine.cjs");
const { default: loadEngine } = await import(engineLoaderPath);

type Engine = ReturnType<typeof loadEngine>;

const DISCONNECT_GRACE_MS = 20000;
const STOCKFISH_SEARCH_DEPTH = 15;
const TEAM_VOTE_DURATION_MS = 20000;

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

interface InternalVoteState {
  type: VoteType;
  initiatorId: string;
  yesVoters: Set<string>;
  eligibleVoters: Set<string>;
  required: number;
  timer: NodeJS.Timeout;
  endTime: number;
}

interface GameState {
  whiteIds: Set<string>;
  blackIds: Set<string>;
  moveNumber: number;
  side: PlayerSide;
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
  whiteVote?: InternalVoteState;
  blackVote?: InternalVoteState;
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

function sendTeamMessage(side: "white" | "black", message: string) {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.side === side) {
      socket.emit("chat_message", {
        sender: "Team System",
        senderId: "system",
        message,
        system: true,
      });
    }
  }
}

function getTeamVoteClientData(side: "white" | "black") {
  const vote = side === "white" ? gameState.whiteVote : gameState.blackVote;
  if (!vote) {
    return {
      isActive: false,
      type: null,
      initiatorName: "",
      yesVotes: [],
      requiredVotes: 0,
      endTime: 0,
    };
  }

  const yesNames = Array.from(vote.yesVoters).map(
    (pid) => sessions.get(pid)?.name || "Unknown"
  );

  return {
    isActive: true,
    type: vote.type,
    initiatorName: sessions.get(vote.initiatorId)?.name || "Unknown",
    yesVotes: yesNames,
    requiredVotes: vote.required,
    endTime: vote.endTime,
  };
}

function broadcastTeamVote(side: "white" | "black") {
  const data = getTeamVoteClientData(side);
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.side === side) {
      socket.emit("team_vote_update", data);
    }
  }
}

function clearTeamVote(side: "white" | "black") {
  const vote = side === "white" ? gameState.whiteVote : gameState.blackVote;
  if (vote) {
    clearTimeout(vote.timer);
    if (side === "white") gameState.whiteVote = undefined;
    else gameState.blackVote = undefined;
    broadcastTeamVote(side);
  }
}

function endGame(reason: string, winner: string | null = null) {
  if (gameState.status === GameStatus.Over) return;
  if (gameState.timerInterval) clearInterval(gameState.timerInterval);

  clearTeamVote("white");
  clearTeamVote("black");

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

  const onlinePids = new Set<string>();
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.pid) {
      onlinePids.add(socket.data.pid);
    }
  }

  const sideSet =
    gameState.side === "white" ? gameState.whiteIds : gameState.blackIds;

  const activeConnected = new Set(
    [...sideSet].filter((pid) => onlinePids.has(pid))
  );

  const onlineProposalsCount = [...gameState.proposals.keys()].filter((pid) =>
    activeConnected.has(pid)
  ).length;

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

    const allEntries = [...gameState.proposals.entries()];
    const candidatesStr = allEntries.map(([, { lan }]) => lan);
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

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

          const increment = currentTime <= 60 ? 10 : 0;

          if (gameState.side === "white") gameState.whiteTime += increment;
          else gameState.blackTime += increment;

          io.emit("clock_update", {
            whiteTime: gameState.whiteTime,
            blackTime: gameState.blackTime,
          });

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
            candidates: candidatesObjs,
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
          gameState.proposals.clear();
          io.emit("game_status_update", { status: gameState.status });
          sendSystemMessage(
            "⚠️ System Error: The move could not be processed. The turn has been reset. Please submit your moves again."
          );
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
  // eslint-disable-next-line @typescript-eslint/no-this-alias
  const socket = this;
  const pid = socket.data.pid as string | undefined;
  if (!pid) return;

  const sess = sessions.get(pid);
  if (!sess) return;

  const finalize = () => {
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

// Internal function to start a vote (can be triggered by socket or system)
function startTeamVoteLogic(
  side: "white" | "black",
  type: VoteType,
  initiatorId: string,
  initiatorName: string
) {
  // Validation
  if (
    type === "accept_draw" &&
    (!gameState.drawOffer || gameState.drawOffer === side)
  )
    return;
  if (type === "offer_draw" && gameState.drawOffer) return;

  const currentVote =
    side === "white" ? gameState.whiteVote : gameState.blackVote;
  if (currentVote) return;

  // Snapshot N (connected teammates)
  const onlinePids = new Set<string>();
  for (const s of io.sockets.sockets.values()) {
    if (s.data.pid) onlinePids.add(s.data.pid);
  }
  const teamIds = side === "white" ? gameState.whiteIds : gameState.blackIds;
  const connectedTeamIds = [...teamIds].filter((pid) => onlinePids.has(pid));
  const N = connectedTeamIds.length;

  // AUTO-EXECUTE if N<=1 AND it is a player-initiated action (Resign/Offer).
  const isSystemTriggered = initiatorId === "system";

  if (N <= 1 && !isSystemTriggered) {
    if (type === "resign") {
      const winner = side === "white" ? "black" : "white";
      sendSystemMessage(`${initiatorName} resigns.`);
      endGame(EndReason.Resignation, winner);
    } else if (type === "offer_draw") {
      gameState.drawOffer = side;
      io.emit("draw_offer_update", { side });
      sendSystemMessage(`${initiatorName} offers a draw.`);

      // Trigger vote for other side
      const otherSide = side === "white" ? "black" : "white";
      startTeamVoteLogic(otherSide, "accept_draw", "system", "System");
    } else if (type === "accept_draw") {
      sendSystemMessage(`${initiatorName} accepts the draw.`);
      endGame(EndReason.DrawAgreement, null);
    }
    return;
  }

  // START VOTE
  const endTime = Date.now() + TEAM_VOTE_DURATION_MS;
  // If system triggered (accept_draw), start with 0 votes.
  // If player triggered, start with 1 vote (themselves).
  const initialYes = isSystemTriggered
    ? new Set<string>()
    : new Set([initiatorId]);

  const voteState: InternalVoteState = {
    type,
    initiatorId,
    yesVoters: initialYes,
    eligibleVoters: new Set(connectedTeamIds), // Snapshot of voters
    required: N,
    endTime,
    timer: setTimeout(() => {
      sendTeamMessage(
        side,
        `❌ Vote to ${type.replace("_", " ")} failed: Time expired.`
      );
      if (side === "white") gameState.whiteVote = undefined;
      else gameState.blackVote = undefined;
      broadcastTeamVote(side);

      // If accept_draw fails by timeout, reject the offer
      if (type === "accept_draw") {
        gameState.drawOffer = undefined;
        io.emit("draw_offer_update", { side: null });
        sendSystemMessage("Draw offer rejected (timeout).");
      }
    }, TEAM_VOTE_DURATION_MS),
  };

  if (side === "white") gameState.whiteVote = voteState;
  else gameState.blackVote = voteState;

  if (isSystemTriggered) {
    sendTeamMessage(side, `🗳️ Draw offered! Vote to Accept Draw. (0/${N})`);
  } else {
    sendTeamMessage(
      side,
      `🗳️ ${initiatorName} started a vote to ${type.replace(
        "_",
        " "
      )}. (1/${N})`
    );
  }
  broadcastTeamVote(side);
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
        name: proposal.name,
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

  if (socket.data.side === "white" || socket.data.side === "black") {
    socket.emit("team_vote_update", getTeamVoteClientData(socket.data.side));
  }

  broadcastPlayers();
  tryFinalizeTurn();

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

    // UPDATE CLIENT VOTE UI
    if (side === "white" || side === "black") {
      socket.emit("team_vote_update", getTeamVoteClientData(side));
    } else {
      socket.emit("team_vote_update", {
        isActive: false,
        type: null,
        initiatorName: "",
        yesVotes: [],
        requiredVotes: 0,
        endTime: 0,
      });
    }

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
      whiteVote: undefined,
      blackVote: undefined,
    };

    io.emit("game_reset");
    io.emit("clock_update", {
      whiteTime: gameState.whiteTime,
      blackTime: gameState.blackTime,
    });
    broadcastTeamVote("white");
    broadcastTeamVote("black");

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

    let move;
    try {
      const tempChess = new Chess(gameState.chess.fen());
      move = tempChess.move(lan);
    } catch (_e) {
      return cb?.({ error: "Illegal move format." });
    }

    if (!move) return cb?.({ error: "Illegal move." });

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

  socket.on("start_team_vote", (type: VoteType) => {
    if (socket.data.side !== "white" && socket.data.side !== "black") return;
    if (gameState.status !== GameStatus.AwaitingProposals) return;

    startTeamVoteLogic(
      socket.data.side,
      type,
      socket.data.pid,
      socket.data.name
    );
  });

  socket.on("vote_team", (vote: "yes" | "no") => {
    const side = socket.data.side;
    if (side !== "white" && side !== "black") return;

    const currentVote =
      side === "white" ? gameState.whiteVote : gameState.blackVote;
    if (!currentVote) return;

    // CHECK ELIGIBILITY
    if (!currentVote.eligibleVoters.has(pid)) {
      socket.emit("error", { message: "You cannot vote (joined late)." });
      return;
    }

    if (vote === "no") {
      clearTeamVote(side);
      sendTeamMessage(
        side,
        `❌ Vote to ${currentVote.type.replace(
          "_",
          " "
        )} failed: ${socket.data.name} voted No.`
      );

      // Explicitly reject draw if it was an accept_draw vote
      if (currentVote.type === "accept_draw") {
        gameState.drawOffer = undefined;
        io.emit("draw_offer_update", { side: null });
        sendSystemMessage(`${socket.data.name} rejected the draw offer.`);
      }
    } else {
      if (!currentVote.yesVoters.has(pid)) {
        currentVote.yesVoters.add(pid);

        if (currentVote.yesVoters.size >= currentVote.required) {
          clearTeamVote(side);
          sendTeamMessage(
            side,
            `✅ Vote passed! Executing ${currentVote.type.replace("_", " ")}.`
          );

          if (currentVote.type === "resign") {
            const winner = side === "white" ? "black" : "white";
            sendSystemMessage(`${side} team resigns.`);
            endGame(EndReason.Resignation, winner);
          } else if (currentVote.type === "offer_draw") {
            gameState.drawOffer = side;
            io.emit("draw_offer_update", { side });
            sendSystemMessage(`${side} team offers a draw.`);

            // Trigger vote for other side
            const otherSide = side === "white" ? "black" : "white";
            startTeamVoteLogic(otherSide, "accept_draw", "system", "System");
          } else if (currentVote.type === "accept_draw") {
            sendSystemMessage(`${side} team accepts the draw.`);
            endGame(EndReason.DrawAgreement, null);
          }
        } else {
          broadcastTeamVote(side);
        }
      }
    }
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
