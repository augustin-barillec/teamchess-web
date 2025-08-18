// Player and Chat
export interface Player {
  /** Stable player id (pid), not the transient socket.id */
  id: string;
  name: string;
  connected: boolean;
}

export type Players = {
  spectators: Player[];
  whitePlayers: Player[];
  blackPlayers: Player[];
};
export type ChatMessage = {
  sender: string;
  senderId: string; // stable pid
  message: string;
};

// Game Mechanics
export type GameInfo = { moveNumber: number; side: 'white' | 'black' };
export type Proposal = {
  id: string; // stable pid of who proposed
  name: string; // their DISPLAY name
  moveNumber: number;
  side: 'white' | 'black';
  lan: string;
  san?: string;
};
export type Selection = Proposal & { fen: string };

// Game State
export enum GameStatus {
  Lobby = 'Lobby',
  Active = 'Active',
  Over = 'Over',
}

export enum EndReason {
  Checkmate = 'checkmate',
  Stalemate = 'stalemate',
  Threefold = 'threefold repetition',
  Insufficient = 'insufficient material',
  DrawRule = 'draw by rule',
  Resignation = 'resignation',
  DrawAgreement = 'draw by agreement',
  Timeout = 'timeout',
}
