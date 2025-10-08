import http from 'http';
import { Server, Socket } from 'socket.io';
import { nanoid } from 'nanoid';
import { Chess } from 'chess.js';
import path from 'path';
import AgonesSDK from '@google-cloud/agones-sdk';
import {
  Player,
  EndReason,
  GameStatus,
  MAX_PLAYERS_PER_GAME,
  GameVisibility,
} from '@teamchess/shared';
// --- Agones SDK Initialization ---
const sdk = new AgonesSDK();

// --- Constants ---
const DISCONNECT_GRACE_MS = 20000;
const SHUTDOWN_GRACE_MS = 30000;
const STOCKFISH_SEARCH_DEPTH = 15;
const stockfishPath = path.join(
  __dirname,
  '..',
  'node_modules',
  'stockfish',
  'src',
  'stockfish-nnue-16.js',
);
// --- Types ---
type Side = 'white' | 'black' | 'spectator';
type PlayerSide = 'white' | 'black';
type Session = {
  pid: string;
  name: string;
  side: Side;
  reconnectTimer?: NodeJS.Timeout;
};

interface GameState {
  gameId: string;
  whiteIds: Set<string>;
  blackIds: Set<string>;
  moveNumber: number;
  side: PlayerSide;
  proposals: Map<string, { lan: string; san: string }>;
  whiteTime: number;
  blackTime: number;
  timerInterval?: NodeJS.Timeout;
  engine: ReturnType<typeof loadEngine>;
  chess: Chess;
  status: GameStatus;
  visibility: GameVisibility;
  endReason?: string;
  endWinner?: string | null;
  drawOffer?: 'white' | 'black';
  shutdownTimer?: NodeJS.Timeout;
}

// --- Server State ---
const sessions = new Map<string, Session>();
let gameState: GameState | null = null;
// --- Server Setup ---
const server = http.createServer();
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 5000,
  pingTimeout: 5000,
});
const loadEngine = require('../load_engine.cjs') as (enginePath: string) => {
  send(cmd: string, cb?: (data: string) => void, stream?: (data: string) => void): void;
  quit(): void;
};

// --- Core Game Logic ---
function countPlayersInGame(): number {
  return sessions.size;
}

function getCleanPgn(chess: Chess): string {
  const fullPgn = chess.pgn();
  return fullPgn.replace(/^\[.*\]\n/gm, '').trim();
}

function broadcastPlayers(gameId: string) {
  const room = io.sockets.adapter.rooms.get(gameId) || new Set<string>();
  const onlinePids = new Set(
    [...room]
      .map(sid => io.sockets.sockets.get(sid)?.data.pid as string | undefined)
      .filter((pid): pid is string => Boolean(pid)),
  );
  const spectators: Player[] = [];
  const whitePlayers: Player[] = [];
  const blackPlayers: Player[] = [];
  for (const sess of sessions.values()) {
    const p: Player = { id: sess.pid, name: sess.name, connected: onlinePids.has(sess.pid) };
    if (sess.side === 'white') whitePlayers.push(p);
    else if (sess.side === 'black') blackPlayers.push(p);
    else spectators.push(p);
  }
  io.in(gameId).emit('players', { spectators, whitePlayers, blackPlayers });
}

function sendSystemMessage(gameId: string, message: string) {
  io.to(gameId).emit('chat_message', {
    sender: 'System',
    senderId: 'system',
    message,
    system: true,
  });
}

function endGame(reason: string, winner: string | null = null) {
  if (!gameState || gameState.status === GameStatus.Over) return;
  if (gameState.timerInterval) clearInterval(gameState.timerInterval);
  gameState.engine.quit();
  gameState.status = GameStatus.Over;
  gameState.endReason = reason;
  gameState.endWinner = winner;
  gameState.drawOffer = undefined;
  const pgn = getCleanPgn(gameState.chess);
  io.in(gameState.gameId).emit('game_over', { reason, winner, pgn });
  io.in(gameState.gameId).emit('draw_offer_update', { side: null });
}

