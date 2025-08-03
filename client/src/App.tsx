import { EndReason, GameInfo, Players, Proposal, Selection } from '@teamchess/shared';
import { Chess, Move } from 'chess.js';
import { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { Chessboard, PieceDropHandlerArgs, PieceHandlerArgs } from 'react-chessboard';
import { toast, Toaster } from 'react-hot-toast';
import { io, Socket } from 'socket.io-client';
import Navbar from './components/Navbar';

const reasonMessages: Record<string, (winner: string | null) => string> = {
  [EndReason.Checkmate]: winner =>
    `☑️ Checkmate! ${winner ? winner?.[0].toUpperCase() + winner?.slice(1) : ''} wins!`,
  [EndReason.Stalemate]: () => `🤝 Game drawn by stalemate.`,
  [EndReason.Threefold]: () => `🤝 Game drawn by threefold repetition.`,
  [EndReason.Insufficient]: () => `🤝 Game drawn by insufficient material.`,
  [EndReason.DrawRule]: () => `🤝 Game drawn by rule (e.g. fifty-move).`,
  [EndReason.Resignation]: winner =>
    `🏳️ Resignation! ${winner ? winner?.[0].toUpperCase() + winner?.slice(1) : ''} wins!`,
  [EndReason.DrawAgreement]: () => `🤝 Draw agreed by both players.`,
  [EndReason.Timeout]: winner =>
    `⏱️ Time! ${winner ? winner?.[0].toUpperCase() + winner?.slice(1) : ''} wins!`,
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
  const [theme, setTheme] = useState('auto');
  const [socket, setSocket] = useState<Socket>();
  const [myId, setMyId] = useState<string>('');
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
      proposals: Proposal[]; // ← use Proposal (with id,name,lan,san)
      selection?: Selection;
    }[]
  >([]);
  const [chess] = useState(new Chess());
  const [position, setPosition] = useState(chess.fen());
  const [clocks, setClocks] = useState({ whiteTime: 0, blackTime: 0 });
  // track the last move that got played
  const [lastMoveSquares, setLastMoveSquares] = useState<{ from: string; to: string } | null>(null);
  useState<{ from: string; to: string } | null>(null);
  // track legal move highlights
  const [legalSquareStyles, setLegalSquareStyles] = useState<Record<string, CSSProperties>>({});
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
    setSocket(socket);
    // socket.id is only valid after the initial “connect” event fires:
    socket.on('connect', () => setMyId(socket.id || ''));

    socket.on('players', (p: Players) => setPlayers(p));
    socket.on('game_started', ({ moveNumber, side }: GameInfo) => {
      setGameStarted(true);
      setGameOver(false);
      setWinner(null);
      setEndReason(null);
      setTurns([{ moveNumber, side, proposals: [] }]);
      setLastMoveSquares(null);
    });
    socket.on('game_reset', () => {
      // rewind local UI to pre-start
      setGameStarted(false);
      setGameOver(false);
      setWinner(null);
      setEndReason(null);
      setTurns([]);
      chess.reset();
      setPosition(chess.fen());
      setClocks({ whiteTime: 0, blackTime: 0 });
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
            ? { ...t, proposals: [...t.proposals, m] }
            : t,
        ),
      ),
    );
    socket.on('move_selected', (sel: Selection) => {
      setTurns(ts =>
        ts.map(t =>
          t.moveNumber === sel.moveNumber && t.side === sel.side ? { ...t, selection: sel } : t,
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
    socket.on('proposal_removed', ({ moveNumber, side, id }) => {
      setTurns(ts =>
        ts.map(t =>
          t.moveNumber === moveNumber && t.side === side
            ? {
                ...t,
                proposals: t.proposals.filter(p => p.id !== id),
              }
            : t,
        ),
      );
    });
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
    setGameStarted(false);
    setGameOver(false);
    setWinner(null);
    setEndReason(null);
    setTurns([]);
    chess.reset();
    setPosition(chess.fen());
    setClocks({ whiteTime: 0, blackTime: 0 });
    setLastMoveSquares(null);
    if (!name.trim()) return alert('Enter your name.');
    (window as any).socket.emit('create_game', { name }, ({ gameId }: any) => {
      if (gameId) {
        setGameId(gameId);
        setJoined(true);
      }
    });
  };
  const joinGame = () => {
    setGameStarted(false);
    setGameOver(false);
    setWinner(null);
    setEndReason(null);
    setTurns([]);
    chess.reset();
    setPosition(chess.fen());
    setClocks({ whiteTime: 0, blackTime: 0 });
    setLastMoveSquares(null);
    if (!name.trim() || !gameId.trim()) return alert('Enter name & game ID.');
    (window as any).socket.emit('join_game', { gameId, name }, (res: any) => {
      if (res.error) alert(res.error);
      else setJoined(true);
    });
  };
  const joinSide = (s: 'white' | 'black' | 'spectator') =>
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
  // leave current team and rejoin spectators
  const joinSpectator = () => joinSide('spectator');
  const startGame = () => (window as any).socket.emit('start_game');
  // fires off the server reset, it’ll call us back when done
  const resetGame = () => {
    if (!socket) return;
    socket.emit('reset_game', (res: { success: boolean; error?: string }) => {
      if (res.error) return alert(res.error);
      // otherwise, we’ll get a 'game_reset' event below
    });
  };
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
    const piece = chess.get(from as any);
    if (!piece || piece.type !== 'p') return false;
    const rank = to[1];
    return piece.color === 'w' ? rank === '8' : rank === '1';
  }

  const current = turns[turns.length - 1];
  const orientation: 'white' | 'black' = side === 'black' ? 'black' : 'white';

  const boardOptions = {
    position,
    boardOrientation: orientation,
    squareStyles: {
      ...(lastMoveSquares
        ? {
            [lastMoveSquares.from]: { backgroundColor: 'rgba(245,246,110,0.75)' },
            [lastMoveSquares.to]: { backgroundColor: 'rgba(245,246,110,0.75)' },
          }
        : {}),
      ...legalSquareStyles,
    },
    boardWidth: 600,
    onPieceDrag: ({ square }: PieceHandlerArgs) => {
      if (!square) return;
      // highlight all legal moves for this piece
      const moves = chess.moves({ square: square, verbose: true }) as Move[];
      const highlights: Record<string, CSSProperties> = {};
      moves.forEach(m => {
        highlights[m.to] = { backgroundColor: 'rgba(0,255,0,0.2)' };
      });
      setLegalSquareStyles(highlights);
    },
    onPieceDragEnd: () => {
      // clear highlights when done dragging
      setLegalSquareStyles({});
    },
    onPieceDrop: ({ sourceSquare, targetSquare }: PieceDropHandlerArgs) => {
      setLegalSquareStyles({});
      if (!sourceSquare || !targetSquare) return false;
      const from = sourceSquare;
      const to = targetSquare;

      if (gameOver) return false;
      if (!current || side !== current.side) return false;

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

  const hasPlayed = (playerId: string) => current?.proposals.some(p => p.id === playerId);

  return (
    <>
      <Navbar theme={theme} setTheme={setTheme} />
      <div className="container mt-4">
        <Toaster position="top-right" />
        <h1 className="mb-4">TeamChess</h1>

        {!joined ? (
          <div className="row">
            <div className="col-md-6">
              <div className="mb-3">
                <input
                  type="text"
                  className="form-control"
                  placeholder="Your name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>
              <button className="btn btn-primary" onClick={createGame}>
                Create Game
              </button>
              <button className="btn btn-secondary ms-2" onClick={() => setShowJoin(s => !s)}>
                Join Game
              </button>
              {showJoin && (
                <div className="mt-3">
                  <div className="input-group">
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Game ID"
                      value={gameId}
                      onChange={e => setGameId(e.target.value)}
                    />
                    <button className="btn btn-success" onClick={joinGame}>
                      Submit
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="row">
              <div className="col-md-6">
                <div className="input-group mb-3">
                  <span className="input-group-text">Game ID</span>
                  <input
                    type="text"
                    className="form-control"
                    value={gameId}
                    readOnly
                    onFocus={e => e.currentTarget.select()}
                  />
                  <button
                    className="btn btn-outline-secondary"
                    onClick={() => {
                      navigator.clipboard.writeText(gameId);
                      toast.success('Game ID copied');
                    }}
                  >
                    Copy
                  </button>
                  <button className="btn btn-danger" onClick={exitGame}>
                    Exit Game
                  </button>
                </div>
              </div>
            </div>

            {!gameStarted &&
              !gameOver &&
              players.whitePlayers.length > 0 &&
              players.blackPlayers.length > 0 && (
                <button className="btn btn-primary my-3" onClick={startGame}>
                  Start Game
                </button>
              )}

            {(gameStarted || gameOver) && (
              <div className="my-3">
                <button className="btn btn-warning" onClick={resetGame}>
                  Reset Game
                </button>
              </div>
            )}

            {!gameOver && side === 'spectator' && (
              <div className="my-3">
                <button className="btn btn-info" onClick={autoAssign}>
                  Auto Assign
                </button>
                <button className="btn btn-light ms-2" onClick={() => joinSide('white')}>
                  Join White
                </button>
                <button className="btn btn-dark ms-2" onClick={() => joinSide('black')}>
                  Join Black
                </button>
              </div>
            )}

            {!gameOver && (side === 'white' || side === 'black') && (
              <div className="my-3">
                <button className="btn btn-secondary" onClick={joinSpectator}>
                  Join Spectators
                </button>
              </div>
            )}

            <div className="row">
              <div className="col-md-4">
                <h3>Spectators</h3>
                <ul className="list-group">
                  {players.spectators.map(p => (
                    <li key={p.id} className="list-group-item">
                      {p.id === myId ? <strong>{p.name}</strong> : p.name}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="col-md-4">
                <h3>White</h3>
                <ul className="list-group">
                  {players.whitePlayers.map(p => (
                    <li key={p.id} className="list-group-item">
                      {p.id === myId ? <strong>{p.name}</strong> : p.name}
                      {hasPlayed(p.id) && <span className="ms-2">✔️</span>}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="col-md-4">
                <h3>Black</h3>
                <ul className="list-group">
                  {players.blackPlayers.map(p => (
                    <li key={p.id} className="list-group-item">
                      {p.id === myId ? <strong>{p.name}</strong> : p.name}
                      {hasPlayed(p.id) && <span className="ms-2">✔️</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Board + Timers + Move List */}
            {(gameStarted || gameOver) && (
              <div className="row mt-4">
                <div className="col-lg-8">
                  <div className="d-flex gap-3">
                    <div style={{ flexShrink: 0, width: boardOptions.boardWidth }}>
                      <Chessboard options={boardOptions} />
                    </div>
                    <div
                      className={`d-flex flex-column justify-content-center gap-3 ${
                        orientation === 'white' ? 'flex-column-reverse' : ''
                      }`}
                      style={{ minWidth: 140, height: boardOptions.boardWidth }}
                    >
                      <div
                        className={`p-2 rounded text-center ${
                          current?.side === 'white' && !gameOver
                            ? 'bg-success text-white fw-bold'
                            : 'bg-dark text-white'
                        }`}
                      >
                        {String(Math.floor(clocks.whiteTime / 60)).padStart(2, '0')}:
                        {String(clocks.whiteTime % 60).padStart(2, '0')}
                      </div>
                      <div
                        className={`p-2 rounded text-center ${
                          current?.side === 'black' && !gameOver
                            ? 'bg-success text-white fw-bold'
                            : 'bg-dark text-white'
                        }`}
                      >
                        {String(Math.floor(clocks.blackTime / 60)).padStart(2, '0')}:
                        {String(clocks.blackTime % 60).padStart(2, '0')}
                      </div>
                    </div>
                  </div>
                </div>
                {turns.some(t => t.selection) && (
                  <div
                    className="col-lg-4"
                    ref={movesRef}
                    style={{
                      height: boardOptions.boardWidth * 0.5,
                      overflowY: 'auto',
                    }}
                  >
                    <div className="card">
                      <div className="card-body">
                        {turns
                          .filter(t => t.selection)
                          .map(t => (
                            <div key={`${t.side}-${t.moveNumber}`} className="mb-3">
                              <strong>
                                Move {t.moveNumber} ({t.side})
                              </strong>
                              <ul className="list-unstyled">
                                {t.proposals.map(p => {
                                  const isSel = t.selection!.lan === p.lan;
                                  const fan = p.san ? sanToFan(p.san, t.side) : '';
                                  return (
                                    <li key={p.id}>
                                      {p.id === myId ? <strong>{p.name}</strong> : p.name}:{' '}
                                      {isSel ? (
                                        <span className="text-success">{p.lan}</span>
                                      ) : (
                                        p.lan
                                      )}
                                      {fan && (
                                        <>
                                          {' '}
                                          (<span className="piece-figurine">{fan}</span>)
                                        </>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {(gameStarted || gameOver) && (
              <div className="mt-3 fs-4">
                <div className="d-flex align-items-center">
                  <span
                    className="me-2"
                    style={{
                      minWidth: '3ch',
                      textAlign: 'right',
                      visibility: materialBalance === 0 ? 'hidden' : 'visible',
                    }}
                  >
                    {materialBalance > 0 ? `+${materialBalance}` : ''}
                  </span>
                  <span className="piece-figurine">{lostWhitePieces.join(' ')}</span>
                </div>
                <div className="d-flex align-items-center">
                  <span
                    className="me-2"
                    style={{
                      minWidth: '3ch',
                      textAlign: 'right',
                      visibility: materialBalance === 0 ? 'hidden' : 'visible',
                    }}
                  >
                    {materialBalance < 0 ? `+${-materialBalance}` : ''}
                  </span>
                  <span className="piece-figurine">{lostBlackPieces.join(' ')}</span>
                </div>
              </div>
            )}

            {gameOver && (
              <div className="mt-4 fs-5">
                <p>
                  {endReason && reasonMessages[endReason]
                    ? reasonMessages[endReason](winner)
                    : `🎉 Game over! ${
                        winner ? winner?.[0].toUpperCase() + winner?.slice(1) : ''
                      } wins!`}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
