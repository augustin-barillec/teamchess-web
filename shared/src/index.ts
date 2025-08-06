export interface Player {
  id: string;
  name: string;
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
};

export type GameInfo = { moveNumber: number; side: 'white' | 'black' };

export type Proposal = {
  id: string; // socket.id of who proposed
  name: string; // their DISPLAY name
  moveNumber: number;
  side: 'white' | 'black';
  lan: string;
  san?: string;
};
export type Selection = Proposal & { fen: string };

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
