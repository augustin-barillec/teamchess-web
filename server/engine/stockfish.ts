import { Engine } from "../types.js";
import { stockfishPath, STOCKFISH_SEARCH_DEPTH } from "../constants.js";
import { loadEngine } from "./engine-loader.js";

export function createEngine(): Engine {
  const engine = loadEngine(stockfishPath);
  engine.send("uci");
  return engine;
}

export async function chooseBestMove(
  engine: Engine,
  fen: string,
  candidates: string[]
): Promise<string> {
  if (new Set(candidates).size === 1) {
    return candidates[0];
  }
  return new Promise<string>((resolve) => {
    engine.send(`position fen ${fen}`);
    const goCommand = `go depth ${STOCKFISH_SEARCH_DEPTH} searchmoves ${candidates.join(
      " "
    )}`;
    engine.send(goCommand, (output: string) => {
      if (output.startsWith("bestmove")) {
        resolve(output.split(" ")[1]);
      }
    });
  });
}
