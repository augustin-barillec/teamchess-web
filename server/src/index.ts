import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import { nanoid } from 'nanoid';
import { Chess } from 'chess.js';
import path from 'path';
import { Player, EndReason } from '@teamchess/shared';

// path to the built Stockfish engine
const stockfishPath = path.join(
  __dirname,
  '..',
  'node_modules',
  'stockfish',
  'src',
  'stockfish-nnue-16.js',
);

// load the engine
const loadEngine = require('../load_engine.cjs') as (enginePath: string) => {
  send(cmd: string, cb?: (data: string) => void, stream?: (data: string) => void): void;
  quit(): void;
};

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

type Seat = 'white' | 'black' | 'spectator';
type PlayerSide = 'white' | 'black';

type Session = {
  pid: string; // stable player id
  name: string;
  gameId?: string;
  side?: Seat;
  reconnectTimer?: NodeJS.Timeout;
};
const sessions = new Map<string, Session>();
const DISCONNECT_GRACE_MS = 20000;

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
  started: boolean;
  ended: boolean;
  endReason?: string;
  endWinner?: string | null;
}

const gameStates = new Map<string, GameState>();

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

function endGame(gameId: string, reason: string, winner: string | null = null) {
  const state = gameStates.get(gameId);
  if (!state) return;
  if (state.ended) return;
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.engine.quit();
  state.ended = true;
  state.endReason = reason;
  state.endWinner = winner;
  io.in(gameId).emit('game_over', { reason, winner });
}

function startClock(gameId: string) {
  const state = gameStates.get(gameId);
  if (!state || state.ended) return;
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
        const moves = new Chess(fen).moves({ verbose: true });
        const random = moves[Math.floor(Math.random() * moves.length)];
        resolve(random.lan || random.san);
      }
    }, timeoutMs);
  });
}

// Build roster from sessions so it works even before start_game.
// Mark connected = true if any socket with that pid is in the room.
function broadcastPlayers(gameId: string) {
  const room = io.sockets.adapter.rooms.get(gameId) || new Set<string>();
  const onlinePids = new Set(
    [...room]
      .map(sid => io.sockets.sockets.get(sid)?.data.pid as string | undefined)
      .filter((pid): pid is string => Boolean(pid)),
  );

  // Using the shared Player type (id, name). We'll attach 'connected' transiently
  // and then emit; the client can read it, TS is fine because we cast on push.
  const spectators: Player[] = [];
  const whitePlayers: Player[] = [];
  const blackPlayers: Player[] = [];

  for (const sess of sessions.values()) {
    if (sess.gameId !== gameId) continue;
    const pid = sess.pid;
    const name = sess.name ?? 'Player';
    const connected = onlinePids.has(pid);
    const side = sess.side ?? 'spectator';

    const p = { id: pid, name, connected } as any as Player; // cast for shared type
    if (side === 'white') whitePlayers.push(p);
    else if (side === 'black') blackPlayers.push(p);
    else spectators.push(p);
  }

  io.in(gameId).emit('players', { spectators, whitePlayers, blackPlayers });
}

function tryFinalizeTurn(gameId: string, state: GameState) {
  if (!state.started || state.ended) return;

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

      // find a live socket to read the name, fallback to sessions
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

      console.log(
        'selection',
        JSON.stringify({
          gameId,
          moveNumber: state.moveNumber,
          side: state.side,
          id: selPid,
          name: selName,
          lan: selLan,
          san: move.san,
          fen,
        }),
      );

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
          reason = 'terminated'; // should not happen
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

// no instant auto-end on one-sided presence; clocks decide outcomes
function endIfOneSided(_gameId: string, _state: GameState) {
  /* disabled */
}

function removePlayerPidFromSide(state: GameState, pid: string, side: Seat) {
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
      // drop any pending move from this pid
      cleanupProposalByPid(gameId, state, pid);

      // remove from team sets using the side we still have on socket.data
      removePlayerPidFromSide(state, pid, (socket.data.side as Seat) || 'spectator');

      // if room is now empty, tear down
      if (!io.sockets.adapter.rooms.has(gameId)) {
        state.engine.quit();
        gameStates.delete(gameId);
      }
    }

    if (clearSession) {
      sess.gameId = undefined;
      sess.side = undefined;
    }

    // tell everyone in the room right now
    broadcastPlayers(gameId);
    if (state) tryFinalizeTurn(gameId, state);
  };

  if (explicit) {
    // user clicked Exit → leave room immediately so they disappear at once
    socket.leave(gameId);
    finalize(true);
    delete (socket.data as any).gameId;
    delete (socket.data as any).side;
    return;
  }

  // transient disconnect → grace period before removal
  if (sess.reconnectTimer) clearTimeout(sess.reconnectTimer);
  sess.reconnectTimer = setTimeout(() => {
    finalize(true);
    sess.reconnectTimer = undefined;
  }, DISCONNECT_GRACE_MS);

  broadcastPlayers(gameId);
}

