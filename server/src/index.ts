import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import { nanoid } from 'nanoid';
import { Chess } from 'chess.js';
import path from 'path';
import { Player, EndReason, GameStatus, MAX_PLAYERS_PER_GAME } from '@teamchess/shared';

// Constants and Types
const DISCONNECT_GRACE_MS = 20000;
const stockfishPath = path.join(
  __dirname,
  '..',
  'node_modules',
  'stockfish',
  'src',
  'stockfish-nnue-16.js',
);
type Side = 'white' | 'black' | 'spectator';
type PlayerSide = 'white' | 'black';
type Session = {
  pid: string; // stable player id
  name: string;
  gameId?: string;
  side?: Side;
  reconnectTimer?: NodeJS.Timeout;
};

interface LobbyState {
  status: GameStatus.Lobby | GameStatus.SearchingForMerge;
}

interface GameState {
  whiteIds: Set<string>; // pids
  blackIds: Set<string>; // pids
  moveNumber: number;
  side: PlayerSide;
  proposals: Map<string, string>; // pid -> lan
  whiteTime: number;
  blackTime: number;
  timerInterval?: NodeJS.Timeout;
  engine: ReturnType<typeof loadEngine>;
  chess: Chess;
  status: GameStatus.Active | GameStatus.Over;
  endReason?: string;
  endWinner?: string | null;
  drawOffer?: 'white' | 'black';
}

// In-Memory State
const sessions = new Map<string, Session>();
const lobbyStates = new Map<string, LobbyState>();
const gameStates = new Map<string, GameState>();
const mergeQueue = new Set<string>();

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 5000,
  pingTimeout: 5000,
});
// Helper Functions
const loadEngine = require('../load_engine.cjs') as (enginePath: string) => {
  send(cmd: string, cb?: (data: string) => void, stream?: (data: string) => void): void;
  quit(): void;
};

function countPlayersInGame(gameId: string): number {
  let count = 0;
  for (const session of sessions.values()) {
    if (session.gameId === gameId) {
      count++;
    }
  }
  return count;
}

function generateGameId(): string {
  return Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
}

function generateUniqueGameId(): string {
  let id: string;
  do {
    id = generateGameId();
  } while (io.sockets.adapter.rooms.has(id));
  return id;
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
    if (sess.gameId !== gameId) continue;
    const pid = sess.pid;
    const name = sess.name ?? 'Player';
    const connected = onlinePids.has(pid);
    const side = sess.side ?? 'spectator';
    const p = { id: pid, name, connected } as any as Player;

    if (side === 'white') whitePlayers.push(p);
    else if (side === 'black') blackPlayers.push(p);
    else spectators.push(p);
  }

  io.in(gameId).emit('players', { spectators, whitePlayers, blackPlayers });
}

function endGame(gameId: string, reason: string, winner: string | null = null) {
  const state = gameStates.get(gameId);
  if (!state || state.status === GameStatus.Over) return;

  if (state.timerInterval) clearInterval(state.timerInterval);
  state.engine.quit();
  state.status = GameStatus.Over;
  state.endReason = reason;
  state.endWinner = winner;
  state.drawOffer = undefined; // Clear any pending draw offers
  const pgn = getCleanPgn(state.chess);
  io.in(gameId).emit('game_over', { reason, winner, pgn });
  io.in(gameId).emit('draw_offer_update', { side: null });
}

function startClock(gameId: string) {
  const state = gameStates.get(gameId);
  if (!state || state.status !== GameStatus.Active) return;
  if (state.timerInterval) clearInterval(state.timerInterval);
  io.in(gameId).emit('clock_update', {
    whiteTime: state.whiteTime,
    blackTime: state.blackTime,
  });
  state.timerInterval = setInterval(() => {
    if (state.side === 'white') state.whiteTime--;
    else state.blackTime--;

    io.in(gameId).emit('clock_update', {
      whiteTime: state.whiteTime,
      blackTime: state.blackTime,
    });

    if (state.whiteTime <= 0 || state.blackTime <= 0) {
      const winner = state.side === 'white' ? 'black' : 'white';
      endGame(gameId, EndReason.Timeout, winner);
    }
  }, 1000);
}

