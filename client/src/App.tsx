import React, { useState, useEffect } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { io } from 'socket.io-client';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { Players, GameInfo, Proposal, Selection, EndReason } from '@teamchess/shared';
import { DarkThemeToggle } from 'flowbite-react';
import {
  Button,
  Drawer,
  DrawerHeader,
  DrawerItems,
  Sidebar,
  SidebarItem,
  SidebarItemGroup,
  SidebarItems,
  TextInput,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
} from 'flowbite-react';

import { Avatar } from 'flowbite-react';

const reasonMessages: Record<string, (winner: string | null) => string> = {
  [EndReason.Checkmate]: winner =>
    winner ? `☑️ Checkmate! ${winner[0].toUpperCase() + winner.slice(1)} wins!` : `☑️ Checkmate!`,
  [EndReason.Stalemate]: () => `🤝 Game drawn by stalemate.`,
  [EndReason.Threefold]: () => `🤝 Game drawn by threefold repetition.`,
  [EndReason.Insufficient]: () => `🤝 Game drawn by insufficient material.`,
  [EndReason.DrawRule]: () => `🤝 Game drawn by rule (e.g. fifty-move).`,
  [EndReason.Resignation]: winner =>
    winner
      ? `🏳️ Resignation! ${winner[0].toUpperCase() + winner.slice(1)} wins!`
      : `🏳️ Resignation!`,
  [EndReason.DrawAgreement]: () => `🤝 Draw agreed by both players.`,
  [EndReason.Timeout]: winner =>
    winner ? `⏱️ Time! ${winner[0].toUpperCase() + winner.slice(1)} wins!` : `⏱️ Time!`,
};

