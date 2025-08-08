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
interface GameState {
  whiteIds: Set<string>;
  blackIds: Set<string>;
  moveNumber: number;
  side: PlayerSide;
  proposals: Map<string, string>;
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
      endGame(gameId, 'timeout', winner);
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
  if (candidates.length === 1) {
    return candidates[0];
  }
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

function broadcastPlayers(gameId: string) {
  const spectators: Player[] = [];
  const whitePlayers: Player[] = [];
  const blackPlayers: Player[] = [];
  const clients = io.sockets.adapter.rooms.get(gameId) || new Set<string>();

  for (const socketId of clients) {
    const s = io.sockets.sockets.get(socketId);
    if (!s?.data.name) continue;
    const p: Player = { id: socketId, name: s.data.name };
    if (s.data.side === 'white') whitePlayers.push(p);
    else if (s.data.side === 'black') blackPlayers.push(p);
    else spectators.push(p);
  }
  io.in(gameId).emit('players', { spectators, whitePlayers, blackPlayers });
}

function tryFinalizeTurn(gameId: string, state: GameState) {
  if (!state.started || state.ended) return;
  const activeIds = state.side === 'white' ? state.whiteIds : state.blackIds;
  const entries = Array.from(state.proposals.entries()).filter(([id]) => activeIds.has(id));

  if (activeIds.size > 0 && entries.length === activeIds.size) {
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

      const [selId] = entries.find(([, v]) => v === selLan)!;
      const selName = io.sockets.sockets.get(selId)!.data.name;

      io.in(gameId).emit('move_selected', {
        id: selId,
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
          id: selId,
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
          reason = 'terminated'; // Should not be reached
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
  const wCount = state.whiteIds.size;
  const bCount = state.blackIds.size;
  if ((wCount === 0 && bCount > 0) || (bCount === 0 && wCount > 0)) {
    const winner: PlayerSide = wCount > 0 ? 'white' : 'black';
    endGame(gameId, 'timeout or disconnect', winner);
  }
}

function removePlayerFromSide(state: GameState, socketId: string, side: Seat) {
  if (side === 'white') state.whiteIds.delete(socketId);
  else if (side === 'black') state.blackIds.delete(socketId);
}

function cleanupProposal(socket: Socket, state: GameState) {
  state.proposals.delete(socket.id);
  io.in(socket.data.gameId).emit('proposal_removed', {
    moveNumber: state.moveNumber,
    side: state.side,
    id: socket.id,
  });
  tryFinalizeTurn(socket.data.gameId, state);
}

function leave(this: Socket) {
  const socket = this;
  const gameId = socket.data.gameId as string | undefined;
  if (!gameId) return;
  const state = gameStates.get(gameId);

  if (state) {
    removePlayerFromSide(state, socket.id, socket.data.side as Seat);
    cleanupProposal(socket, state);
    endIfOneSided(gameId, state);
  }
  socket.leave(gameId);
  delete socket.data.gameId;
  delete socket.data.side;
  broadcastPlayers(gameId);

  if (!io.sockets.adapter.rooms.has(gameId)) {
    if (state) state.engine.quit();
    gameStates.delete(gameId);
  }
}

io.on('connection', (socket: Socket) => {
  socket.on('create_game', ({ name }, cb) => {
    const gameId = generateUniqueGameId();
    socket.join(gameId);
    socket.data = { name, gameId, side: 'spectator' };
    if (typeof cb === 'function') cb({ gameId });
    broadcastPlayers(gameId);
  });

  socket.on('join_game', ({ gameId, name }, cb) => {
    if (!io.sockets.adapter.rooms.has(gameId)) {
      if (typeof cb === 'function') cb({ error: 'Game not found.' });
      return;
    }
    socket.join(gameId);
    socket.data = { name, gameId, side: 'spectator' };
    if (typeof cb === 'function') cb({ gameId });
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
    if (!gameId)
      return typeof cb === 'function' ? cb({ success: false, error: 'Not in a game.' }) : undefined;

    const prevSide = socket.data.side as Seat;
    socket.data.side = side;
    const state = gameStates.get(gameId);
    if (state && state.started && !state.ended) {
      removePlayerFromSide(state, socket.id, prevSide);
      if (side === 'white') state.whiteIds.add(socket.id);
      else if (side === 'black') state.blackIds.add(socket.id);
      endIfOneSided(gameId, state);
      if (side === 'spectator') cleanupProposal(socket, state);
    }
    broadcastPlayers(gameId);
    if (typeof cb === 'function') cb({ success: true });
  });

  socket.on('start_game', (cb?: (res: { success: boolean; error?: string }) => void) => {
    const gameId = socket.data.gameId as string | undefined;
    if (!gameId || gameStates.has(gameId)) {
      if (typeof cb === 'function')
        cb({ success: false, error: 'Invalid or already started game.' });
      return;
    }
    const engine = loadEngine(stockfishPath);
    engine.send('uci', (data: string) => {
      if (data.startsWith('uciok'))
        engine.send('isready', rd => console.log(rd === 'readyok' ? 'Stockfish ready!' : rd));
    });

    const whites = new Set<string>();
    const blacks = new Set<string>();
    io.sockets.adapter.rooms.get(gameId)!.forEach(id => {
      const s = io.sockets.sockets.get(id);
      if (s?.data.side === 'white') whites.add(id);
      else if (s?.data.side === 'black') blacks.add(id);
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
    if (typeof cb === 'function') cb({ success: true });
  });

  socket.on('reset_game', (cb?: (res: { success: boolean; error?: string }) => void) => {
    const gameId = socket.data.gameId as string | undefined;
    const state = gameId && gameStates.get(gameId);
    if (!gameId || !state) {
      if (cb) cb({ success: false, error: 'Game not found.' });
      return;
    }

    // stop the clock
    if (state.timerInterval) clearInterval(state.timerInterval);
    // shut down Stockfish worker
    state.engine.quit();
    // drop the in-memory game state so start_game can recreate it
    gameStates.delete(gameId);

    // tell every client in the room to reset their UI
    io.in(gameId).emit('game_reset');

    if (cb) cb({ success: true });
  });

  socket.on('play_move', (lan: string, cb) => {
    const gameId = socket.data.gameId as string | undefined;
    const state = gameStates.get(gameId!);
    if (!state || state.ended)
      return typeof cb === 'function' ? cb({ error: 'Game not running.' }) : undefined;

    const active = state.side === 'white' ? state.whiteIds : state.blackIds;
    if (!active.has(socket.id)) return cb({ error: 'Not your turn.' });
    if (state.proposals.has(socket.id)) return cb({ error: 'Already moved.' });

    const from = lan.slice(0, 2);
    const to = lan.slice(2, 4);
    const params: any = { from, to };
    if (lan.length === 5) params.promotion = lan[4];
    const move = state.chess.move(params);
    if (!move) return cb({ error: 'Illegal move.' });
    state.chess.undo();

    state.proposals.set(socket.id, lan);
    io.in(gameId).emit('move_submitted', {
      id: socket.id,
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
        id: socket.id,
        name: socket.data.name,
        lan,
        san: move.san,
      }),
    );

    tryFinalizeTurn(gameId, state);
    if (typeof cb === 'function') cb({});
  });

  socket.on('chat_message', (message: string) => {
    const gameId = socket.data.gameId as string | undefined;
    const name = socket.data.name as string | undefined;

    if (!gameId || !name || !message.trim()) return;

    // broadcast message to everyone in the room
    io.to(gameId).emit('chat_message', {
      sender: name,
      senderId: socket.id,
      message: message.trim(),
    });
  });

  socket.on('exit_game', leave);
  socket.on('disconnect', leave);
});

server.listen(3001, () => console.log('Socket.IO chess server listening on port 3001'));
