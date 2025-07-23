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
  DrawerItems,
  Sidebar,
  SidebarItem,
  SidebarItemGroup,
  TextInput,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  Timeline,
  TimelineBody,
  TimelineContent,
  TimelineItem,
  TimelinePoint,
  TimelineTitle,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Dropdown,
  DropdownDivider,
  DropdownItem,
  Avatar,
  AvatarGroup,
} from 'flowbite-react';

import { HiCalendar } from 'react-icons/hi';
const avatars = [
  'dog.png',
  'giraffe.png',
  'man_2.png',
  'man.png',
  'panda.png',
  'profile.png',
  'rabbit.png',
  'user.png',
  'woman_2.png',
  'woman.png',
];

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
  K: '♔ [King]',
  Q: '♕ [Queen]',
  R: '♖ [Rook]',
  B: '♗ [Bishop]',
  N: '♘ [Knight]',
  P: '♙ [Pawn]',
};
const pieceToFigurineBlack: Record<string, string> = {
  K: '♚ [King]',
  Q: '♛ [Queen]',
  R: '♜ [Rook]',
  B: '♝ [Bishop]',
  N: '♞ [Knight]',
  P: '♟ [Pawn]',
};

function sanToFan(san: string, side: 'white' | 'black'): string {
  const map = side === 'white' ? pieceToFigurineWhite : pieceToFigurineBlack;
  return san.replace(/[KQRBNP]/g, m => map[m]);
}

