import { useState, useEffect, useMemo, useRef, CSSProperties } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { io, Socket } from 'socket.io-client';
import { Chess } from 'chess.js';
import { Chessboard, PieceDropHandlerArgs, PieceHandlerArgs } from 'react-chessboard';
import {
  Players,
  GameInfo,
  Proposal,
  Selection,
  EndReason,
  ChatMessage,
  GameStatus,
  MAX_PLAYERS_PER_GAME,
} from '@teamchess/shared';

// Constants and Helpers
const STORAGE_KEYS = {
  pid: 'tc:pid',
  name: 'tc:name',
  gameId: 'tc:game',
  side: 'tc:side',
} as const;
const reasonMessages: Record<string, (winner: string | null) => string> = {
  [EndReason.Checkmate]: winner =>
    `☑️ Checkmate!\n${winner?.[0].toUpperCase() + winner?.slice(1)} wins!`,
  [EndReason.Stalemate]: () => `🤝 Game drawn by stalemate.`,
  [EndReason.Threefold]: () => `🤝 Game drawn by threefold repetition.`,
  [EndReason.Insufficient]: () => `🤝 Game drawn by insufficient material.`,
  [EndReason.DrawRule]: () => `🤝 Game drawn by rule (e.g. fifty-move).`,
  [EndReason.Resignation]: winner =>
    `🏳️ Resignation!\n${winner?.[0].toUpperCase() + winner?.slice(1)} wins!`,
  [EndReason.DrawAgreement]: () => `🤝 Draw agreed.`,
  [EndReason.Timeout]: winner => `⏱️ Time!\n${winner?.[0].toUpperCase() + winner?.slice(1)} wins!`,
  [EndReason.Abandonment]: winner =>
    `🚫 Forfeit!\n${winner?.[0].toUpperCase() + winner?.slice(1)} wins as the opposing team is empty.`,
};
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

