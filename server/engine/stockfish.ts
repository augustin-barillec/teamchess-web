import path from "path";
import { fileURLToPath } from "url";
import { Engine } from "../types.js";
import { stockfishPath, STOCKFISH_SEARCH_DEPTH } from "../constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const engineLoaderPath = path.resolve(__dirname, "../load_engine.cjs");

let loadEngine: (path: string) => Engine;

export async function initEngineLoader(): Promise<void> {
  const module = await import(engineLoaderPath);
  loadEngine = module.default;
}

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