async function chooseBestMove(
  engine: ReturnType<typeof loadEngine>,
  fen: string,
  candidates: string[],
  depth = 15,
  timeoutMs = 5000,
) {
  if (candidates.length === 1) return candidates[0];
  return new Promise<string>(resolve => {
    let done = false;
    engine.send(`position fen ${fen}`);
    engine.send(`go depth ${depth} searchmoves ${candidates.join(' ')}`, (output: string) => {
      if (done) return;
      if (output.startsWith('bestmove')) {
        done = true;
        resolve(output.split(' ')[1]);
      }
    });
    setTimeout(() => {
      if (!done) {
        done = true;
        const randomCandidate = candidates[Math.floor(Math.random() * candidates.length)];
        resolve(randomCandidate);
      }
    }, timeoutMs);
  });
}

function tryFinalizeTurn(gameId: string, state: GameState) {
  if (state.status !== GameStatus.Active) return;

  const room = io.sockets.adapter.rooms.get(gameId) || new Set<string>();
  const onlinePids = new Set(
    [...room]
      .map(id => io.sockets.sockets.get(id)?.data.pid as string | undefined)
      .filter((pid): pid is string => Boolean(pid)),
  );
  const sideSet = state.side === 'white' ? state.whiteIds : state.blackIds;
  const activeConnected = new Set([...sideSet].filter(pid => onlinePids.has(pid)));
  const entries = [...state.proposals.entries()].filter(([pid]) => activeConnected.has(pid));

  if (activeConnected.size > 0 && entries.length === activeConnected.size) {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = undefined;
    }

    const candidates = entries.map(([, lan]) => lan);
    const currentFen = state.chess.fen();
    chooseBestMove(state.engine, currentFen, candidates, 15).then(selLan => {
      const from = selLan.slice(0, 2);
      const to = selLan.slice(2, 4);
      const params: any = { from, to };
      if (selLan.length === 5) params.promotion = selLan[4];

      const move = state.chess.move(params);
      if (!move) return;
      const fen = state.chess.fen();

      if (state.side === 'white') state.whiteTime += 5;
      else state.blackTime += 5;

      io.in(gameId).emit('clock_update', {
        whiteTime: state.whiteTime,
        blackTime: state.blackTime,
      });

      const [selPid] = entries.find(([, v]) => v === selLan)!;
      let selName: string | undefined;
      for (const sid of room) {
        const sock = io.sockets.sockets.get(sid);
        if (sock?.data.pid === selPid) {
          selName = sock.data.name;
          break;
        }
      }
      if (!selName) selName = sessions.get(selPid)?.name || 'Player';

      io.in(gameId).emit('move_selected', {
        id: selPid,
        name: selName,
        moveNumber: state.moveNumber,
        side: state.side,
        lan: selLan,
        san: move.san,
        fen,
      });
      if (state.chess.isGameOver()) {
        let reason: string;
        let winner: 'white' | 'black' | null = null;
        if (state.chess.isCheckmate()) {
          reason = EndReason.Checkmate;
          winner = state.side;
        } else if (state.chess.isStalemate()) {
          reason = EndReason.Stalemate;
        } else if (state.chess.isThreefoldRepetition()) {
          reason = EndReason.Threefold;
        } else if (state.chess.isInsufficientMaterial()) {
          reason = EndReason.Insufficient;
        } else if (state.chess.isDraw()) {
          reason = EndReason.DrawRule;
        } else {
          reason = 'terminated';
        }
        endGame(gameId, reason, winner);
      } else {
        state.proposals.clear();
        state.side = state.side === 'white' ? 'black' : 'white';
        state.moveNumber++;
        io.in(gameId).emit('turn_change', { moveNumber: state.moveNumber, side: state.side });
        io.in(gameId).emit('position_update', { fen });
        startClock(gameId);
      }
    });
  }
}

function endIfOneSided(gameId: string, state: GameState) {
  if (state.status !== GameStatus.Active) return;

  const whiteAlive = state.whiteIds.size > 0;
  const blackAlive = state.blackIds.size > 0;

  if (whiteAlive && blackAlive) return;

  const winner = whiteAlive ? 'white' : blackAlive ? 'black' : null;
  endGame(gameId, EndReason.Resignation, winner);
}