export default function App() {
  const [randomAvatar, setRandomAvatar] = useState<[{ name: string; avatar: string }]>([
    {
      name: 'Anonymous',
      avatar: '',
    },
  ]);
  const getRandomAvatar = (name: string) => {
    const randomIndex = Math.floor(Math.random() * avatars.length);
    const user = { name: name, avatar: avatars[randomIndex] };
    avatar = avatars[randomIndex];

    const checkAvatarExistence = randomAvatar.some(({ name }) => user.name === name);
    if (checkAvatarExistence) {
      return;
    }
    randomAvatar.push(user);
    setRandomAvatar(randomAvatar);
  };

  const [name, setName] = useState('');
  var [avatar, setAvatar] = useState('');
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
  const [openModal, setOpenModal] = useState(true);

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
    getRandomAvatar(name);
    if (!name.trim()) return toast.error('Enter your name.');

    (window as any).socket.emit('create_game', { name, avatar }, ({ gameId }: any) => {
      setGameId(gameId);
      setJoined(true);
    });
  };
  const joinGame = () => {
    getRandomAvatar(name);
    if (!name.trim() || !gameId.trim()) return toast.error('Enter name & game ID.');
    (window as any).socket.emit('join_game', { gameId, name, avatar }, (res: any) => {
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
    <main className="flex min-h-screen flex-col  bg-sky-700 dark:bg-gray-900">
      <Toaster position="top-right" containerStyle={{ top: 100 }} />
      <nav className="fixed top-0 z-50 w-full bg-sky-500 border-b border-gray-200 dark:bg-gray-800 dark:border-gray-700">
        <div className="px-3 py-3 lg:px-5 lg:pl-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center justify-start rtl:justify-end">
              <Button
                onClick={() => setIsOpen(isOpen => !isOpen)}
                className="bg-slate-600 dark:bg-slate-500 text-white hover:bg-slate-700 dark:hover:bg-slate-600 focus:ring-4 focus:ring-slate-300 dark:focus:ring-slate-600 rounded-lg p-2 me-2"
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
                  <Dropdown
                    label=""
                    dismissOnClick={false}
                    renderTrigger={() => (
                      <div className="flex flex-wrap gap-2">
                        <AvatarGroup>
                          {players.blackPlayers.map(n =>
                            n ? (
                              <div>
                                {
                                  <Avatar
                                    img={'/avatars/' + n.substring(n.indexOf(':') + 1)}
                                    alt={n.substring(0, n.indexOf(':'))}
                                    title={n.substring(0, n.indexOf(':'))}
                                    rounded
                                    stacked
                                    status="online"
                                  />
                                }
                              </div>
                            ) : (
                              ''
                            ),
                          )}
                          {players.whitePlayers.map(n =>
                            n ? (
                              <div>
                                {
                                  <Avatar
                                    img={'/avatars/' + n.substring(n.indexOf(':') + 1)}
                                    alt={n.substring(0, n.indexOf(':'))}
                                    rounded
                                    stacked
                                    status="online"
                                  />
                                }
                              </div>
                            ) : (
                              ''
                            ),
                          )}
                          {players.spectators.map(n =>
                            n ? (
                              <div>
                                {
                                  <Avatar
                                    img={'/avatars/' + n.substring(n.indexOf(':') + 1)}
                                    alt={n.substring(0, n.indexOf(':'))}
                                    rounded
                                    stacked
                                    status="online"
                                  />
                                }
                              </div>
                            ) : (
                              ''
                            ),
                          )}
                        </AvatarGroup>
                      </div>
                    )}
                  >
                    <span className="sr-only">Open user menu</span>

                    <DropdownItem>Dashboard</DropdownItem>
                    <DropdownItem>Settings</DropdownItem>
                    <DropdownItem>Earnings</DropdownItem>
                    <DropdownDivider />
                    <DropdownItem>Separated link</DropdownItem>
                  </Dropdown>
                </div>
                <div
                  className="z-50 hidden my-4 text-base list-none bg-white divide-y divide-gray-100 rounded-sm  dark:bg-gray-700 dark:divide-gray-600"
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
                <p className="flex items-center text-gray-900 rounded-lg dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 w-full group">
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
                </p>
              </SidebarItem>
              <SidebarItem href="/about">
                <p className="flex items-center text-gray-900 rounded-lg dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 w-full group">
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
                </p>
              </SidebarItem>
              <SidebarItem href="/contact">Contact</SidebarItem>
            </SidebarItemGroup>
          </Sidebar>
        </DrawerItems>
      </Drawer>

      <div className="flex-1 p-4 mt-25 bg-sky-700 dark:bg-gray-900">
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
          <div className="items-center gap-4 p-4 rounded-lg">
            <div className="grid grid-cols-3 gap-4 bg-slate-300 dark:bg-slate-500 p-4 m-4 rounded-lg">
              <div className="grid grid-cols-3 gap-4 items-center justify-center">
                <Label className="text-right mt-3 mr-20">Game ID</Label>
                <TextInput
                  className="w-full"
                  placeholder="Game ID"
                  value={gameId}
                  readOnly
                  onFocus={e => e.currentTarget.select()}
                />
              </div>
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

              <div className="grid grid-cols-2 gap-4 items-center justify-center">
                {!gameOver && side === 'spectator' && (
                  <div className="flex flex-col items-center">
                    <Button onClick={() => joinSide('white')}>Join White</Button>
                  </div>
                )}
                {!gameOver && side === 'spectator' && (
                  <div className="flex flex-col items-center">
                    <Button onClick={() => joinSide('black')}>Join Black</Button>
                  </div>
                )}
                {!gameStarted &&
                  !gameOver &&
                  players.whitePlayers.length > 0 &&
                  players.blackPlayers.length > 0 && (
                    <div className="flex flex-col items-center col-span-2 justify-center w-full">
                      <Button className="w-1/3" onClick={startGame}>
                        Start Game
                      </Button>
                    </div>
                  )}
              </div>

              <div className="grid rounded-lg col-span-2 p-4">
                <Table className="">
                  <TableHead>
                    <TableRow className="text-center bg-gray-200 dark:bg-gray-700">
                      <TableHeadCell>Spectators</TableHeadCell>
                      <TableHeadCell>White</TableHeadCell>
                      <TableHeadCell>Black</TableHeadCell>
                    </TableRow>
                  </TableHead>
                  <TableBody className="divide-y">
                    <TableRow className="bg-white dark:border-gray-700 dark:bg-gray-800">
                      <TableCell>
                        {players.spectators.map(n => (
                          <div className="flex justify-center items-center gap-4" key={n}>
                            <Avatar
                              img={'/avatars/' + n.substring(n.indexOf(':') + 1)}
                              alt={n.substring(0, n.indexOf(':'))}
                              title={n.substring(0, n.indexOf(':'))}
                              rounded
                              stacked
                              status="online"
                            />
                            {n.substring(0, n.indexOf(':'))}
                          </div>
                        ))}
                      </TableCell>
                      <TableCell>
                        {players.whitePlayers.map(n => (
                          <div className="flex justify-center items-center gap-4" key={n}>
                            <Avatar
                              img={'/avatars/' + n.substring(n.indexOf(':') + 1)}
                              alt={n.substring(0, n.indexOf(':'))}
                              title={n.substring(0, n.indexOf(':'))}
                              rounded
                              stacked
                              status="online"
                            />
                            {n.substring(0, n.indexOf(':'))}
                          </div>
                        ))}
                      </TableCell>
                      <TableCell>
                        {players.blackPlayers.map(n => (
                          <div className="flex justify-center items-center gap-4" key={n}>
                            <Avatar
                              img={'/avatars/' + n.substring(n.indexOf(':') + 1)}
                              alt={n.substring(0, n.indexOf(':'))}
                              title={n.substring(0, n.indexOf(':'))}
                              rounded
                              stacked
                              status="online"
                            />
                            {n.substring(0, n.indexOf(':'))}
                          </div>
                        ))}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
            {/* Board + side timers */}
            {(gameStarted || gameOver) && (
              <div
                id="game"
                className="p-4 m-4 rounded-lg grid grid-cols-4 gap-4 bg-slate-300 dark:bg-slate-500"
              >
                {/* Timers */}
                <div
                  id="timers"
                  className="grid gap-4 mt-4 p-4 rounded-lg  items-center justify-center"
                >
                  <div className="clock justify-center items-center">
                    <div className="timers">
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
                        return (
                          <div className={t.side}>
                            <h2>{t.side.toUpperCase()}</h2>
                            <div className="display">
                              <span id={t.side + '-time'}>
                                {' '}
                                {String(Math.floor(t.time / 60)).padStart(2, '0')}:
                                {String(t.time % 60).padStart(2, '0')}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="clock-base"></div>
                    <div className="clock-base"></div>
                  </div>
                </div>
                <div id="board" className="grid col-span-2 gap-4 mt-4 items-center justify-center">
                  <Chessboard
                    boardWidth={window.innerWidth < 1200 ? 600 : 1000}
                    position={position}
                    boardOrientation={orientation}
                    onPieceDrop={(from, to) => {
                      if (gameOver) return false;
                      if (side !== current.side) return false;
                      let promotion;
                      if (needsPromotion(from, to)) {
                        const choice = prompt('Promote pawn to (q, r, b, n)', 'q');
                        if (!choice || !['q', 'r', 'b', 'n'].includes(choice)) {
                          toast.error('Invalid promotion piece. Move canceled.');
                          return false;
                        }
                        promotion = choice as 'q' | 'r' | 'b' | 'n';
                      }
                      const m = chess.move({ from, to, promotion });
                      if (m) {
                        chess.undo();
                        const lan = from + to + (m.promotion || '');
                        (window as any).socket.emit('play_move', lan, (res: any) => {
                          if (res?.error) toast.error(res.error);
                        });
                        return true;
                      }
                      return false;
                    }}
                  />
                </div>
                <div className="grid gap-4 mt-4 p-10 rounded-lg max-h-11/12 overflow-y-scroll">
                  <Timeline className="mt-4 text-md">
                    {[...turns].reverse().map(t =>
                      t.proposals.map(p => {
                        const isSelected = t.selection?.lan === p.lan;
                        const fan = p.san ? sanToFan(p.san, t.side) : '';
                        return (
                          <TimelineItem>
                            <TimelinePoint icon={HiCalendar} />
                            <TimelineContent>
                              <TimelineTitle>
                                Move {t.moveNumber} ({t.side}) : {p.name}
                              </TimelineTitle>
                              {isSelected && (
                                <TimelineBody>
                                  <p className="text-gray-500 dark:text-gray-400 font-size:20px">
                                    Selected move :{' '}
                                    {isSelected ? (
                                      <strong>
                                        {p.lan.substring(0, 2).toUpperCase()} to{' '}
                                        {p.lan.substring(2, 4).toUpperCase()}
                                      </strong>
                                    ) : (
                                      p.lan
                                    )}
                                  </p>
                                  <p className="text-gray-500 dark:text-gray-400">
                                    Piece moved :{' '}
                                    <span className="text-lg">
                                      {t.moveNumber !== 1 && t.moveNumber !== 2 && fan
                                        ? ' ' + fan.substring(0, fan.length - 2).toUpperCase()
                                        : 'dont know'}
                                    </span>
                                  </p>
                                </TimelineBody>
                              )}
                            </TimelineContent>
                          </TimelineItem>
                        );
                      }),
                    )}
                  </Timeline>
                </div>
              </div>
            )}

            {gameOver && (
              <p>
                <Button hidden={true} onClick={() => setOpenModal(true)} />{' '}
                {/* Hidden button to trigger modal */}
                <Modal dismissible show={openModal} onClose={() => setOpenModal(false)}>
                  <ModalHeader>It's done !</ModalHeader>
                  <ModalBody>
                    <div className="flex justify-center items-center mb-4 text-emerald-700 dark:text-emerald-500 text-2xl">
                      {endReason && reasonMessages[endReason]
                        ? reasonMessages[endReason](winner)
                        : `🎉 Game over! ${
                            winner ? winner[0].toUpperCase() + winner.slice(1) + ' wins!' : ''
                          }`}
                    </div>
                  </ModalBody>
                  <ModalFooter>
                    <Button onClick={() => setOpenModal(false)}>Close</Button>
                  </ModalFooter>
                </Modal>
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
