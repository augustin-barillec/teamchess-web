export interface Player {
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
  senderId: string;
  message: string;
  system?: boolean;
};

export const MAX_PLAYERS_PER_GAME = 10;
export enum GameVisibility {
  Public = 'Public',
  Private = 'Private',
  Closed = 'Closed',
}

export type GameInfo = {
  moveNumber: number;
  side: 'white' | 'black';
  visibility?: GameVisibility;
};
export type Proposal = {
  id: string;
  name: string;
  moveNumber: number;
  side: 'white' | 'black';
  lan: string;
  san?: string;
};

export type Selection = Proposal & { fen: string };
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
  Abandonment = 'abandonment',
}