function removePlayerPidFromSide(state: GameState, pid: string, side: Side) {
  if (side === 'white') state.whiteIds.delete(pid);
  else if (side === 'black') state.blackIds.delete(pid);
}

function cleanupProposalByPid(gameId: string, state: GameState, pid: string) {
  const existed = state.proposals.delete(pid);
  if (existed) {
    io.in(gameId).emit('proposal_removed', {
      moveNumber: state.moveNumber,
      side: state.side,
      id: pid,
    });
  }
  tryFinalizeTurn(gameId, state);
}

async function tryMatchAndMerge() {
  if (mergeQueue.size < 2) return;

  const queueAsArray = [...mergeQueue];
  let gameA_Id: string | null = null;
  let gameB_Id: string | null = null;
  let foundMatch = false;
  for (let i = 0; i < queueAsArray.length; i++) {
    for (let j = i + 1; j < queueAsArray.length; j++) {
      const id1 = queueAsArray[i];
      const id2 = queueAsArray[j];
      const count1 = countPlayersInGame(id1);
      const count2 = countPlayersInGame(id2);
      if (count1 + count2 <= MAX_PLAYERS_PER_GAME) {
        gameA_Id = id1;
        gameB_Id = id2;
        foundMatch = true;
        break;
      }
    }
    if (foundMatch) break;
  }

  if (!gameA_Id || !gameB_Id) {
    return; // No suitable match found
  }

  mergeQueue.delete(gameA_Id);
  mergeQueue.delete(gameB_Id);

  const lobbyA = lobbyStates.get(gameA_Id);
  const lobbyB = lobbyStates.get(gameB_Id);
  if (!lobbyA || !lobbyB) return;

  const newGameId = generateUniqueGameId();
  lobbyStates.set(newGameId, { status: GameStatus.Lobby });

  const roomA = io.sockets.adapter.rooms.get(gameA_Id) || new Set();
  const roomB = io.sockets.adapter.rooms.get(gameB_Id) || new Set();
  const allSocketIds = [...roomA, ...roomB];

  for (const socketId of allSocketIds) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;
    const pid = socket.data.pid as string;
    const sess = sessions.get(pid);
    if (!sess) continue;

    socket.leave(sess.gameId!);
    socket.join(newGameId);
    sess.gameId = newGameId;
    sess.side = 'spectator';
    socket.data.gameId = newGameId;
    socket.data.side = 'spectator';

    socket.emit('merge_success', { newGameId });
  }

  lobbyStates.delete(gameA_Id);
  lobbyStates.delete(gameB_Id);
  setTimeout(() => {
    broadcastPlayers(newGameId);
  }, 100);
}

function leave(this: Socket, explicit = false) {
  const socket = this;
  const pid = socket.data.pid as string | undefined;
  const gameId = socket.data.gameId as string | undefined;
  if (!pid || !gameId) return;

  const state = gameStates.get(gameId);
  const sess = sessions.get(pid);
  if (!sess) return;
  const finalize = (clearSession: boolean) => {
    if (state) {
      cleanupProposalByPid(gameId, state, pid);
      removePlayerPidFromSide(state, pid, (socket.data.side as Side) || 'spectator');
      endIfOneSided(gameId, state);
    }

    if (!io.sockets.adapter.rooms.has(gameId)) {
      if (state) {
        state.engine.quit();
        gameStates.delete(gameId);
      } else {
        if (mergeQueue.has(gameId)) {
          mergeQueue.delete(gameId);
        }
        lobbyStates.delete(gameId);
      }
    }

    if (clearSession) {
      sess.gameId = undefined;
      sess.side = undefined;
    }

    broadcastPlayers(gameId);
    if (state) tryFinalizeTurn(gameId, state);
  };

  if (explicit) {
    socket.leave(gameId);
    finalize(true);
    delete (socket.data as any).gameId;
    delete (socket.data as any).side;
    return;
  }

  if (sess.reconnectTimer) clearTimeout(sess.reconnectTimer);
  sess.reconnectTimer = setTimeout(() => {
    finalize(true);
    sess.reconnectTimer = undefined;
  }, DISCONNECT_GRACE_MS);

  broadcastPlayers(gameId);
  if (state) tryFinalizeTurn(gameId, state);
}

