export type Players = {
  spectators: string[];
  whitePlayers: string[];
  blackPlayers: string[];
};

export type GameInfo = { moveNumber: number; side: 'white' | 'black' };
export type Proposal = {
  moveNumber: number;
  side: 'white' | 'black';
  name: string;
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