// App Component
export default function App() {
  // Icon Component for Disconnected Status
  const DisconnectedIcon = () => (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        width: '16px',
        height: '16px',
        fill: '#000000',
        verticalAlign: 'middle',
      }}
    >
      <g id="Wi-Fi_Off" data-name="Wi-Fi Off">
        <g>
          <path d="M10.37,6.564a12.392,12.392,0,0,1,10.71,3.93c.436.476,1.141-.233.708-.708A13.324,13.324,0,0,0,10.37,5.564c-.631.076-.638,1.077,0,1Z" />
          <path d="M13.907,10.283A8.641,8.641,0,0,1,18.349,12.9c.434.477,1.139-.232.707-.707a9.586,9.586,0,0,0-4.883-2.871c-.626-.146-.893.818-.266.965Z" />
          <circle cx="12.003" cy="16.922" r="1.12" />
          <path d="M19.773,19.06a.5.5,0,0,1-.71.71l-5.84-5.84A4.478,4.478,0,0,0,8.7,15.24c-.43.48-1.14-.23-.71-.7a5.47,5.47,0,0,1,4.06-1.78l-2.37-2.37a8.693,8.693,0,0,0-4.03,2.53c-.43.48-1.13-.23-.7-.71A9.439,9.439,0,0,1,8.893,9.6L6.883,7.59a12.557,12.557,0,0,0-3.96,2.94.5.5,0,1,1-.7-.71,13.109,13.109,0,0,1,3.91-2.98l-1.9-1.9a.5.5,0,0,1,.71-.71Z" />
        </g>
      </g>
    </svg>
  );
  // State Management
  const [amDisconnected, setAmDisconnected] = useState(false);
  const [socket, setSocket] = useState<Socket>();
  const [myId, setMyId] = useState<string>('');
  // stable pid, not socket.id
  const [name, setName] = useState(sessionStorage.getItem(STORAGE_KEYS.name) || '');
  const [showJoin, setShowJoin] = useState(false);
  const [gameId, setGameId] = useState(sessionStorage.getItem(STORAGE_KEYS.gameId) || '');
  const [joined, setJoined] = useState(false);
  const [side, setSide] = useState<'spectator' | 'white' | 'black'>(
    (sessionStorage.getItem(STORAGE_KEYS.side) as 'spectator' | 'white' | 'black') || 'spectator',
  );
  const [players, setPlayers] = useState<Players>({
    spectators: [],
    whitePlayers: [],
    blackPlayers: [],
  });
  const [gameStatus, setGameStatus] = useState<GameStatus>(GameStatus.Lobby);
  const [winner, setWinner] = useState<'white' | 'black' | null>(null);
  const [endReason, setEndReason] = useState<string | null>(null);
  const [pgn, setPgn] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [turns, setTurns] = useState<
    { moveNumber: number; side: 'white' | 'black'; proposals: Proposal[]; selection?: Selection }[]
  >([]);
  const [chess] = useState(new Chess());
  const [position, setPosition] = useState(chess.fen());
  const [clocks, setClocks] = useState({ whiteTime: 0, blackTime: 0 });
  const [lastMoveSquares, setLastMoveSquares] = useState<{ from: string; to: string } | null>(null);
  const [legalSquareStyles, setLegalSquareStyles] = useState<Record<string, CSSProperties>>({});
  const [drawOffer, setDrawOffer] = useState<'white' | 'black' | null>(null);

  // --- RESPONSIVE BOARD STATE ---
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState(600);

  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      if (entries[0]) {
        setBoardWidth(entries[0].contentRect.width);
      }
    });

    if (boardContainerRef.current) {
      observer.observe(boardContainerRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, []);
  // --- END RESPONSIVE BOARD STATE ---

  // Derived State and Refs
  const movesRef = useRef<HTMLDivElement>(null);
  const current = turns[turns.length - 1];
  const orientation: 'white' | 'black' = side === 'black' ? 'black' : 'white';

  const kingInCheckSquare = useMemo(() => {
    if (!chess.isCheck()) return null;
    const kingPiece = { type: 'k', color: chess.turn() };
    let square: string | null = null;
    chess.board().forEach((row, rowIndex) => {
      row.forEach((piece, colIndex) => {
        if (piece && piece.type === kingPiece.type && piece.color === kingPiece.color) {
          square = `${'abcdefgh'[colIndex]}${8 - rowIndex}`;
        }
      });
    });
    return square;
  }, [position]);
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
    const order = ['P', 'N', 'B', 'R', 'Q', 'K'];
    const values: Record<string, number> = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };

    Object.entries(initial).forEach(([type, count]) => {
      const wCount = currWhite[type] || 0;
      const bCount = currBlack[type] || 0;
      for (let i = 0; i < count - wCount; i++)
        lostW.push({ type, figurine: pieceToFigurineWhite[type] });
      for (let i = 0; i < count - bCount; i++)
        lostB.push({ type, figurine: pieceToFigurineBlack[type] });
    });

    lostW.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    lostB.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    const whiteLostValue = lostW.reduce((sum, p) => sum + values[p.type], 0);
    const blackLostValue = lostB.reduce((sum, p) => sum + values[p.type], 0);
    const materialBalance = blackLostValue - whiteLostValue; // + = White up

    return {
      lostWhitePieces: lostW.map(p => p.figurine),
      lostBlackPieces: lostB.map(p => p.figurine),
      materialBalance,
    };
  }, [position]);

  const playerCount = useMemo(
    () => players.spectators.length + players.whitePlayers.length + players.blackPlayers.length,
    [players],
  );
  // Side Effects
  useEffect(() => {
    if (movesRef.current) movesRef.current.scrollTop = movesRef.current.scrollHeight;
  }, [turns]);
  useEffect(() => {
    if (!myId) return;
    const serverSide = players.whitePlayers.some(p => p.id === myId)
      ? 'white'
      : players.blackPlayers.some(p => p.id === myId)
        ? 'black'
        : 'spectator';
    if (serverSide !== side) {
      setSide(serverSide);
      sessionStorage.setItem(STORAGE_KEYS.side, serverSide);
    }
  }, [players, myId]);
  useEffect(() => {
    const storedPid = sessionStorage.getItem(STORAGE_KEYS.pid) || undefined;
    const storedName = sessionStorage.getItem(STORAGE_KEYS.name) || undefined;

    const s = io('/', {
      auth: { pid: storedPid, name: storedName },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 2000,
      randomizationFactor: 0.2,
    });
    setSocket(s);

    // Browser connectivity
    const onOffline = () => {
      setAmDisconnected(true);
      if (s.connected) s.disconnect();
    };
    const onOnline = () => {
      if (!s.connected) s.connect();
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    // Socket.IO event listeners
    s.on('session', ({ id, name }: { id: string; name: string }) => {
      setMyId(id);
      sessionStorage.setItem(STORAGE_KEYS.pid, id);
      if (name && !sessionStorage.getItem(STORAGE_KEYS.name)) {
        sessionStorage.setItem(STORAGE_KEYS.name, name);
      }
    });

    const showOffline = () => setAmDisconnected(true);
    s.on('connect', () => {
      setAmDisconnected(false);
      const g = sessionStorage.getItem(STORAGE_KEYS.gameId);
      const n = sessionStorage.getItem(STORAGE_KEYS.name) || name || '';
      const rememberedSide =
        (sessionStorage.getItem(STORAGE_KEYS.side) as 'white' | 'black' | 'spectator' | null) ||
        'spectator';
      if (g && n) {
        s.emit('join_game', { gameId: g, name: n }, (res: any) => {
          if (!res?.error) {
            setGameId(g);
            setName(n);
            setJoined(true);
            if (rememberedSide && rememberedSide !== 'spectator') {
              s.emit('join_side', { side: rememberedSide });
            }
          }
        });
      }
    });
    s.on('connect_error', showOffline);
    s.on('reconnect_attempt', showOffline);
    s.on('reconnect', () => setAmDisconnected(false));
    s.on('disconnect', (reason: string) => {
      setAmDisconnected(true);
      if (
        (reason === 'io client disconnect' || reason === 'io server disconnect') &&
        navigator.onLine
      ) {
        setTimeout(() => {
          if (!s.connected) s.connect();
        }, 500);
      }
    });
    s.on('players', (p: Players) => setPlayers(p));
    s.on('game_started', ({ moveNumber, side }: GameInfo) => {
      setGameStatus(GameStatus.Active);
      setWinner(null);
      setEndReason(null);
      setPgn('');
      setTurns([{ moveNumber, side, proposals: [] }]);
      setLastMoveSquares(null);
      setDrawOffer(null);
    });
    s.on('game_reset', () => {
      setGameStatus(GameStatus.Lobby);
      setWinner(null);
      setEndReason(null);
      setPgn('');
      setTurns([]);
      chess.reset();
      setPosition(chess.fen());
      setClocks({ whiteTime: 0, blackTime: 0 });
      setLastMoveSquares(null);
      setDrawOffer(null);
    });
    s.on('clock_update', ({ whiteTime, blackTime }) => setClocks({ whiteTime, blackTime }));
    s.on('position_update', ({ fen }) => {
      chess.load(fen);
      setPosition(fen);
    });
    s.on('move_submitted', (m: Proposal) =>
      setTurns(ts =>
        ts.map(t =>
          t.moveNumber === m.moveNumber && t.side === m.side
            ? { ...t, proposals: [...t.proposals, m] }
            : t,
        ),
      ),
    );
    s.on('move_selected', (sel: Selection) => {
      setTurns(ts =>
        ts.map(t =>
          t.moveNumber === sel.moveNumber && t.side === sel.side ? { ...t, selection: sel } : t,
        ),
      );
      chess.load(sel.fen);
      const from = sel.lan.slice(0, 2);
      const to = sel.lan.slice(2, 4);
      setLastMoveSquares({ from, to });
      setPosition(sel.fen);
    });
    s.on('turn_change', ({ moveNumber, side }: GameInfo) =>
      setTurns(ts => [...ts, { moveNumber, side, proposals: [] }]),
    );
    s.on('proposal_removed', ({ moveNumber, side, id }) => {
      setTurns(ts =>
        ts.map(t =>
          t.moveNumber === moveNumber && t.side === side
            ? { ...t, proposals: t.proposals.filter(p => p.id !== id) }
            : t,
        ),
      );
    });
    s.on(
      'game_over',
      ({ reason, winner, pgn }: { reason: string; winner: string | null; pgn: string }) => {
        setGameStatus(GameStatus.Over);
        setWinner(winner);
        setEndReason(reason);
        setPgn(pgn);
        setDrawOffer(null);
      },
    );
    s.on('chat_message', (msg: ChatMessage) => {
      setChatMessages(msgs => [...msgs, msg]);
    });
    s.on('game_status_update', ({ status }: { status: GameStatus }) => {
      setGameStatus(status);
    });
    s.on('draw_offer_update', ({ side }: { side: 'white' | 'black' | null }) => {
      setDrawOffer(side);
    });
    s.on('merge_success', ({ newGameId }: { newGameId: string }) => {
      setGameId(newGameId);
      sessionStorage.setItem(STORAGE_KEYS.gameId, newGameId);
      setSide('spectator');
      sessionStorage.setItem(STORAGE_KEYS.side, 'spectator');
      setChatMessages([]); // Reset chat for the new lobby
      setGameStatus(GameStatus.Lobby);
    });
    (window as any).socket = s;

    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      s.disconnect();
    };
  }, [chess]);

  // Event Handlers and Functions
  const resetLocalGameState = () => {
    setGameStatus(GameStatus.Lobby);
    setWinner(null);
    setEndReason(null);
    setPgn('');
    setTurns([]);
    chess.reset();
    setPosition(chess.fen());
    setClocks({ whiteTime: 0, blackTime: 0 });
    setLastMoveSquares(null);
    setChatMessages([]);
  };
  const createGame = () => {
    resetLocalGameState();
    if (!name.trim()) return alert('Enter your name.');
    sessionStorage.setItem(STORAGE_KEYS.name, name);
    (window as any).socket.emit('create_game', { name }, ({ gameId }: any) => {
      setGameId(gameId);
      setJoined(true);
      setSide('spectator');
      sessionStorage.setItem(STORAGE_KEYS.gameId, gameId);
      sessionStorage.setItem(STORAGE_KEYS.side, 'spectator');
    });
  };

  const joinGame = () => {
    resetLocalGameState();
    if (!name.trim() || !gameId.trim()) return alert('Enter name & game ID.');
    sessionStorage.setItem(STORAGE_KEYS.name, name);
    (window as any).socket.emit('join_game', { gameId, name }, (res: any) => {
      if (res.error) alert(res.error);
      else {
        setJoined(true);
        setSide('spectator');
        sessionStorage.setItem(STORAGE_KEYS.gameId, gameId);
        sessionStorage.setItem(STORAGE_KEYS.side, 'spectator');
      }
    });
  };

  const exitGame = () => {
    (window as any).socket.emit('exit_game');
    setJoined(false);
    setSide('spectator');
    resetLocalGameState();
    sessionStorage.removeItem(STORAGE_KEYS.gameId);
    sessionStorage.setItem(STORAGE_KEYS.side, 'spectator');
  };
  const joinSide = (s: 'white' | 'black' | 'spectator') =>
    (window as any).socket.emit('join_side', { side: s }, (res: any) => {
      if (res.error) alert(res.error);
      else setSide(s);
      sessionStorage.setItem(STORAGE_KEYS.side, s);
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

  const joinSpectator = () => joinSide('spectator');
  const resignGame = () => {
    if (window.confirm('Are you sure you want to resign in the name of your team?')) {
      (window as any).socket.emit('resign');
    }
  };
  const offerDraw = () => {
    if (window.confirm('Are you sure you want to offer a draw in the name of your team?')) {
      socket?.emit('offer_draw');
    }
  };

  const acceptDraw = () => {
    if (window.confirm('Accept the draw offer in the name of your team?')) {
      socket?.emit('accept_draw');
    }
  };

  const rejectDraw = () => {
    if (window.confirm('Reject the draw offer in the name of your team?')) {
      socket?.emit('reject_draw');
    }
  };
  const startGame = () => (window as any).socket.emit('start_game');
  const findMergeableGame = () => socket?.emit('find_merge');
  const cancelMergeSearch = () => socket?.emit('cancel_merge');
  const resetGame = () => {
    if (window.confirm('Are you sure you want to reset the game?')) {
      const s = socket;
      if (!s) return;
      s.emit('reset_game', (res: { success: boolean; error?: string }) => {
        if (res.error) return alert(res.error);
      });
    }
  };

  function needsPromotion(from: string, to: string) {
    const piece = chess.get(from);
    if (!piece || piece.type !== 'p') return false;
    const rank = to[1];
    return piece.color === 'w' ? rank === '8' : rank === '1';
  }

  const hasPlayed = (playerId: string) => current?.proposals.some(p => p.id === playerId);
  const copyPgn = () => {
    if (!pgn) return;
    const textArea = document.createElement('textarea');
    textArea.value = pgn;
    textArea.style.position = 'absolute';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      const success = document.execCommand('copy');
      toast.success(success ? 'PGN copied!' : 'Copy failed.');
    } catch (err) {
      console.error('Failed to copy PGN:', err);
      toast.error('Could not copy PGN.');
    }
    document.body.removeChild(textArea);
  };
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
      ...(kingInCheckSquare
        ? {
            [kingInCheckSquare]: {
              background:
                'radial-gradient(ellipse at center, rgba(255,0,0,0.5) 0%, rgba(255,0,0,0) 75%)',
            },
          }
        : {}),
    },
    boardWidth: boardWidth, // <-- USE RESPONSIVE STATE
    onPieceDrag: ({ square }: PieceHandlerArgs) => {
      const moves = chess.moves({ square: square, verbose: true });
      const highlights: Record<string, CSSProperties> = {};
      moves.forEach(m => {
        highlights[m.to] = { backgroundColor: 'rgba(0,255,0,0.2)' };
      });
      setLegalSquareStyles(highlights);
    },
    onPieceDragEnd: () => {
      setLegalSquareStyles({});
    },
    onPieceDrop: ({ sourceSquare, targetSquare }: PieceDropHandlerArgs) => {
      setLegalSquareStyles({});
      const from = sourceSquare;
      const to = targetSquare;

      if (gameStatus !== GameStatus.Active || side !== current.side) return false;
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
  // Render Logic
  return (
    <div className="app-container">
      <Toaster position="top-right" />
      <h1>TeamChess</h1>
      {amDisconnected && (
        <div className="offline-banner">
          You’re offline. Try refreshing or wait for auto-reconnect…
        </div>
      )}
      {!joined ? (
        <div>
          <div className="input-group">
            <input
              placeholder="Your name"
              value={name}
              onChange={e => {
                setName(e.target.value);
                sessionStorage.setItem(STORAGE_KEYS.name, e.target.value);
              }}
            />
          </div>
          <div className="input-group">
            <button onClick={createGame}>Create Game</button>
            <button onClick={() => setShowJoin(s => !s)}>Join Game</button>
          </div>
          {showJoin && (
            <div className="input-group">
              <input
                placeholder="Game ID"
                value={gameId}
                onChange={e => setGameId(e.target.value)}
              />
              <button onClick={joinGame}>Submit</button>
            </div>
          )}
        </div>
      ) : (
        <>
          <p className="game-id-bar">
            <strong>Game ID:</strong>
            <input readOnly value={gameId} onFocus={e => e.currentTarget.select()} />
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
            <span style={{ marginLeft: '1.5rem' }}>
              <strong>Players:</strong> {playerCount}/{MAX_PLAYERS_PER_GAME}
            </span>
          </p>

          {gameStatus === GameStatus.Lobby && (
            <div className="lobby-actions">
              {players.whitePlayers.length > 0 && players.blackPlayers.length > 0 && (
                <button onClick={startGame}>Start Game</button>
              )}
              {playerCount < MAX_PLAYERS_PER_GAME && (
                <button onClick={findMergeableGame}>Find More Players</button>
              )}
            </div>
          )}

          {gameStatus === GameStatus.SearchingForMerge && (
            <div className="searching-banner">
              <p style={{ margin: 0 }}>
                🔎 Searching for another team of at most {MAX_PLAYERS_PER_GAME - playerCount}{' '}
                players...
              </p>{' '}
              <button onClick={cancelMergeSearch}>Cancel Search</button>
            </div>
          )}

          {(gameStatus === GameStatus.Active || gameStatus === GameStatus.Over) && (
            <div className="game-actions">
              <button onClick={resetGame}>Reset Game</button>
            </div>
          )}
          {gameStatus !== GameStatus.Over && side === 'spectator' && (
            <div className="side-actions">
              <button onClick={autoAssign}>Auto Assign</button>
              <button onClick={() => joinSide('white')}>Join White</button>
              <button onClick={() => joinSide('black')}>Join Black</button>
            </div>
          )}
          {gameStatus !== GameStatus.Over && (side === 'white' || side === 'black') && (
            <div className="side-actions">
              <button onClick={joinSpectator}>Join Spectators</button>
              {gameStatus === GameStatus.Lobby && (
                <button onClick={() => joinSide(side === 'white' ? 'black' : 'white')}>
                  Switch to {side === 'white' ? 'Black' : 'White'}
                </button>
              )}
              {gameStatus === GameStatus.Active && (
                <>
                  {drawOffer && drawOffer !== side ? (
                    <>
                      <button onClick={acceptDraw}>Accept Draw</button>
                      <button onClick={rejectDraw}>Reject Draw</button>
                    </>
                  ) : drawOffer === side ? (
                    <span style={{ marginLeft: 5, fontStyle: 'italic' }}>Draw offered...</span>
                  ) : (
                    <>
                      <button onClick={resignGame}>Resign</button>
                      <button onClick={offerDraw}>Offer Draw</button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
          <div className="player-lists-container">
            <div>
              <h3>Spectators</h3>
              <ul className="player-list">
                {players.spectators.map(p => {
                  const isMe = p.id === myId;
                  const disconnected = isMe ? amDisconnected : !p.connected;
                  return (
                    <li key={p.id}>
                      {isMe ? <strong>{p.name}</strong> : <span>{p.name}</span>}
                      {disconnected && <DisconnectedIcon />}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              <h3>White</h3>
              <ul className="player-list">
                {players.whitePlayers.map(p => {
                  const isMe = p.id === myId;
                  const disconnected = isMe ? amDisconnected : !p.connected;
                  return (
                    <li key={p.id}>
                      {isMe ? <strong>{p.name}</strong> : <span>{p.name}</span>}
                      {disconnected && <DisconnectedIcon />}
                      {hasPlayed(p.id) && <span>✔️</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              <h3>Black</h3>
              <ul className="player-list">
                {players.blackPlayers.map(p => {
                  const isMe = p.id === myId;
                  const disconnected = isMe ? amDisconnected : !p.connected;
                  return (
                    <li key={p.id}>
                      {isMe ? <strong>{p.name}</strong> : <span>{p.name}</span>}
                      {disconnected && <DisconnectedIcon />}
                      {hasPlayed(p.id) && <span>✔️</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <div className="main-content">
            <div className="main-column">
              {/* This new ref wrapper will be observed for its width */}
              <div ref={boardContainerRef} className="board-wrapper">
                <Chessboard options={boardOptions} />
              </div>
              <div className="clock-container" data-orientation={orientation}>
                <div
                  className={
                    'clock-box ' +
                    (current?.side === 'white' && gameStatus === GameStatus.Active ? 'active' : '')
                  }
                >
                  {String(Math.floor(clocks.whiteTime / 60)).padStart(2, '0')}:
                  {String(clocks.whiteTime % 60).padStart(2, '0')}
                </div>
                <div
                  className={
                    'clock-box ' +
                    (current?.side === 'black' && gameStatus === GameStatus.Active ? 'active' : '')
                  }
                >
                  {String(Math.floor(clocks.blackTime / 60)).padStart(2, '0')}:
                  {String(clocks.blackTime % 60).padStart(2, '0')}
                </div>
              </div>
            </div>

            <div className="sidebar-column">
              {turns.some(t => t.selection) && (
                <div ref={movesRef} className="moves-list">
                  {turns
                    .filter(t => t.selection)
                    .map(t => (
                      <div key={`${t.side}-${t.moveNumber}`} style={{ marginBottom: '0.5rem' }}>
                        <strong>
                          Move {t.moveNumber} ({t.side})
                        </strong>
                        <ul style={{ margin: 4, paddingLeft: '1.2rem' }}>
                          {t.proposals.map(p => {
                            const isSel = t.selection!.lan === p.lan;
                            const fan = p.san ? sanToFan(p.san, t.side) : '';
                            return (
                              <li key={p.id}>
                                {p.id === myId ? <strong>{p.name}</strong> : p.name}:{' '}
                                {isSel ? <span className="moves-list-item">{p.lan}</span> : p.lan}
                                {fan && ` (${fan})`}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                </div>
              )}
              <div className="chat-box-container">
                <div className="chat-messages">
                  {chatMessages
                    .slice()
                    .reverse()
                    .map((msg, idx) => {
                      if (msg.system) {
                        return (
                          <div key={idx} className="chat-message-item system">
                            {msg.message}
                          </div>
                        );
                      }
                      return (
                        <div
                          key={idx}
                          className={
                            'chat-message-item ' + (myId === msg.senderId ? 'own' : 'other')
                          }
                        >
                          {myId === msg.senderId ? (
                            <strong>{msg.sender}:</strong>
                          ) : (
                            <span>{msg.sender}:</span>
                          )}{' '}
                          {msg.message}
                        </div>
                      );
                    })}
                </div>
                <div className="chat-form">
                  <form
                    onSubmit={e => {
                      e.preventDefault();
                      const form = e.target as HTMLFormElement;
                      const input = form.elements.namedItem('chatInput') as HTMLInputElement;
                      const message = input.value;
                      if (message.trim()) {
                        socket?.emit('chat_message', message);
                        input.value = '';
                      }
                    }}
                  >
                    <input
                      type="text"
                      name="chatInput"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck="false"
                      placeholder="Type a message..."
                    />
                  </form>
                </div>
              </div>
            </div>
          </div>

          <div className="material-balance">
            <div className="material-balance-row">
              <span
                className="material-adv-label"
                style={{ visibility: materialBalance === 0 ? 'hidden' : 'visible' }}
              >
                {materialBalance > 0 ? `+${materialBalance}` : ''}
              </span>
              <span>{lostWhitePieces.join(' ')}</span>
            </div>
            <div className="material-balance-row">
              <span
                className="material-adv-label"
                style={{ visibility: materialBalance === 0 ? 'hidden' : 'visible' }}
              >
                {materialBalance < 0 ? `+${-materialBalance}` : ''}
              </span>
              <span>{lostBlackPieces.join(' ')}</span>
            </div>
          </div>
          {gameStatus === GameStatus.Over && (
            <div className="game-over-info">
              <p>
                {endReason && reasonMessages[endReason]
                  ? reasonMessages[endReason](winner)
                  : `🎉 Game over! ${winner?.[0].toUpperCase() + winner?.slice(1)} wins!`}
              </p>
              {pgn && (
                <div>
                  <div className="pgn-header">
                    <strong>PGN</strong>
                    <button onClick={copyPgn}>Copy</button>
                  </div>
                  <pre>{pgn}</pre>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
