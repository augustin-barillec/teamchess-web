import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { io } from 'socket.io-client';
import { Chess } from 'chess.js';
import { Chessboard, PieceDropHandlerArgs } from 'react-chessboard';
import { Players, GameInfo, Proposal, Selection, EndReason } from '@teamchess/shared';

const reasonMessages: Record<string, (winner: string | null) => string> = {
  [EndReason.Checkmate]: winner =>
    `☑️ Checkmate! ${winner?.[0].toUpperCase() + winner?.slice(1)} wins!`,
  [EndReason.Stalemate]: () => `🤝 Game drawn by stalemate.`,
  [EndReason.Threefold]: () => `🤝 Game drawn by threefold repetition.`,
  [EndReason.Insufficient]: () => `🤝 Game drawn by insufficient material.`,
  [EndReason.DrawRule]: () => `🤝 Game drawn by rule (e.g. fifty-move).`,
  [EndReason.Resignation]: winner =>
    `🏳️ Resignation! ${winner?.[0].toUpperCase() + winner?.slice(1)} wins!`,
  [EndReason.DrawAgreement]: () => `🤝 Draw agreed by both players.`,
  [EndReason.Timeout]: winner => `⏱️ Time! ${winner?.[0].toUpperCase() + winner?.slice(1)} wins!`,
};

// helper for FAN
const pieceToFigurineWhite: Record<string, string> = {
  K: '♔',
  Q: '♕',
  R: '♖',
  B: '♗',
  N: '♘',
  P: '♙',
};
const pieceToFigurineBlack: Record<string, string> = {
  K: '♚',
  Q: '♛',
  R: '♜',
  B: '♝',
  N: '♞',
  P: '♟',
};

function sanToFan(san: string, side: 'white' | 'black'): string {
  const map = side === 'white' ? pieceToFigurineWhite : pieceToFigurineBlack;
  return san.replace(/[KQRBNP]/g, m => map[m]);
}

