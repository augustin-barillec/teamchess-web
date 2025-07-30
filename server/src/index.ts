import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import { nanoid } from 'nanoid';
import { Chess } from 'chess.js';
import path from 'path';

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
  stop_moves(): void;
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

interface PlayerStats {
  bestMoveStreak: number;
  badMoveStreak: number;
}

interface GameState {
  whiteIds: Set<string>;
  blackIds: Set<string>;
  moveNumber: number;
  side: Side;
  proposals: Map<string, string>; // Map<socketId, lan>
  whiteTime: number;
  blackTime: number;
  timerInterval?: NodeJS.Timeout;
  chess: Chess;
  started: boolean;
  ended: boolean;
  endReason?: string;
  endWinner?: string | null;
  // Game settings
  multiPv: number;
  // Player stats
  playerStats: Map<string, PlayerStats>; // Map<playerName, stats>
  // For background analysis
  analysisResults: Map<string, { score: number; rank: number }>;
  analysisStopper?: () => void;
  analysisTimeout?: NodeJS.Timeout;
}

const gameStates = new Map<string, GameState>();

function startThinking(gameId: string) {
  const state = gameStates.get(gameId);
  if (!state || state.ended) return;

  if (state.analysisStopper) {
    state.analysisStopper();
  }

  state.analysisResults.clear();

  engine.send(`setoption name MultiPV value ${state.multiPv}`);
  engine.send(`position fen ${state.chess.fen()}`);

  const stopper = () => {
    engine.send('stop');
    if (state.analysisTimeout) {
      clearTimeout(state.analysisTimeout);
      state.analysisTimeout = undefined;
    }
    state.analysisStopper = undefined;
    console.log(`[${gameId}] Stopped thinking.`);

    // Check for mate hint after analysis is done, regardless of team size
    const activeIds = state.side === 'white' ? state.whiteIds : state.blackIds;
    const entries = Array.from(state.proposals.entries()).filter(([id]) => activeIds.has(id));
    if (entries.length < activeIds.size) {
      const bestAnalysisMove = Array.from(state.analysisResults.values()).find(r => r.rank === 1);
      if (bestAnalysisMove && bestAnalysisMove.score > 90000 && Math.random() < 0.2) {
        const mateIn = 100000 - bestAnalysisMove.score;
        if (mateIn <= 10) {
          const sideName = state.side.charAt(0).toUpperCase() + state.side.slice(1);
          io.in(gameId).emit('funky_message', {
            message: `Hint for ${sideName}: A mate in ${mateIn} is possible!`,
          });
        }
      }
    }
  };
  state.analysisStopper = stopper;

  state.analysisTimeout = setTimeout(stopper, 10000);
  console.log(`[${gameId}] Started thinking with MultiPV ${state.multiPv}...`);

  engine.send(
    'go infinite',
    () => { },
    (data: string) => {
      if (data.startsWith('info') && data.includes('multipv')) {
        const infoRegex = /multipv (\d+).*?score (cp|mate) (-?\d+).*?pv (\S+)/;
        const match = data.match(infoRegex);
        if (match) {
          const rank = parseInt(match[1], 10);
          const scoreType = match[2];
          let score = parseInt(match[3], 10);
          const move = match[4];
          if (scoreType === 'mate') {
            score = (score > 0 ? 100000 : -100000) - score;
          }
          state.analysisResults.set(move, { score, rank });
        }
      }
    },
  );
}

// helpers
function endGame(gameId: string, reason: string, winner: string | null = null) {
  const state = gameStates.get(gameId);
  if (!state) return;
  if (state.analysisStopper) state.analysisStopper();
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
  io.in(gameId).emit('clock_update', { whiteTime: state.whiteTime, blackTime: state.blackTime });
  state.timerInterval = setInterval(() => {
    if (state.side === 'white') state.whiteTime--;
    else state.blackTime--;
    io.in(gameId).emit('clock_update', { whiteTime: state.whiteTime, blackTime: state.blackTime });
    if (state.whiteTime <= 0 || state.blackTime <= 0) {
      const winner = state.side === 'white' ? 'black' : 'white';
      endGame(gameId, 'timeout', winner);
    }
  }, 1000);
}

function broadcastPlayers(gameId: string) {
  const spectators: string[] = [];
  const whitePlayers: string[] = [];
  const blackPlayers: string[] = [];
  const clients = io.sockets.adapter.rooms.get(gameId) || new Set<string>();
  for (const id of clients) {
    const s = io.sockets.sockets.get(id);
    if (!s?.data.name) continue;
    if (s.data.side === 'white') whitePlayers.push(s.data.name);
    else if (s.data.side === 'black') blackPlayers.push(s.data.name);
    else spectators.push(s.data.name);
  }
  io.in(gameId).emit('players', { spectators, whitePlayers, blackPlayers });
}

