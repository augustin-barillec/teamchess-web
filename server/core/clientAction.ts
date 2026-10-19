import type { ClientAction, Side, VoteType } from "../shared_types.js";
import {
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_PLAYER_NAME_LENGTH,
} from "../constants.js";

// What reaches the server is socket.io's decoding of whatever a browser chose to
// send: the ClientAction type describes what a well-behaved client sends, not
// what came in. This is the one place that checks, so everything downstream can
// trust its types — a throw inside a socket handler takes the whole server down —
// and the limits here are what keep one player from growing every broadcast by a
// megabyte, or from ending the game through an enum value nobody declared.

const SIDES: readonly Side[] = ["white", "black", "spectator"];
const VOTE_TYPES: readonly VoteType[] = ["resign", "offer_draw", "accept_draw"];
const BALLOTS = ["yes", "no"] as const;

/** Long algebraic notation as chess.js spells it: two squares, plus a promotion piece. */
const LAN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** A non-empty string of at most `max` UTF-16 units. */
const isText = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;

const isOneOf = <T extends string>(v: unknown, allowed: readonly T[]): v is T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v);

/**
 * Reads a ClientAction out of whatever a client sent, or null when there is none
 * to read. Rebuilt field by field rather than cast, so nothing a client added
 * rides along. Null means drop: an action that fails this is not a mistake worth
 * answering, it is a client that is not running our code.
 */
export function parseClientAction(raw: unknown): ClientAction | null {
  if (!isRecord(raw)) return null;
  const { type, payload } = raw;
  if (type === "RESET_GAME") return { type: "RESET_GAME", payload: null };
  if (!isRecord(payload)) return null;

  switch (type) {
    case "SET_NAME":
      return isText(payload.name, MAX_PLAYER_NAME_LENGTH)
        ? { type: "SET_NAME", payload: { name: payload.name } }
        : null;
    case "JOIN_SIDE":
      return isOneOf(payload.side, SIDES)
        ? { type: "JOIN_SIDE", payload: { side: payload.side } }
        : null;
    case "SUBMIT_MOVE":
      // Anything else would reach Stockfish's stdin verbatim through `searchmoves`.
      return typeof payload.lan === "string" && LAN.test(payload.lan)
        ? { type: "SUBMIT_MOVE", payload: { lan: payload.lan } }
        : null;
    case "START_TEAM_VOTE":
      return isOneOf(payload.voteType, VOTE_TYPES)
        ? { type: "START_TEAM_VOTE", payload: { voteType: payload.voteType } }
        : null;
    case "VOTE_TEAM":
      return isOneOf(payload.vote, BALLOTS)
        ? { type: "VOTE_TEAM", payload: { vote: payload.vote } }
        : null;
    case "SEND_CHAT":
      return isText(payload.message, MAX_CHAT_MESSAGE_LENGTH)
        ? { type: "SEND_CHAT", payload: { message: payload.message } }
        : null;
    case "KICK_PLAYER":
      // Only ever a lookup key: a string of any length finds a player or does not.
      return typeof payload.id === "string"
        ? { type: "KICK_PLAYER", payload: { id: payload.id } }
        : null;
    default:
      return null;
  }
}
