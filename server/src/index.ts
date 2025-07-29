import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import { nanoid } from 'nanoid';
import { Chess } from 'chess.js';
import path from 'path';
import { Player } from '@teamchess/shared';

// point at the built Stockfish engine
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
const engine = loadEngine(stockfishPath);

// UCI handshake & readiness
engine.send('uci', (data: string) => {
  if (data.startsWith('uciok')) {
    engine.send('isready', (rd: string) => {
      if (rd === 'readyok') console.log('Stockfish ready!');
    });
  }
});

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

type Side = 'white' | 'black';

interface GameState {
  whiteIds: Set<string>;
  blackIds: Set<string>;
  moveNumber: number;
  side: Side;
  proposals: Map<string, string>;
  whiteTime: number;
  blackTime: number;
  timerInterval?: NodeJS.Timeout;
  chess: Chess;
  started: boolean;
  ended: boolean;
  endReason?: string;
  endWinner?: string | null;
}

const gameStates = new Map<string, GameState>();

// helpers
function endGame(gameId: string, reason: string, winner: string | null = null) {
  const state = gameStates.get(gameId);
  if (!state) return;
  if (state.timerInterval) clearInterval(state.timerInterval);
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

async function chooseBestMove(fen: string, candidates: string[], depth = 15): Promise<string> {
  return new Promise(resolve => {
    engine.send(`position fen ${fen}`);
    const movesArg = candidates.join(' ');
    engine.send(`go depth ${depth} searchmoves ${movesArg}`, (output: string) => {
      if (output.startsWith('bestmove')) {
        resolve(output.split(' ')[1]);
      }
    });
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

/**
 * Attempt to finalize a turn if all remaining players have submitted their proposals.
 */
function tryFinalizeTurn(gameId: string, state: GameState) {
  if (!state.started || state.ended) return;
  const activeIds = state.side === 'white' ? state.whiteIds : state.blackIds;

  // only keep proposals whose socket.id is still active
  const entries = Array.from(state.proposals.entries()).filter(([id]) => activeIds.has(id));

  if (activeIds.size > 0 && entries.length === activeIds.size) {
    const candidates = entries.map(([, lan]) => lan);
    const currentFen = state.chess.fen();

    chooseBestMove(currentFen, candidates, 12).then(selLan => {
      // apply the chosen move
      const move = state.chess.move({
        from: selLan.slice(0, 2),
        to: selLan.slice(2, 4),
        promotion: selLan[4],
      });
      if (!move) return;
      const fen = state.chess.fen();

      if (state.side === 'white') {
        state.whiteTime += 5;
      } else {
        state.blackTime += 5;
      }
      // immediately broadcast the updated clocks
      io.in(gameId).emit('clock_update', {
        whiteTime: state.whiteTime,
        blackTime: state.blackTime,
      });

      const [selId] = entries.find(([, v]) => v === selLan)!;
      const selName = io.sockets.sockets.get(selId)!.data.name;

      io.in(gameId).emit('move_selected', {
        id: selId, // new: the socket.id of the chooser
        name: selName,
        moveNumber: state.moveNumber,
        side: state.side,
        lan: selLan,
        san: move.san,
        fen,
      });

      // end-of-game conditions
      if (state.chess.isCheckmate()) {
        endGame(gameId, 'checkmate', state.side);
      } else if (state.chess.isStalemate()) {
        endGame(gameId, 'stalemate');
      } else if (state.chess.isThreefoldRepetition()) {
        endGame(gameId, 'threefold repetition');
      } else if (state.chess.isInsufficientMaterial()) {
        endGame(gameId, 'insufficient material');
      } else if (state.chess.isDraw()) {
        endGame(gameId, 'draw by rule');
      } else {
        // prepare next turn
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

io.on('connection', (socket: Socket) => {
  socket.on('create_game', ({ name }, cb) => {
    const gameId = nanoid(6);
    socket.join(gameId);
    socket.data = { name, gameId, side: 'spectator' };
    cb({ gameId });
    broadcastPlayers(gameId);
  });

  socket.on('join_game', ({ gameId, name }, cb) => {
    if (!io.sockets.adapter.rooms.has(gameId)) return cb({ error: 'Game not found.' });
    for (const id of io.sockets.adapter.rooms.get(gameId)!) {
      const s = io.sockets.sockets.get(id);
    }
    socket.join(gameId);
    socket.data = { name, gameId, side: 'spectator' };
    cb({ gameId });
    broadcastPlayers(gameId);
    const state = gameStates.get(gameId);
    if (!state || !state.started) return;
    socket.emit('position_update', { fen: state.chess.fen() });
    socket.emit('clock_update', { whiteTime: state.whiteTime, blackTime: state.blackTime });
    if (state.ended) {
      socket.emit('game_over', { reason: state.endReason, winner: state.endWinner });
    } else {
      socket.emit('game_started', { moveNumber: state.moveNumber, side: state.side });
    }
  });

  socket.on('join_side', ({ side }, cb) => {
    const gameId = socket.data.gameId as string | undefined;
    if (!gameId) return cb({ success: false, error: 'Not in a game.' });

    const prevSide = socket.data.side as Side;
    socket.data.side = side;

    const state = gameStates.get(gameId);
    if (state && state.started && !state.ended) {
      if (prevSide === 'white') state.whiteIds.delete(socket.id);
      if (prevSide === 'black') state.blackIds.delete(socket.id);
      if (side === 'white') state.whiteIds.add(socket.id);
      if (side === 'black') state.blackIds.add(socket.id);
      if (side === 'spectator') {
        const wCount = state.whiteIds.size;
        const bCount = state.blackIds.size;
        if ((wCount === 0 && bCount > 0) || (bCount === 0 && wCount > 0)) {
          // remaining side wins
          const winner = wCount > 0 ? 'white' : 'black';
          endGame(gameId, 'timeout or disconnect', winner);
        }
      }
    }

    if (state && state.started && !state.ended && side === 'spectator') {
      // if this player had already submitted a proposal this turn
      if (state.proposals.has(socket.id)) {
        state.proposals.delete(socket.id);
        // inform all clients to drop the proposal
        io.in(gameId).emit('proposal_removed', {
          moveNumber: state.moveNumber,
          side: prevSide,
          id: socket.id,
        });
      }
      tryFinalizeTurn(gameId, state);
    }

    broadcastPlayers(gameId);
    cb({ success: true });
  });

  socket.on('start_game', cb => {
    const gameId = socket.data.gameId as string | undefined;
    if (!gameId || gameStates.has(gameId)) return cb?.();

    const whites = new Set<string>();
    const blacks = new Set<string>();
    for (const id of io.sockets.adapter.rooms.get(gameId)!) {
      const s = io.sockets.sockets.get(id);
      if (s?.data.side === 'white') whites.add(id);
      else if (s?.data.side === 'black') blacks.add(id);
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
      chess,
      started: true,
      ended: false,
    });

    io.in(gameId).emit('game_started', { moveNumber: 1, side: 'white' });
    io.in(gameId).emit('position_update', { fen: chess.fen() });
    startClock(gameId);
    cb?.();
  });

  socket.on('play_move', (lan: string, cb) => {
    const gameId = socket.data.gameId as string | undefined;
    const state = gameStates.get(gameId!);
    if (!state || state.ended) return cb({ error: 'Game not running.' });

    const active = state.side === 'white' ? state.whiteIds : state.blackIds;
    if (!active.has(socket.id)) return cb({ error: 'Not your turn.' });
    if (state.proposals.has(socket.id)) return cb({ error: 'Already moved.' });

    const from = lan.slice(0, 2);
    const to = lan.slice(2, 4);
    const promo = lan[4];
    const move = state.chess.move({ from, to, promotion: promo });
    if (!move) return cb({ error: 'Illegal move.' });
    state.chess.undo();

    state.proposals.set(socket.id, lan);
    io.in(gameId).emit('move_submitted', {
      id: socket.id, // new
      name: socket.data.name,
      moveNumber: state.moveNumber,
      side: state.side,
      lan,
      san: move.san,
    });

    tryFinalizeTurn(gameId!, state);
    cb({});
  });

  function leave() {
    const gameId = socket.data.gameId as string | undefined;
    if (!gameId) return;
    const state = gameStates.get(gameId);
    if (state?.timerInterval) clearInterval(state.timerInterval);

    if (state) {
      state.whiteIds.delete(socket.id);
      state.blackIds.delete(socket.id);
      // remove any pending proposal from the leaving player
      state.proposals.delete(socket.id);

      // tell all clients to drop this player’s proposal for the current turn
      io.in(gameId).emit('proposal_removed', {
        moveNumber: state.moveNumber,
        side: state.side,
        id: socket.id,
      });

      // attempt to finalize with only active players’ proposals
      tryFinalizeTurn(gameId, state);
    }

    socket.leave(gameId);
    delete socket.data.gameId;
    delete socket.data.side;
    broadcastPlayers(gameId);

    if (state && !state.ended) {
      const w = state.whiteIds.size;
      const b = state.blackIds.size;
      if ((w === 0 && b > 0) || (b === 0 && w > 0)) {
        const winner = w > 0 ? 'white' : 'black';
        endGame(gameId, 'timeout or disconnect', winner);
      }
    }

    if (!io.sockets.adapter.rooms.has(gameId)) {
      gameStates.delete(gameId);
    }
  }

  socket.on('exit_game', leave);
  socket.on('disconnect', leave);
});

server.listen(3001, () => console.log('Socket.IO chess server listening on port 3001'));