function startClock() {
  if (!gameState || gameState.status !== GameStatus.Active) return;
  if (gameState.timerInterval) clearInterval(gameState.timerInterval);
  io.in(gameState.gameId).emit('clock_update', {
    whiteTime: gameState.whiteTime,
    blackTime: gameState.blackTime,
  });
  gameState.timerInterval = setInterval(() => {
    if (!gameState) return;
    if (gameState.side === 'white') gameState.whiteTime--;
    else gameState.blackTime--;

    io.in(gameState.gameId).emit('clock_update', {
      whiteTime: gameState.whiteTime,
      blackTime: gameState.blackTime,
    });

    if (gameState.whiteTime <= 0 || gameState.blackTime <= 0) {
      const winner = gameState.side === 'white' ? 'black' : 'white';
      endGame(EndReason.Timeout, winner);
    }
  }, 1000);
}

async function chooseBestMove(
  engine: ReturnType<typeof loadEngine>,
  fen: string,
  candidates: string[],
) {
  if (new Set(candidates).size === 1) {
    return candidates[0];
  }
  return new Promise<string>(resolve => {
    engine.send(`position fen ${fen}`);
    engine.send(
      `go depth ${STOCKFISH_SEARCH_DEPTH} searchmoves ${candidates.join(' ')}`,
      (output: string) => {
        if (output.startsWith('bestmove')) {
          resolve(output.split(' ')[1]);
        }
      },
    );
  });
}

function tryFinalizeTurn() {
  if (!gameState || gameState.status !== GameStatus.Active) return;

  const room = io.sockets.adapter.rooms.get(gameState.gameId) || new Set<string>();
  const onlinePids = new Set(
    [...room]
      .map(id => io.sockets.sockets.get(id)?.data.pid as string | undefined)
      .filter((pid): pid is string => Boolean(pid)),
  );
  const sideSet = gameState.side === 'white' ? gameState.whiteIds : gameState.blackIds;
  const activeConnected = new Set([...sideSet].filter(pid => onlinePids.has(pid)));
  const entries = [...gameState.proposals.entries()].filter(([pid]) => activeConnected.has(pid));

  if (activeConnected.size > 0 && entries.length === activeConnected.size) {
    if (gameState.timerInterval) {
      clearInterval(gameState.timerInterval);
      gameState.timerInterval = undefined;
    }

    const candidates = entries.map(([, { lan }]) => lan);
    const currentFen = gameState.chess.fen();
    chooseBestMove(gameState.engine, currentFen, candidates).then(selLan => {
      if (!gameState) return;
      const from = selLan.slice(0, 2);
      const to = selLan.slice(2, 4);
      const params: any = { from, to };
      if (selLan.length === 5) params.promotion = selLan[4];

      const move = gameState.chess.move(params);
      if (!move) {
        console.error(
          `CRITICAL: An illegal move was selected. FEN: ${currentFen}, Move: ${selLan}`,
        );
        return;
      }
      const fen = gameState.chess.fen();

      if (gameState.side === 'white') gameState.whiteTime += 3;
      else gameState.blackTime += 3;

      io.in(gameState.gameId).emit('clock_update', {
        whiteTime: gameState.whiteTime,
        blackTime: gameState.blackTime,
      });

      const [selPid] = entries.find(([, { lan }]) => lan === selLan)!;
      const selName = sessions.get(selPid)?.name || 'Player';

      io.in(gameState.gameId).emit('move_selected', {
        id: selPid,
        name: selName,
        moveNumber: gameState.moveNumber,
        side: gameState.side,
        lan: selLan,
        san: move.san,
        fen,
      });
      if (gameState.chess.isGameOver()) {
        let reason: string;
        let winner: 'white' | 'black' | null = null;
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
        gameState.side = gameState.side === 'white' ? 'black' : 'white';
        gameState.moveNumber++;
        io.in(gameState.gameId).emit('turn_change', {
          moveNumber: gameState.moveNumber,
          side: gameState.side,
        });
        io.in(gameState.gameId).emit('position_update', { fen });
        startClock();
      }
    });
  }
}