io.on('connection', (socket: Socket) => {
  // establish/restore a session
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

  // if the session remembers a room and it exists, silently rejoin
  if (sess.gameId && io.sockets.adapter.rooms.has(sess.gameId)) {
    socket.join(sess.gameId);
    socket.data.gameId = sess.gameId;
    socket.data.side = sess.side || 'spectator';
    const state = gameStates.get(sess.gameId);
    if (state && sess.side && sess.side !== 'spectator') {
      (sess.side === 'white' ? state.whiteIds : state.blackIds).add(pid);
      socket.emit('position_update', { fen: state.chess.fen() });
      socket.emit('clock_update', { whiteTime: state.whiteTime, blackTime: state.blackTime });
      if (state.ended)
        socket.emit('game_over', { reason: state.endReason, winner: state.endWinner });
      else socket.emit('game_started', { moveNumber: state.moveNumber, side: state.side });
    }
    broadcastPlayers(sess.gameId);
  }

  socket.on('create_game', ({ name }, cb) => {
    const gameId = generateUniqueGameId();
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
    if (!io.sockets.adapter.rooms.has(gameId)) {
      cb?.({ error: 'Game not found.' });
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
    if (!state || !state.started) return;
    socket.emit('position_update', { fen: state.chess.fen() });
    socket.emit('clock_update', { whiteTime: state.whiteTime, blackTime: state.blackTime });
    if (state.ended) socket.emit('game_over', { reason: state.endReason, winner: state.endWinner });
    else socket.emit('game_started', { moveNumber: state.moveNumber, side: state.side });
  });

  socket.on('join_side', ({ side }, cb) => {
    const gameId = socket.data.gameId as string | undefined;
    if (!gameId) return cb?.({ success: false, error: 'Not in a game.' });

    const prevSide = socket.data.side as Seat;
    socket.data.side = side;

    const state = gameStates.get(gameId);
    const pid = socket.data.pid as string;
    const sess = sessions.get(pid)!;
    sess.side = side;
    sess.gameId = gameId;

    if (state && state.started && !state.ended) {
      // adjust the sets only during an active game
      if (prevSide) removePlayerPidFromSide(state, pid, prevSide);
      if (side === 'white') state.whiteIds.add(pid);
      else if (side === 'black') state.blackIds.add(pid);
      if (side === 'spectator') cleanupProposalByPid(gameId, state, pid);
    }
    broadcastPlayers(gameId);
    cb?.({ success: true });
  });

  socket.on('start_game', (cb?: (res: { success: boolean; error?: string }) => void) => {
    const gameId = socket.data.gameId as string | undefined;
    if (!gameId || gameStates.has(gameId)) {
      cb?.({ success: false, error: 'Invalid or already started game.' });
      return;
    }
    const engine = loadEngine(stockfishPath);
    engine.send('uci', (data: string) => {
      if (data.startsWith('uciok'))
        engine.send('isready', rd => console.log(rd === 'readyok' ? 'Stockfish ready!' : rd));
    });

    const whites = new Set<string>();
    const blacks = new Set<string>();
    (io.sockets.adapter.rooms.get(gameId) || new Set<string>()).forEach(id => {
      const s = io.sockets.sockets.get(id);
      const pid = s?.data.pid as string | undefined;
      if (!pid) return;
      if (s?.data.side === 'white') whites.add(pid);
      else if (s?.data.side === 'black') blacks.add(pid);
    });

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
      started: true,
      ended: false,
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

    io.in(gameId).emit('game_reset');
    cb?.({ success: true });
  });

  socket.on('play_move', (lan: string, cb) => {
    const gameId = socket.data.gameId as string | undefined;
    const state = gameStates.get(gameId!);
    if (!state || state.ended) return cb?.({ error: 'Game not running.' });

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

    console.log(
      'proposal',
      JSON.stringify({
        gameId,
        moveNumber: state.moveNumber,
        side: state.side,
        id: pid,
        name: socket.data.name,
        lan,
        san: move.san,
      }),
    );

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

  socket.on('exit_game', () => leave.call(socket, true));
  socket.on('disconnect', () => leave.call(socket, false));
});

server.listen(3001, () => console.log('Socket.IO chess server listening on port 3001'));