// Socket.IO Connection Handler
io.on('connection', (socket: Socket) => {
  const { pid: providedPid, name: providedName } =
    (socket.handshake.auth as { pid?: string; name?: string }) || {};
  const pid = providedPid && sessions.has(providedPid) ? providedPid : nanoid();
  let sess = sessions.get(pid);

  if (!sess) {
    sess = { pid, name: providedName || 'Guest' };
    sessions.set(pid, sess);
  } else {
    if (sess.reconnectTimer) {
      clearTimeout(sess.reconnectTimer);
      sess.reconnectTimer = undefined;
    }
    if (providedName && !sess.name) sess.name = providedName;
  }

  socket.data.pid = pid;
  socket.data.name = sess.name;
  socket.emit('session', { id: pid, name: sess.name });

  if (sess.gameId && (gameStates.has(sess.gameId) || lobbyStates.has(sess.gameId))) {
    socket.join(sess.gameId);
    socket.data.gameId = sess.gameId;
    socket.data.side = sess.side || 'spectator';
    const state = gameStates.get(sess.gameId);
    if (state) {
      if (sess.side && sess.side !== 'spectator') {
        (sess.side === 'white' ? state.whiteIds : state.blackIds).add(pid);
      }
      socket.emit('position_update', { fen: state.chess.fen() });
      socket.emit('clock_update', { whiteTime: state.whiteTime, blackTime: state.blackTime });
      if (state.drawOffer) {
        socket.emit('draw_offer_update', { side: state.drawOffer });
      }
      if (state.status === GameStatus.Over) {
        socket.emit('game_over', {
          reason: state.endReason,
          winner: state.endWinner,
          pgn: getCleanPgn(state.chess),
        });
      } else {
        socket.emit('game_started', { moveNumber: state.moveNumber, side: state.side });
      }
    } else {
      const lobby = lobbyStates.get(sess.gameId);
      if (lobby) {
        socket.emit('game_status_update', { status: lobby.status });
      }
    }
    broadcastPlayers(sess.gameId);
  }

  socket.on('create_game', ({ name }, cb) => {
    const gameId = generateUniqueGameId();
    lobbyStates.set(gameId, { status: GameStatus.Lobby });
    socket.join(gameId);
    socket.data = { ...socket.data, name, gameId, side: 'spectator' };
    const s = sessions.get(socket.data.pid)!;
    s.name = name;
    s.gameId = gameId;
    s.side = 'spectator';
    cb?.({ gameId });
    broadcastPlayers(gameId);
  });
  socket.on('join_game', ({ gameId, name }, cb) => {
    if (!lobbyStates.has(gameId) && !gameStates.has(gameId)) {
      cb?.({ error: 'Game not found.' });
      return;
    }

    if (countPlayersInGame(gameId) >= MAX_PLAYERS_PER_GAME) {
      cb?.({ error: 'This game is full.' });
      return;
    }

    socket.join(gameId);
    socket.data = { ...socket.data, name, gameId, side: 'spectator' };
    const s = sessions.get(socket.data.pid)!;
    s.name = name;
    s.gameId = gameId;
    s.side = 'spectator';
    cb?.({ gameId });
    broadcastPlayers(gameId);

    const state = gameStates.get(gameId);
    if (state) {
      socket.emit('position_update', { fen: state.chess.fen() });
      socket.emit('clock_update', { whiteTime: state.whiteTime, blackTime: state.blackTime });
      if (state.status === GameStatus.Over)
        socket.emit('game_over', {
          reason: state.endReason,
          winner: state.endWinner,
          pgn: getCleanPgn(state.chess),
        });
      else socket.emit('game_started', { moveNumber: state.moveNumber, side: state.side });
      for (const [pid, lan] of state.proposals.entries()) {
        const from = lan.slice(0, 2);
        const to = lan.slice(2, 4);
        const params: any = { from, to };
        if (lan.length === 5) params.promotion = lan[4];
        const move = state.chess.move(params);
        if (!move) continue;
        state.chess.undo();
        const proposal = {
          id: pid,
          name: sessions.get(pid)?.name || 'Player',
          moveNumber: state.moveNumber,
          side: state.side,
          lan,
          san: move.san,
        };
        socket.emit('move_submitted', proposal);
      }
    } else {
      const lobby = lobbyStates.get(gameId);
      socket.emit('game_status_update', { status: lobby!.status });
    }
  });

  socket.on('join_side', ({ side }, cb) => {
    const gameId = socket.data.gameId as string | undefined;
    if (!gameId) return cb?.({ success: false, error: 'Not in a game.' });

    const prevSide = socket.data.side as Side;
    socket.data.side = side;

    const state = gameStates.get(gameId);
    const pid = socket.data.pid as string;
    const sess = sessions.get(pid)!;
    sess.side = side;
    sess.gameId = gameId;

    if (state && state.status === GameStatus.Active) {
      if (prevSide) removePlayerPidFromSide(state, pid, prevSide);
      if (side === 'white') state.whiteIds.add(pid);
      else if (side === 'black') state.blackIds.add(pid);
      if (side === 'spectator') cleanupProposalByPid(gameId, state, pid);
      endIfOneSided(gameId, state);
    }
    broadcastPlayers(gameId);
    cb?.({ success: true });
  });
  socket.on('start_game', (cb?: (res: { success: boolean; error?: string }) => void) => {
    const gameId = socket.data.gameId as string | undefined;
    const lobby = gameId ? lobbyStates.get(gameId) : undefined;

    if (!gameId || !lobby || lobby.status !== GameStatus.Lobby || gameStates.has(gameId)) {
      cb?.({ success: false, error: 'Invalid game state for starting.' });
      return;
    }
    lobbyStates.delete(gameId);

    const engine = loadEngine(stockfishPath);
    engine.send('uci', (data: string) => {
      if (data.startsWith('uciok'))
        engine.send('isready', rd => console.log(rd === 'readyok' ? 'Stockfish ready!' : rd));
    });

    const whites = new Set<string>();
    const blacks = new Set<string>();
    for (const sess of sessions.values()) {
      if (sess.gameId === gameId) {
        if (sess.side === 'white') whites.add(sess.pid);
        else if (sess.side === 'black') blacks.add(sess.pid);
      }
    }

    const chess = new Chess();
    gameStates.set(gameId, {
      whiteIds: whites,
      blackIds: blacks,
      moveNumber: 1,
      side: 'white',
      proposals: new Map(),
      whiteTime: 600,
      blackTime: 600,
      engine,
      chess,
      status: GameStatus.Active,
    });
    io.in(gameId).emit('game_started', { moveNumber: 1, side: 'white' });
    io.in(gameId).emit('position_update', { fen: chess.fen() });
    startClock(gameId);
    cb?.({ success: true });
  });
  socket.on('reset_game', (cb?: (res: { success: boolean; error?: string }) => void) => {
    const gameId = socket.data.gameId as string | undefined;
    const state = gameId && gameStates.get(gameId);
    if (!gameId || !state) {
      cb?.({ success: false, error: 'Game not found.' });
      return;
    }

    if (state.timerInterval) clearInterval(state.timerInterval);
    state.engine.quit();
    gameStates.delete(gameId);
    lobbyStates.set(gameId, { status: GameStatus.Lobby });

    io.in(gameId).emit('game_reset');
    cb?.({ success: true });
  });
  socket.on('play_move', (lan: string, cb) => {
    const gameId = socket.data.gameId as string | undefined;
    const state = gameStates.get(gameId!);
    if (!state || state.status !== GameStatus.Active) return cb?.({ error: 'Game not running.' });

    const pid = socket.data.pid as string;
    const active = state.side === 'white' ? state.whiteIds : state.blackIds;
    if (!active.has(pid)) return cb?.({ error: 'Not your turn.' });
    if (state.proposals.has(pid)) return cb?.({ error: 'Already moved.' });

    const from = lan.slice(0, 2);
    const to = lan.slice(2, 4);
    const params: any = { from, to };
    if (lan.length === 5) params.promotion = lan[4];
    const move = state.chess.move(params);
    if (!move) return cb?.({ error: 'Illegal move.' });
    state.chess.undo();

    state.proposals.set(pid, lan);
    io.in(gameId!).emit('move_submitted', {
      id: pid,
      name: socket.data.name,
      moveNumber: state.moveNumber,
      side: state.side,
      lan,
      san: move.san,
    });
    tryFinalizeTurn(gameId!, state);
    cb?.({});
  });

  socket.on('chat_message', (message: string) => {
    const gameId = socket.data.gameId as string | undefined;
    const name = socket.data.name as string | undefined;
    const pid = socket.data.pid as string | undefined;

    if (!gameId || !name || !pid || !message.trim()) return;

    io.to(gameId).emit('chat_message', {
      sender: name,
      senderId: pid,
      message: message.trim(),
    });
  });
  socket.on('resign', () => {
    const gameId = socket.data.gameId as string | undefined;
    const side = socket.data.side as 'white' | 'black' | 'spectator' | undefined;
    const state = gameId ? gameStates.get(gameId) : undefined;

    if (!state || state.status !== GameStatus.Active || !side || side === 'spectator') {
      return;
    }

    const winner = side === 'white' ? 'black' : 'white';
    endGame(gameId, EndReason.Resignation, winner);
  });
  socket.on('offer_draw', () => {
    const gameId = socket.data.gameId as string | undefined;
    const side = socket.data.side as 'white' | 'black' | 'spectator' | undefined;
    const state = gameId ? gameStates.get(gameId) : undefined;

    if (!state || state.status !== GameStatus.Active || !side || side === 'spectator') {
      return;
    }
    if (state.drawOffer) return;

    state.drawOffer = side;
    io.in(gameId).emit('draw_offer_update', { side });
  });

  socket.on('accept_draw', () => {
    const gameId = socket.data.gameId as string | undefined;
    const side = socket.data.side as 'white' | 'black' | 'spectator' | undefined;
    const state = gameId ? gameStates.get(gameId) : undefined;

    if (!state || state.status !== GameStatus.Active || !side || side === 'spectator') {
      return;
    }
    if (!state.drawOffer || state.drawOffer === side) {
      return;
    }

    endGame(gameId, EndReason.DrawAgreement, null);
  });

  socket.on('reject_draw', () => {
    const gameId = socket.data.gameId as string | undefined;
    const side = socket.data.side as 'white' | 'black' | 'spectator' | undefined;
    const state = gameId ? gameStates.get(gameId) : undefined;

    if (!state || state.status !== GameStatus.Active || !side || side === 'spectator') {
      return;
    }
    if (!state.drawOffer || state.drawOffer === side) {
      return;
    }

    state.drawOffer = undefined;
    io.in(gameId).emit('draw_offer_update', { side: null });
  });
  socket.on('find_merge', () => {
    const gameId = socket.data.gameId as string | undefined;
    const lobby = gameId ? lobbyStates.get(gameId) : undefined;
    if (!lobby || lobby.status !== GameStatus.Lobby) return;
    lobby.status = GameStatus.SearchingForMerge;
    mergeQueue.add(gameId!);
    io.in(gameId!).emit('game_status_update', { status: lobby.status });
    tryMatchAndMerge();
  });
  socket.on('cancel_merge', () => {
    const gameId = socket.data.gameId as string | undefined;
    const lobby = gameId ? lobbyStates.get(gameId) : undefined;
    if (!lobby || lobby.status !== GameStatus.SearchingForMerge) return;
    lobby.status = GameStatus.Lobby;
    mergeQueue.delete(gameId!);
    io.in(gameId!).emit('game_status_update', { status: lobby.status });
  });
  socket.on('exit_game', () => leave.call(socket, true));
  socket.on('disconnect', () => leave.call(socket, false));
});
server.listen(3001, () => console.log('Socket.IO chess server listening on port 3001'));