function endIfOneSided() {
  if (!gameState || gameState.status !== GameStatus.Active) return;
  const whiteAlive = gameState.whiteIds.size > 0;
  const blackAlive = gameState.blackIds.size > 0;
  if (whiteAlive && blackAlive) return;
  const winner = whiteAlive ? 'white' : blackAlive ? 'black' : null;
  endGame(EndReason.Abandonment, winner);
}

// --- Agones Shutdown Logic ---
function checkAndShutdown() {
  if (!gameState) return;
  if (gameState.shutdownTimer) {
    return;
  }
  gameState.shutdownTimer = setTimeout(() => {
    if (countPlayersInGame() === 0) {
      console.log('Game is empty. Shutting down via Agones SDK.');
      sdk.shutdown();
    } else {
      if (gameState) gameState.shutdownTimer = undefined;
    }
  }, SHUTDOWN_GRACE_MS);
  console.log(`Game empty. Scheduling shutdown in ${SHUTDOWN_GRACE_MS / 1000} seconds.`);
}

function cancelShutdown() {
  if (gameState && gameState.shutdownTimer) {
    console.log('Player joined, cancelling scheduled shutdown.');
    clearTimeout(gameState.shutdownTimer);
    gameState.shutdownTimer = undefined;
  }
}

// --- Socket Event Handlers ---
function leave(this: Socket, explicit = false) {
  const socket = this;
  const pid = socket.data.pid as string | undefined;
  if (!pid) return;
  const sess = sessions.get(pid);
  if (!sess) return;
  const finalize = () => {
    if (gameState) {
      gameState.proposals.delete(pid);
      if (sess.side === 'white') gameState.whiteIds.delete(pid);
      if (sess.side === 'black') gameState.blackIds.delete(pid);
      io.in(gameState.gameId).emit('proposal_removed', {
        moveNumber: gameState.moveNumber,
        side: gameState.side,
        id: pid,
      });
      endIfOneSided();
      tryFinalizeTurn();
    }
    broadcastPlayers(gameState!.gameId);
    if (countPlayersInGame() === 0) {
      checkAndShutdown();
    }
  };

  if (explicit) {
    sessions.delete(pid);
    socket.leave(gameState!.gameId);
    finalize();
    return;
  }

  if (sess.reconnectTimer) clearTimeout(sess.reconnectTimer);
  sess.reconnectTimer = setTimeout(() => {
    sessions.delete(pid);
    finalize();
  }, DISCONNECT_GRACE_MS);

  broadcastPlayers(gameState!.gameId);
  if (gameState) tryFinalizeTurn();
}

