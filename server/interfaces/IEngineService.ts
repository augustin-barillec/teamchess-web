import type { Engine } from "../types.js";
import { STOCKFISH_SEARCH_DEPTH } from "../constants.js";

/**
 * Interface for chess engine operations.
 * Abstracts Stockfish integration for testability.
 */
export interface IEngineService {
  /**
   * Chooses the best move from a list of candidates.
   * @param fen Current board position in FEN notation
   * @param candidates Array of candidate moves in LAN format (e.g., "e2e4")
   * @returns Promise resolving to the best move in LAN format
   */
  chooseBestMove(fen: string, candidates: string[]): Promise<string>;

  /**
   * Shuts down the engine.
   */
  quit(): void;
}

/**
 * Production implementation wrapping the Stockfish engine.
 */
export class StockfishEngineService implements IEngineService {
  constructor(private engine: Engine) {}

  async chooseBestMove(fen: string, candidates: string[]): Promise<string> {
    // If all candidates are the same, return immediately
    if (new Set(candidates).size === 1) {
      return candidates[0];
    }

    return new Promise<string>((resolve) => {
      this.engine.send(`position fen ${fen}`);
      const goCommand = `go depth ${STOCKFISH_SEARCH_DEPTH} searchmoves ${candidates.join(" ")}`;

      this.engine.send(goCommand, (output: string) => {
        if (output.startsWith("bestmove")) {
          resolve(output.split(" ")[1]);
        }
      });
    });
  }

  quit(): void {
    this.engine.quit();
  }
}