// helper for FAN
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

  useEffect(() => {
    const socket = io();

    socket.on('players', (p: Players) => setPlayers(p));
    socket.on('game_started', ({ moveNumber, side }: GameInfo) => {
      setGameStarted(true);
      setGameOver(false);
      setWinner(null);
      setEndReason(null);
      setTurns([{ moveNumber, side, proposals: [] }]);
    });
    socket.on('clock_update', ({ whiteTime, blackTime }) => setClocks({ whiteTime, blackTime }));
    socket.on('position_update', ({ fen }) => {
      chess.load(fen);
      setPosition(fen);
    });
    socket.on('move_submitted', (m: Proposal & { san?: string }) =>
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
      chess.load(sel.fen);
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
    if (!name.trim()) return toast.error('Enter your name.');
    (window as any).socket.emit('create_game', { name }, ({ gameId }: any) => {
      setGameId(gameId);
      setJoined(true);
    });
  };
  const joinGame = () => {
    if (!name.trim() || !gameId.trim()) return toast.error('Enter name & game ID.');
    (window as any).socket.emit('join_game', { gameId, name }, (res: any) => {
      if (res.error) toast.error(res.error);
      else setJoined(true);
    });
  };
  const joinSide = (s: 'white' | 'black') =>
    (window as any).socket.emit('join_side', { side: s }, (res: any) => {
      if (res.error) toast.error(res.error);
      else setSide(s);
    });
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
  };

  function needsPromotion(from: string, to: string) {
    const piece = chess.get(from as any);
    if (!piece || piece.type !== 'p') return false;
    const rank = to[1];
    return piece.color === 'w' ? rank === '8' : rank === '1';
  }

  const current = turns[turns.length - 1];
  const orientation: 'white' | 'black' = side === 'black' ? 'black' : 'white';

  const [isOpen, setIsOpen] = useState(false);

  const handleClose = () => setIsOpen(false);

  return (
    <main className="flex min-h-screen flex-col bg-white dark:bg-gray-900">
      <Toaster position="top-right" containerStyle={{ top: 100 }} />
      <nav className="fixed top-0 z-50 w-full bg-white border-b border-gray-200 dark:bg-gray-800 dark:border-gray-700">
        <div className="px-3 py-3 lg:px-5 lg:pl-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center justify-start rtl:justify-end">
              <Button
                onClick={() => setIsOpen(isOpen => !isOpen)}
                className="inline-flex items-center p-2 text-sm text-gray-500 rounded-lg  hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600"
                data-drawer-target="drawer-navigation"
                data-drawer-show="drawer-navigation"
                aria-controls="drawer-navigation"
              >
                {isOpen ? (
                  <svg
                    aria-hidden
                    className="h-4 w-4"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-6 h-6"
                    aria-hidden="true"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      clipRule="evenodd"
                      fillRule="evenodd"
                      d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm0 10.5a.75.75 0 01.75-.75h7.5a.75.75 0 010 1.5h-7.5a.75.75 0 01-.75-.75zM2 10a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 10z"
                    ></path>
                  </svg>
                )}
              </Button>
            </div>
            <a className="flex ms-2 md:me-2">
              <img
                src="image-4R-rT4Z0seWx7j4Zk7yD.png"
                className="h-15 me-3"
                alt="TeamChess Logo"
              />
              <span className="self-center text-xl font-semibold sm:text-2xl whitespace-nowrap dark:text-white">
                TeamChess
              </span>
            </a>
            <div className="flex items-center">
              <DarkThemeToggle />
              <div className="flex items-center ms-3">
                <div>
                  <Button
                    className="flex text-sm bg-gray-800 rounded-full focus:ring-4 focus:ring-gray-300 dark:focus:ring-gray-600"
                    aria-expanded="false"
                    data-dropdown-toggle="dropdown-user"
                  >
                    <span className="sr-only">Open user menu</span>
                    <img
                      className="w-8 h-8 rounded-full"
                      src="https://flowbite.com/docs/images/people/profile-picture-5.jpg"
                      alt="user photo"
                    />
                  </Button>
                </div>
                <div
                  className="z-50 hidden my-4 text-base list-none bg-white divide-y divide-gray-100 rounded-sm shadow-sm dark:bg-gray-700 dark:divide-gray-600"
                  id="dropdown-user"
                >
                  <div className="px-4 py-3" role="none">
                    <p className="text-sm text-gray-900 dark:text-white" role="none">
                      Neil Sims
                    </p>
                    <p
                      className="text-sm font-medium text-gray-900 truncate dark:text-gray-300"
                      role="none"
                    >
                      neil.sims@flowbite.com
                    </p>
                  </div>
                  <ul className="py-1" role="none">
                    <li>
                      <a
                        href="#"
                        className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600 dark:hover:text-white"
                        role="menuitem"
                      >
                        Dashboard
                      </a>
                    </li>
                    <li>
                      <a
                        href="#"
                        className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600 dark:hover:text-white"
                        role="menuitem"
                      >
                        Settings
                      </a>
                    </li>
                    <li>
                      <a
                        href="#"
                        className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600 dark:hover:text-white"
                        role="menuitem"
                      >
                        Earnings
                      </a>
                    </li>
                    <li>
                      <a
                        href="#"
                        className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600 dark:hover:text-white"
                        role="menuitem"
                      >
                        Sign out
                      </a>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <Drawer
        open={isOpen}
        onClose={handleClose}
        className="fixed top-15 left-0 z40 w-64 h-screen bg-white dark:bg-gray-800"
      >
        <DrawerItems>
          <Sidebar>
            <SidebarItemGroup>
              <SidebarItem href="/">
                <a
                  href="#"
                  className="flex items-center p-2 text-gray-900 rounded-lg dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 group"
                >
                  <svg
                    className="w-5 h-5 text-gray-500 transition duration-75 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-white"
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="currentColor"
                    viewBox="0 0 22 21"
                  >
                    <path d="M16.975 11H10V4.025a1 1 0 0 0-1.066-.998 8.5 8.5 0 1 0 9.039 9.039.999.999 0 0 0-1-1.066h.002Z" />
                    <path d="M12.5 0c-.157 0-.311.01-.565.027A1 1 0 0 0 11 1.02V10h8.975a1 1 0 0 0 1-.935c.013-.188.028-.374.028-.565A8.51 8.51 0 0 0 12.5 0Z" />
                  </svg>
                  <span className="ms-3">Dashboard</span>
                </a>
              </SidebarItem>
              <SidebarItem href="/about">
                <a
                  href="#"
                  className="flex items-center p-2 text-gray-900 rounded-lg dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 group"
                >
                  <svg
                    className="shrink-0 w-5 h-5 text-gray-500 transition duration-75 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-white"
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="currentColor"
                    viewBox="0 0 20 18"
                  >
                    <path d="M14 2a3.963 3.963 0 0 0-1.4.267 6.439 6.439 0 0 1-1.331 6.638A4 4 0 1 0 14 2Zm1 9h-1.264A6.957 6.957 0 0 1 15 15v2a2.97 2.97 0 0 1-.184 1H19a1 1 0 0 0 1-1v-1a5.006 5.006 0 0 0-5-5ZM6.5 9a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM8 10H5a5.006 5.006 0 0 0-5 5v2a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-2a5.006 5.006 0 0 0-5-5Z" />
                  </svg>
                  <span className="flex-1 ms-3 whitespace-nowrap">Users</span>
                </a>
              </SidebarItem>
              <SidebarItem href="/contact">Contact</SidebarItem>
            </SidebarItemGroup>
          </Sidebar>
        </DrawerItems>
      </Drawer>

      <div className="flex flex-col items-center justify-center flex-1 p-4">
        {!joined ? (
          <form className="flex flex-col items-center gap-4">
            <div>
              <TextInput
                placeholder="Your name"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>
            <div className="flex row-start-20 gap-4">
              <Button onClick={createGame} disabled={showJoin}>
                Create Game
              </Button>
              <Button onClick={() => setShowJoin(s => !s)}>Join Game</Button>
            </div>

            {showJoin && (
              <div className="flex row-start-20 gap-4">
                <TextInput
                  placeholder="Game ID"
                  value={gameId}
                  onChange={e => setGameId(e.target.value)}
                />
                <Button onClick={joinGame}>Submit</Button>
              </div>
            )}
          </form>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="flex row-start-20 gap-4">
              <Label>Game ID</Label>
              <TextInput
                placeholder="Game ID"
                value={gameId}
                readOnly
                onFocus={e => e.currentTarget.select()}
              />
              <Button
                onClick={async () => {
                  const promise = navigator.clipboard.writeText(gameId);
                  toast.promise(promise, {
                    loading: 'Copying ...',
                    success: 'Game ID copied to clipboard',
                    error: 'Failed to copy Game ID',
                  });
                }}
              >
                Copy
              </Button>

              <Button onClick={exitGame}>Exit Game</Button>
            </div>

            {!gameStarted &&
              !gameOver &&
              players.whitePlayers.length > 0 &&
              players.blackPlayers.length > 0 && <Button onClick={startGame}>Start Game</Button>}

            {!gameOver && side === 'spectator' && (
              <div className="flex row-start-20 gap-4">
                <Button onClick={() => joinSide('white')}>Join White</Button>
                <Button onClick={() => joinSide('black')}>Join Black</Button>
              </div>
            )}

            <Table className="border border-gray-400">
              <TableHead>
                <TableRow>
                  <TableHeadCell>Spectators</TableHeadCell>
                  <TableHeadCell>White</TableHeadCell>
                  <TableHeadCell>Black</TableHeadCell>
                </TableRow>
              </TableHead>
              <TableBody className="divide-y">
                <TableRow className="bg-white dark:border-gray-700 dark:bg-gray-800">
                  <TableCell>
                    {players.spectators.map(n => (
                      <p key={n}>{n === name ? <strong>{n}</strong> : n}</p>
                    ))}
                  </TableCell>
                  <TableCell>
                    {players.whitePlayers.map(n => (
                      <p key={n}>{n === name ? <strong>{n}</strong> : n}</p>
                    ))}
                  </TableCell>
                  <TableCell>
                    {players.blackPlayers.map(n => (
                      <p key={n}>{n === name ? <strong>{n}</strong> : n}</p>
                    ))}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>

            {/* Board + side timers */}
            {(gameStarted || gameOver) && (
              <div>
                <div>
                  <Chessboard
                    position={position}
                    boardOrientation={orientation}
                    onPieceDrop={(from, to) => {
                      if (gameOver) return false;
                      if (side !== current.side) return false;
                      let promotion;
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
                    }}
                  />
                </div>

                {/* Timers */}
                <div>
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

            {gameOver && (
              <div style={{ marginTop: 20, fontSize: '1.2em' }}>
                <p>
                  {endReason && reasonMessages[endReason]
                    ? reasonMessages[endReason](winner)
                    : `🎉 Game over! ${
                        winner ? winner[0].toUpperCase() + winner.slice(1) + ' wins!' : ''
                      }`}
                </p>
              </div>
            )}

            <div style={{ marginTop: 40 }}>
              {[...turns].reverse().map(t => (
                <div key={`${t.side}-${t.moveNumber}`} style={{ marginBottom: 15 }}>
                  <strong>
                    Move {t.moveNumber} ({t.side})
                  </strong>

                  <ul>
                    {t.proposals.map(p => {
                      const isSelected = t.selection?.lan === p.lan;
                      const fan = p.san ? sanToFan(p.san, t.side) : '';
                      return (
                        <li key={`${t.side}-${t.moveNumber}-${p.name}`}>
                          {p.name === name ? <strong>{p.name}</strong> : p.name}:{' '}
                          {isSelected ? <strong>{p.lan}</strong> : p.lan}
                          {fan && ` (${fan})`}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