async function tryFinalizeTurn(gameId: string, state: GameState) {
  if (!state.started || state.ended) return;
  const activeIds = state.side === 'white' ? state.whiteIds : state.blackIds;
  const entries = Array.from(state.proposals.entries()).filter(([id]) => activeIds.has(id));

  if (activeIds.size > 0 && entries.length === activeIds.size) {
    if (state.analysisStopper) state.analysisStopper();

    const candidates = entries.map(([, lan]) => lan);
    let bestMove = candidates[0];
    let bestEval = -Infinity;

    console.log(`[${gameId}] --- Choosing best move for ${state.side} ---`);
    for (const lan of candidates) {
      const analysis = state.analysisResults.get(lan);
      const score = analysis ? analysis.score : -99999;

      if (analysis) {
        console.log(
          `[${gameId}] Candidate ${lan}: Found in analysis. Rank: ${analysis.rank}, Score: ${analysis.score}`,
        );
      } else {
        console.log(
          `[${gameId}] Candidate ${lan}: Not in top ${state.multiPv} analysis. Assigned default score.`,
        );
      }

      if (score > bestEval) {
        bestEval = score;
        bestMove = lan;
      }
    }
    const selLan = bestMove;
    console.log(`[${gameId}] Best move chosen: ${selLan} with score ${bestEval}`);
    console.log(`[${gameId}] --- End of move selection ---`);

    const [selId] = entries.find(([, v]) => v === selLan)!;
    const selName = io.sockets.sockets.get(selId)!.data.name;

    // --- Funky Message Logic ---
    const goodMoves = new Set<string>();
    state.analysisResults.forEach((_v, k) => goodMoves.add(k));

    if (activeIds.size >= 2) {
      const goodProposals = entries.filter(([, lan]) => goodMoves.has(lan));
      const sideName = state.side.charAt(0).toUpperCase() + state.side.slice(1);

      if (goodProposals.length === 0) {
        io.in(gameId).emit('funky_message', {
          message: `The ${sideName} team is having a tough time...`,
        });
      } else if (goodProposals.length === 1) {
        const [heroId] = goodProposals[0];
        const heroName = io.sockets.sockets.get(heroId)!.data.name;
        io.in(gameId).emit('funky_message', {
          message: `${sideName} team, say thanks to ${heroName}, the only one who found a decent move!`,
        });
      }

      const bestAnalysisMove = Array.from(state.analysisResults.entries()).find(
        ([, v]) => v.rank === 1,
      );
      if (
        bestAnalysisMove &&
        selLan === bestAnalysisMove[0] &&
        state.moveNumber > 10 &&
        entries.filter(([, lan]) => lan === selLan).length === 1
      ) {
        io.in(gameId).emit('funky_message', {
          message: `Congrats to ${selName}, they found the computer's best move!`,
        });
      }
    }

    // *** FIX: New, more robust streak update logic ***
    activeIds.forEach(id => {
      const name = io.sockets.sockets.get(id)!.data.name;
      const stats = state.playerStats.get(name)!;
      const proposedMove = state.proposals.get(id)!;

      if (id === selId) {
        // This player made the best move for the team
        stats.bestMoveStreak++;
        stats.badMoveStreak = 0;
        if (activeIds.size >= 2 && [3, 5, 10].includes(stats.bestMoveStreak)) {
          io.in(gameId).emit('funky_message', {
            message: `${name} is on fire! That's ${stats.bestMoveStreak} consecutive best moves for the team!`,
          });
        }
      } else {
        // This player did NOT make the best move for the team
        stats.bestMoveStreak = 0;
        if (!goodMoves.has(proposedMove)) {
          stats.badMoveStreak++;
          if (activeIds.size >= 3 && stats.badMoveStreak === 3) {
            io.in(gameId).emit('funky_message', {
              message: `Watch out ${name}, that's 3 questionable moves in a row...`,
            });
          }
        } else {
          stats.badMoveStreak = 0;
        }
      }
      state.playerStats.set(name, stats);
    });
    // --- End of Funky Message Logic ---

    const move = state.chess.move({ from: selLan.slice(0, 2), to: selLan.slice(2, 4), promotion: selLan[4] });
    if (!move) return;
    const fen = state.chess.fen();

    if (state.side === 'white') state.whiteTime += 5;
    else state.blackTime += 5;
    io.in(gameId).emit('clock_update', { whiteTime: state.whiteTime, blackTime: state.blackTime });

    io.in(gameId).emit('move_selected', { moveNumber: state.moveNumber, side: state.side, name: selName, lan: selLan, san: move.san, fen });

    if (state.chess.isCheckmate()) endGame(gameId, 'checkmate', state.side);
    else if (state.chess.isStalemate()) endGame(gameId, 'stalemate');
    else if (state.chess.isThreefoldRepetition()) endGame(gameId, 'threefold repetition');
    else if (state.chess.isInsufficientMaterial()) endGame(gameId, 'insufficient material');
    else if (state.chess.isDraw()) endGame(gameId, 'draw by rule');
    else {
      state.proposals.clear();
      state.side = state.side === 'white' ? 'black' : 'white';
      state.moveNumber++;
      io.in(gameId).emit('turn_change', { moveNumber: state.moveNumber, side: state.side });
      io.in(gameId).emit('position_update', { fen });
      startClock(gameId);
      startThinking(gameId);
    }
  }
}