io.on('connection', (socket: Socket) => {
  const { pid: providedPid, name: providedName } =
    (socket.handshake.auth as { pid?: string; name?: string }) || {};

  if (countPlayersInGame() >= MAX_PLAYERS_PER_GAME && !sessions.has(providedPid || '')) {
    socket.emit('error', { message: 'This game is full.' });
    socket.disconnect(true);
    return;
  }

  if (gameState!.visibility === GameVisibility.Closed && !sessions.has(providedPid || '')) {
    socket.emit('error', { message: 'This game is closed to new players.' });
    socket.disconnect(true);
    return;
  }

  const pid = providedPid && sessions.has(providedPid) ? providedPid : nanoid();
  let sess = sessions.get(pid);

  if (!sess) {
    sess = { pid, name: providedName || 'Guest', side: 'spectator' };
    sessions.set(pid, sess);
    cancelShutdown();
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

  socket.join(gameState!.gameId);
  socket.emit('session', { id: pid, name: sess.name });

  socket.emit('game_status_update', {
    status: gameState!.status,
    visibility: gameState!.visibility,
    // MODIFIED: Removed gameId from this payload
  });
  if (gameState!.status === GameStatus.Active || gameState!.status === GameStatus.Over) {
    socket.emit('game_started', {
      moveNumber: gameState!.moveNumber,
      side: gameState!.side,
      visibility: gameState!.visibility,
      // MODIFIED: Removed gameId from this payload
    });
    socket.emit('position_update', { fen: gameState!.chess.fen() });
    socket.emit('clock_update', {
      whiteTime: gameState!.whiteTime,
      blackTime: gameState!.blackTime,
    });
    if (gameState!.drawOffer) {
      socket.emit('draw_offer_update', { side: gameState!.drawOffer });
    }
    if (gameState!.status === GameStatus.Over) {
      socket.emit('game_over', {
        reason: gameState!.endReason,
        winner: gameState!.endWinner,
        pgn: getCleanPgn(gameState!.chess),
      });
    }
  }

  broadcastPlayers(gameState!.gameId);

  socket.on('join_side', ({ side }, cb) => {
    if (!gameState) return cb?.({ error: 'Game not initialized.' });
    const currentSess = sessions.get(pid);
    if (!currentSess) return;

    const prevSide = currentSess.side;
    currentSess.side = side;
    socket.data.side = side;

    if (gameState.status === GameStatus.Active) {
      if (prevSide === 'white') gameState.whiteIds.delete(pid);
      else if (prevSide === 'black') gameState.blackIds.delete(pid);

      if (side === 'white') gameState.whiteIds.add(pid);
      else if (side === 'black') gameState.blackIds.add(pid);

      if (side === 'spectator') gameState.proposals.delete(pid);
      endIfOneSided();
    }
    broadcastPlayers(gameState.gameId);
    cb?.({ success: true });
  });
  socket.on('start_game', cb => {
    if (!gameState || gameState.status !== GameStatus.Lobby) {
      return cb?.({ error: 'Game cannot be started.' });
    }
    const whites = new Set<string>();
    const blacks = new Set<string>();
    for (const s of sessions.values()) {
      if (s.side === 'white') whites.add(s.pid);
      else if (s.side === 'black') blacks.add(s.pid);
    }
    if (whites.size === 0 || blacks.size === 0) {
      return cb?.({ error: 'Both teams must have at least one player to start.' });
    }

    gameState.status = GameStatus.Active;
    gameState.whiteIds = whites;
    gameState.blackIds = blacks;

    io.in(gameState.gameId).emit('game_started', {
      moveNumber: 1,
      side: 'white',
      visibility: gameState.visibility,
      gameId: gameState.gameId,
    });
    io.in(gameState.gameId).emit('position_update', { fen: gameState.chess.fen() });
    startClock();
    sendSystemMessage(gameState.gameId, `${socket.data.name} has started the game.`);
    cb?.({ success: true });
  });

  socket.on('reset_game', cb => {
    if (!gameState) return cb?.({ error: 'Game not found.' });

    if (gameState.timerInterval) clearInterval(gameState.timerInterval);
    const engine = loadEngine(stockfishPath);
    engine.send('uci');

    gameState = {
      ...gameState,
      whiteIds: new Set(),
      blackIds: new Set(),
      moveNumber: 1,
      side: 'white',
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
    io.in(gameState.gameId).emit('game_reset');
    sendSystemMessage(gameState.gameId, `${socket.data.name} has reset the game.`);
    cb?.({ success: true });
  });
  socket.on('play_move', (lan: string, cb) => {
    if (!gameState || gameState.status !== GameStatus.Active)
      return cb?.({ error: 'Game not running.' });

    const active = gameState.side === 'white' ? gameState.whiteIds : gameState.blackIds;
    if (!active.has(pid)) return cb?.({ error: 'Not your turn.' });
    if (gameState.proposals.has(pid)) return cb?.({ error: 'Already moved.' });

    if (gameState.drawOffer) {
      gameState.drawOffer = undefined;
      io.in(gameState.gameId).emit('draw_offer_update', { side: null });
      sendSystemMessage(
        gameState.gameId,
        `${socket.data.name} proposed a move, automatically rejecting the draw offer.`,
      );
    }

    let move;
    try {
      const tempChess = new Chess(gameState.chess.fen());
      move = tempChess.move(lan);
    } catch (e) {
      return cb?.({ error: 'Illegal move format.' });
    }
    if (!move) return cb?.({ error: 'Illegal move.' });

    gameState.proposals.set(pid, { lan, san: move.san });
    io.in(gameState.gameId).emit('move_submitted', {
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

  socket.on('chat_message', (message: string) => {
    if (!gameState || !message.trim()) return;
    io.to(gameState.gameId).emit('chat_message', {
      sender: socket.data.name,
      senderId: pid,
      message: message.trim(),
    });
  });
  socket.on('resign', () => {
    if (!gameState || gameState.status !== GameStatus.Active || socket.data.side === 'spectator')
      return;
    const winner = socket.data.side === 'white' ? 'black' : 'white';
    sendSystemMessage(
      gameState.gameId,
      `${socket.data.name} resigns on behalf of the ${socket.data.side} team.`,
    );
    endGame(EndReason.Resignation, winner);
  });
  socket.on('offer_draw', () => {
    if (!gameState || gameState.status !== GameStatus.Active || socket.data.side === 'spectator')
      return;
    if (gameState.drawOffer) return;
    gameState.drawOffer = socket.data.side;
    io.in(gameState.gameId).emit('draw_offer_update', { side: socket.data.side });
    sendSystemMessage(gameState.gameId, `${socket.data.name} offers a draw.`);
  });
  socket.on('accept_draw', () => {
    if (!gameState || gameState.status !== GameStatus.Active || socket.data.side === 'spectator')
      return;
    if (!gameState.drawOffer || gameState.drawOffer === socket.data.side) return;
    sendSystemMessage(gameState.gameId, `${socket.data.name} accepts the draw offer.`);
    endGame(EndReason.DrawAgreement, null);
  });
  socket.on('reject_draw', () => {
    if (!gameState || gameState.status !== GameStatus.Active || socket.data.side === 'spectator')
      return;
    if (!gameState.drawOffer || gameState.drawOffer === socket.data.side) return;
    gameState.drawOffer = undefined;
    io.in(gameState.gameId).emit('draw_offer_update', { side: null });
    sendSystemMessage(gameState.gameId, `${socket.data.name} rejects the draw offer.`);
  });
  socket.on('set_game_visibility', ({ visibility }) => {
    if (!gameState) return;
    if (Object.values(GameVisibility).includes(visibility)) {
      gameState.visibility = visibility;
      io.in(gameState.gameId).emit('game_visibility_update', { visibility });
      sendSystemMessage(gameState.gameId, `${socket.data.name} set visibility to ${visibility}.`);
    }
  });
  socket.on('disconnect', () => leave.call(socket, false));
});

// --- Main Server Function ---
async function startServer() {
  try {
    console.log('Connecting to Agones SDK...');
    await sdk.connect();
    console.log('Successfully connected to Agones SDK.');

    const gameServer = await sdk.getGameServer();
    const podName = gameServer.objectMeta.name;
    const labels = Object.fromEntries(gameServer.objectMeta.labelsMap);
    const gameId = labels['teamchess.dev/game-id'] || podName;

    const engine = loadEngine(stockfishPath);
    engine.send('uci');
    gameState = {
      gameId,
      whiteIds: new Set(),
      blackIds: new Set(),
      moveNumber: 1,
      side: 'white',
      proposals: new Map(),
      whiteTime: 600,
      blackTime: 600,
      engine,
      chess: new Chess(),
      status: GameStatus.Lobby,
      visibility: GameVisibility.Private,
    };
    const PORT = process.env.PORT || 3001;
    server.listen(PORT, async () => {
      console.log(`Game server listening on port ${PORT}`);
      console.log(`Public Game ID: ${gameId}`);
      console.log(`Internal Pod Name: ${podName}`);

      await sdk.ready();
      console.log('Server is READY.');

      setInterval(() => {
        sdk.health(err => {
          if (err) {
            console.error('Agones health check failed:', err);
          }
        });
      }, 10000);
    });
  } catch (error) {
    console.error('Failed to connect to Agones SDK or start the server:', error);
    process.exit(1);
  }
}

startServer();
