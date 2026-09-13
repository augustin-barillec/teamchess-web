export interface Engine {
  send: (command: string, callback?: (output: string) => void) => void;
  quit: () => void;
}

export type { PlayerSide, Side } from "./shared_types.js";
export { GameStatus, EndReason } from "./shared_types.js";