io.on('connection', (socket: Socket) => {
  socket.on('create_game', ({ name }, cb) => {
    const gameId = nanoid(6);
    socket.join(gameId);
    socket.data = { name, gameId, side: 'spectator' };
    gameStates.set(gameId, {
      whiteIds: new Set(),
      blackIds: new Set(),
      moveNumber: 1,
      side: 'white',
      proposals: new Map(),
      whiteTime: 600,
      blackTime: 600,
      chess: new Chess(),
      started: false,
      ended: false,
      multiPv: 15,
      playerStats: new Map(),
      analysisResults: new Map(),
    });
    const stats = gameStates.get(gameId)!.playerStats;
    stats.set(name, { bestMoveStreak: 0, badMoveStreak: 0 });
    cb({ gameId });
    broadcastPlayers(gameId);
  });

  socket.on('join_game', ({ gameId, name }, cb) => {
    if (!io.sockets.adapter.rooms.has(gameId)) return cb({ error: 'Game not found.' });
    for (const id of io.sockets.adapter.rooms.get(gameId)!) {
      const s = io.sockets.sockets.get(id);
      if (s?.data.name === name) return cb({ error: 'Name already taken.' });
    }
    socket.join(gameId);
    socket.data = { name, gameId, side: 'spectator' };
    cb({ gameId });
    const state = gameStates.get(gameId);
    if (!state) return;
    state.playerStats.set(name, { bestMoveStreak: 0, badMoveStreak: 0 });
    broadcastPlayers(gameId);
    socket.emit('settings_updated', { multiPv: state.multiPv });
    if (state.started) {
      socket.emit('position_update', { fen: state.chess.fen() });
      socket.emit('clock_update', { whiteTime: state.whiteTime, blackTime: state.blackTime });
      if (state.ended) {
        socket.emit('game_over', { reason: state.endReason, winner: state.endWinner });
      } else {
        socket.emit('game_started', { moveNumber: state.moveNumber, side: state.side });
      }
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
          const winner = wCount > 0 ? 'white' : 'black';
          endGame(gameId, 'timeout or disconnect', winner);
        }
      }
    }
    if (state && state.started && !state.ended && side === 'spectator') {
      if (state.proposals.has(socket.id)) {
        state.proposals.delete(socket.id);
        io.in(gameId).emit('proposal_removed', { moveNumber: state.moveNumber, side: prevSide, name: socket.data.name });
      }
      tryFinalizeTurn(gameId, state);
    }
    broadcastPlayers(gameId);
    cb({ success: true });
  });

  socket.on('start_game', ({ multiPv }, cb) => {
    const gameId = socket.data.gameId as string | undefined;
    if (!gameId) return cb?.();
    const state = gameStates.get(gameId);
    if (!state || state.started) return cb?.();
    const whites = new Set<string>();
    const blacks = new Set<string>();
    for (const id of io.sockets.adapter.rooms.get(gameId)!) {
      const s = io.sockets.sockets.get(id);
      if (s?.data.side === 'white') whites.add(id);
      else if (s?.data.side === 'black') blacks.add(id);
    }
    state.whiteIds = whites;
    state.blackIds = blacks;
    state.started = true;
    state.multiPv = multiPv || 15;
    io.in(gameId).emit('game_started', { moveNumber: 1, side: 'white' });
    io.in(gameId).emit('position_update', { fen: state.chess.fen() });
    startClock(gameId);
    startThinking(gameId);
    cb?.();
  });

  socket.on('change_settings', ({ multiPv }) => {
    const gameId = socket.data.gameId as string | undefined;
    if (!gameId) return;
    const state = gameStates.get(gameId);
    if (!state || state.started) return;
    const newMultiPv = Math.max(1, Math.min(50, multiPv || 15));
    state.multiPv = newMultiPv;
    io.in(gameId).emit('settings_updated', { multiPv: newMultiPv });
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
    io.in(gameId!).emit('move_submitted', { moveNumber: state.moveNumber, side: state.side, name: socket.data.name, lan, san: move.san });
    tryFinalizeTurn(gameId!, state);
    cb({});
  });

  function leave() {
    const gameId = socket.data.gameId as string | undefined;
    if (!gameId) return;
    const state = gameStates.get(gameId);
    if (state) {
      if (state.timerInterval) clearInterval(state.timerInterval);
      state.whiteIds.delete(socket.id);
      state.blackIds.delete(socket.id);
      state.proposals.delete(socket.id);
      state.playerStats.delete(socket.data.name);
      io.in(gameId).emit('proposal_removed', { moveNumber: state.moveNumber, side: state.side, name: socket.data.name });
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
    if (state && !io.sockets.adapter.rooms.has(gameId)) {
      if (state.analysisStopper) state.analysisStopper();
      gameStates.delete(gameId);
    }
  }

  socket.on('exit_game', leave);
  socket.on('disconnect', leave);
});

server.listen(3001, () => console.log('Socket.IO chess server listening on port 3001'));