export default function App() {
  const [name, setName] = useState('');
  const [showJoin, setShowJoin] = useState(false);
  const [gameId, setGameId] = useState('');
  const [joined, setJoined] = useState(false);
  const [side, setSide] = useState<'spectator' | 'white' | 'black'>('spectator');
  const [players, setPlayers] = useState<Players>({
    spectators: [],
    whitePlayers: [],
    blackPlayers: [],
  });
  const [gameStarted, setGameStarted] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState<'white' | 'black' | null>(null);
  const [endReason, setEndReason] = useState<string | null>(null);
  const [turns, setTurns] = useState<
    {
      moveNumber: number;
      side: 'white' | 'black';
      proposals: { name: string; lan: string; san?: string }[];
      selection?: { name: string; lan: string; san?: string; fen: string };
    }[]
  >([]);
  const [chess] = useState(new Chess());
  const [position, setPosition] = useState(chess.fen());
  const [clocks, setClocks] = useState({ whiteTime: 0, blackTime: 0 });
  // track the last move that got played
  const [lastMoveSquares, setLastMoveSquares] = useState<{ from: string; to: string } | null>(null);
  // compute lost material for each side, sorted by type
  const { lostWhitePieces, lostBlackPieces, materialBalance } = useMemo(() => {
    const initial: Record<string, number> = { P: 8, N: 2, B: 2, R: 2, Q: 1, K: 1 };
    const currWhite: Record<string, number> = { P: 0, N: 0, B: 0, R: 0, Q: 0, K: 0 };
    const currBlack: Record<string, number> = { P: 0, N: 0, B: 0, R: 0, Q: 0, K: 0 };
    chess
      .board()
      .flat()
      .forEach(piece => {
        if (piece) {
          const type = piece.type.toUpperCase();
          if (piece.color === 'w') currWhite[type]++;
          else currBlack[type]++;
        }
      });
    const lostW: { type: string; figurine: string }[] = [];
    const lostB: { type: string; figurine: string }[] = [];
    Object.entries(initial).forEach(([type, count]) => {
      const wCount = currWhite[type] || 0;
      const bCount = currBlack[type] || 0;
      for (let i = 0; i < count - wCount; i++) {
        lostW.push({ type, figurine: pieceToFigurineWhite[type] });
      }
      for (let i = 0; i < count - bCount; i++) {
        lostB.push({ type, figurine: pieceToFigurineBlack[type] });
      }
    });
    const order = ['P', 'N', 'B', 'R', 'Q', 'K'];
    lostW.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    lostB.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    // piece values:
    const values: Record<string, number> = {
      P: 1,
      N: 3,
      B: 3,
      R: 5,
      Q: 9,
      K: 0,
    };

    // numeric totals of lost material
    const whiteLostValue = lostW.reduce((sum, p) => sum + values[p.type], 0);
    const blackLostValue = lostB.reduce((sum, p) => sum + values[p.type], 0);

    // positive = White is up; negative = Black is up
    const materialBalance = blackLostValue - whiteLostValue;
    return {
      lostWhitePieces: lostW.map(p => p.figurine),
      lostBlackPieces: lostB.map(p => p.figurine),
      materialBalance,
    };
  }, [position]);

  const movesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (movesRef.current) {
      movesRef.current.scrollTop = movesRef.current.scrollHeight;
    }
  }, [turns]);

  useEffect(() => {
    const socket = io();

    socket.on('players', (p: Players) => setPlayers(p));
    socket.on('game_started', ({ moveNumber, side }: GameInfo) => {
      setGameStarted(true);
      setGameOver(false);
      setWinner(null);
      setEndReason(null);
      setTurns([{ moveNumber, side, proposals: [] }]);
      setLastMoveSquares(null);
    });
    socket.on('clock_update', ({ whiteTime, blackTime }) => setClocks({ whiteTime, blackTime }));
    socket.on('position_update', ({ fen }) => {
      chess.load(fen);
      setPosition(fen);
    });
    socket.on('move_submitted', (m: Proposal) =>
      setTurns(ts =>
        ts.map(t =>
          t.moveNumber === m.moveNumber && t.side === m.side
            ? {
                ...t,
                proposals: [...t.proposals, { name: m.name, lan: m.lan, san: m.san }],
              }
            : t,
        ),
      ),
    );
    socket.on('move_selected', (sel: Selection & { san?: string }) => {
      setTurns(ts =>
        ts.map(t =>
          t.moveNumber === sel.moveNumber && t.side === sel.side
            ? {
                ...t,
                selection: { name: sel.name, lan: sel.lan, san: sel.san, fen: sel.fen },
              }
            : t,
        ),
      );
      // remember the last move squares
      chess.load(sel.fen);
      const from = sel.lan.slice(0, 2);
      const to = sel.lan.slice(2, 4);
      setLastMoveSquares({ from, to });
      setPosition(sel.fen);
    });
    socket.on('turn_change', ({ moveNumber, side }: GameInfo) =>
      setTurns(ts => [...ts, { moveNumber, side, proposals: [] }]),
    );
    socket.on(
      'proposal_removed',
      ({
        moveNumber,
        side,
        name,
      }: {
        moveNumber: number;
        side: 'white' | 'black';
        name: string;
      }) => {
        setTurns(ts =>
          ts.map(t =>
            t.moveNumber === moveNumber && t.side === side
              ? {
                  ...t,
                  proposals: t.proposals.filter(p => p.name !== name),
                }
              : t,
          ),
        );
      },
    );
    socket.on('game_over', ({ reason, winner }) => {
      setGameOver(true);
      setWinner(winner);
      setEndReason(reason);
    });

    (window as any).socket = socket;
    return () => {
      socket.disconnect();
    };
  }, [chess]);

  const createGame = () => {
    if (!name.trim()) return alert('Enter your name.');
    (window as any).socket.emit('create_game', { name }, ({ gameId }: any) => {
      setGameId(gameId);
      setJoined(true);
    });
  };
  const joinGame = () => {
    if (!name.trim() || !gameId.trim()) return alert('Enter name & game ID.');
    (window as any).socket.emit('join_game', { gameId, name }, (res: any) => {
      if (res.error) alert(res.error);
      else setJoined(true);
    });
  };
  const joinSide = (s: 'white' | 'black') =>
    (window as any).socket.emit('join_side', { side: s }, (res: any) => {
      if (res.error) alert(res.error);
      else setSide(s);
    });
  const autoAssign = () => {
    const whiteCount = players.whitePlayers.length;
    const blackCount = players.blackPlayers.length;
    let chosen: 'white' | 'black';

    if (whiteCount < blackCount) chosen = 'white';
    else if (blackCount < whiteCount) chosen = 'black';
    else chosen = Math.random() < 0.5 ? 'white' : 'black';

    joinSide(chosen);
  };
  const startGame = () => (window as any).socket.emit('start_game');
  const exitGame = () => {
    (window as any).socket.emit('exit_game');
    setJoined(false);
    setSide('spectator');
    setGameStarted(false);
    setGameOver(false);
    setWinner(null);
    setEndReason(null);
    setTurns([]);
    chess.reset();
    setPosition(chess.fen());
    setClocks({ whiteTime: 0, blackTime: 0 });
    setLastMoveSquares(null);
  };

  function needsPromotion(from: string, to: string) {
    const piece = chess.get(from);
    if (!piece || piece.type !== 'p') return false;
    const rank = to[1];
    return piece.color === 'w' ? rank === '8' : rank === '1';
  }

  const current = turns[turns.length - 1];
  const orientation: 'white' | 'black' = side === 'black' ? 'black' : 'white';

  const boardOptions = {
    position,
    boardOrientation: orientation,
    squareStyles: lastMoveSquares
      ? {
          [lastMoveSquares.from]: { backgroundColor: 'rgba(245,246,110,0.75)' },
          [lastMoveSquares.to]: { backgroundColor: 'rgba(245,246,110,0.75)' },
        }
      : {},
    boardWidth: 600,
    onPieceDrop: ({ sourceSquare, targetSquare }: PieceDropHandlerArgs) => {
      const from = sourceSquare;
      const to = targetSquare;

      if (gameOver) return false;
      if (side !== current.side) return false;

      let promotion: 'q' | 'r' | 'b' | 'n' | undefined;
      if (needsPromotion(from, to)) {
        const choice = prompt('Promote pawn to (q, r, b, n)', 'q');
        if (!choice || !['q', 'r', 'b', 'n'].includes(choice)) {
          alert('Invalid promotion piece. Move canceled.');
          return false;
        }
        promotion = choice as 'q' | 'r' | 'b' | 'n';
      }

      const m = chess.move({ from, to, promotion });
      if (m) {
        chess.undo();
        const lan = from + to + (m.promotion || '');
        (window as any).socket.emit('play_move', lan, (res: any) => {
          if (res?.error) alert(res.error);
        });
        return true;
      }
      return false;
    },
  };

  const hasPlayed = (playerName: string) => current?.proposals.some(p => p.name === playerName);

  return (
    <div style={{ padding: 20, fontFamily: 'sans-serif' }}>
      <Toaster position="bottom-right" />
      <h1>TeamChess</h1>

      {!joined ? (
        <div>
          {/* Name input */}
          <div>
            <input placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
          </div>

          {/* Buttons */}
          <div style={{ marginTop: 5 }}>
            <button onClick={createGame}>Create Game</button>
            <button onClick={() => setShowJoin(s => !s)} style={{ marginLeft: 5 }}>
              Join Game
            </button>
          </div>

          {/* Join form */}
          {showJoin && (
            <div style={{ marginTop: 5 }}>
              <input
                placeholder="Game ID"
                value={gameId}
                onChange={e => setGameId(e.target.value)}
              />
              <button onClick={joinGame} style={{ marginLeft: 5 }}>
                Submit
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <p style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <strong>Game ID:</strong>
            <input
              style={{ width: gameId.length + 'ch' }}
              value={gameId}
              readOnly
              onFocus={e => e.currentTarget.select()}
            />
            <button
              onClick={() => {
                const input = document.createElement('input');
                input.value = gameId;
                document.body.appendChild(input);
                input.select();
                try {
                  const success = document.execCommand('copy');
                  toast.success(success ? 'Game ID copied' : 'Copy failed');
                } catch {
                  toast.error('Copy not supported');
                }
                document.body.removeChild(input);
              }}
            >
              Copy
            </button>

            <button onClick={exitGame}>Exit Game</button>
          </p>

          {!gameStarted &&
            !gameOver &&
            players.whitePlayers.length > 0 &&
            players.blackPlayers.length > 0 && <button onClick={startGame}>Start Game</button>}

          {!gameOver && side === 'spectator' && (
            <div style={{ marginTop: 10 }}>
              <button onClick={autoAssign} style={{ marginLeft: 5 }}>
                Auto Assign
              </button>
              <button onClick={() => joinSide('white')}>Join White</button>
              <button onClick={() => joinSide('black')} style={{ marginLeft: 5 }}>
                Join Black
              </button>
            </div>
          )}

          <div
            style={{
              display: 'flex',
              gap: '2rem',
            }}
          >
            <div>
              <h3>Spectators</h3>
              <ul>
                {players.spectators.map(n => (
                  <li key={n}>{n === name ? <strong>{n}</strong> : n}</li>
                ))}
              </ul>
            </div>
            {/* White */}
            <div>
              <h3>White</h3>
              <ul>
                {players.whitePlayers.map(n => (
                  <li key={n} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {n === name ? <strong>{n}</strong> : n}
                    {hasPlayed(n) && <span aria-label="played">✔️</span>}
                  </li>
                ))}
              </ul>
            </div>

            {/* Black */}
            <div>
              <h3>Black</h3>
              <ul>
                {players.blackPlayers.map(n => (
                  <li key={n} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {n === name ? <strong>{n}</strong> : n}
                    {hasPlayed(n) && <span aria-label="played">✔️</span>}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Board + side timers */}
          {(gameStarted || gameOver) && (
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: 20 }}>
              <div style={{ flexShrink: 0, width: boardOptions.boardWidth }}>
                <Chessboard options={boardOptions} />
              </div>

              {/* Timers */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: orientation === 'white' ? 'column-reverse' : 'column',
                  gap: '1rem',
                  fontFamily: 'monospace',
                  fontSize: '2.2rem',
                  minWidth: 140,
                }}
              >
                {[
                  {
                    side: 'white' as const,
                    time: clocks.whiteTime,
                  },
                  {
                    side: 'black' as const,
                    time: clocks.blackTime,
                  },
                ].map(t => {
                  const active = current?.side === t.side && !gameOver;
                  return (
                    <div
                      key={t.side}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        background: active ? '#3a5f0b' : '#333',
                        color: '#fff',
                        fontWeight: active ? 'bold' : 'normal',
                        textAlign: 'center',
                      }}
                    >
                      {String(Math.floor(t.time / 60)).padStart(2, '0')}:
                      {String(t.time % 60).padStart(2, '0')}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {(gameStarted || gameOver) && (
            <div style={{ marginTop: 10, fontSize: '2rem' }}>
              {/* White’s lost‐pieces row */}
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span
                  style={{
                    display: 'inline-block',
                    minWidth: '2ch', // reserve two character‑widths
                    marginRight: '0.5rem',
                    fontSize: '0.75em',
                    textAlign: 'right',
                    visibility: materialBalance === 0 ? 'hidden' : 'visible',
                  }}
                >
                  {materialBalance > 0 ? `+${materialBalance}` : ''}
                </span>
                <span>{lostWhitePieces.join(' ')}</span>
              </div>

              {/* Black’s lost‐pieces row */}
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span
                  style={{
                    display: 'inline-block',
                    minWidth: '2ch',
                    marginRight: '0.5rem',
                    fontSize: '0.75em',
                    textAlign: 'right',
                    visibility: materialBalance === 0 ? 'hidden' : 'visible',
                  }}
                >
                  {materialBalance < 0 ? `+${-materialBalance}` : ''}
                </span>
                <span>{lostBlackPieces.join(' ')}</span>
              </div>
            </div>
          )}

          {gameOver && (
            <div style={{ marginTop: 20, fontSize: '1.2em' }}>
              <p>
                {endReason && reasonMessages[endReason]
                  ? reasonMessages[endReason](winner)
                  : `🎉 Game over! ${winner?.[0].toUpperCase() + winner?.slice(1)} wins!`}
              </p>
            </div>
          )}
          <div
            ref={movesRef}
            style={{
              marginTop: 20,
              height: '160px', // fits ~4 turns comfortably; adjust if your font/padding change
              overflowY: 'auto',
              border: '1px solid #ccc',
              padding: '8px',
              background: '#fafafa',
            }}
          >
            {turns.slice(-4).map(t => (
              <div key={`${t.side}-${t.moveNumber}`} style={{ marginBottom: '0.5rem' }}>
                <strong>
                  Move {t.moveNumber} ({t.side})
                </strong>
                <ul style={{ margin: 4, paddingLeft: '1.2rem' }}>
                  {t.proposals.map(p => {
                    const isSel = t.selection?.lan === p.lan;
                    const fan = p.san ? sanToFan(p.san, t.side) : '';
                    return (
                      <li key={`${t.side}-${t.moveNumber}-${p.name}`}>
                        {p.name === name ? <strong>{p.name}</strong> : p.name}:{' '}
                        {isSel ? <strong>{p.lan}</strong> : p.lan}
                        {fan && ` (${fan})`}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
