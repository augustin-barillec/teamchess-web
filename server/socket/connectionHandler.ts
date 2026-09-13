import type { Server, Socket } from "socket.io";
import { nanoid } from "nanoid";
import { Game, normalizeName, type GameHooks } from "../Game.js";
import { DEFAULT_PLAYER_NAME } from "../shared_messages.js";
import type { ClientAction, ServerEvent } from "../shared_types.js";

/**
 * The transport, and nothing else: sockets in, actions to the game, events out.
 * Every socket joins a room named after its player id, so the game reaches a
 * player without knowing about sockets.
 */
export function attach(io: Server, game: Game): void {
  io.on("connection", (socket: Socket) => {
    const auth = (socket.handshake.auth ?? {}) as {
      pid?: string;
      name?: string;
    };
    // A returning client says who it is; a new one is given an id to keep.
    const pid = typeof auth.pid === "string" && auth.pid ? auth.pid : nanoid();

    // A kick outlives the socket it was served on: the ban is what keeps the
    // kicked player out when they come back with the same id.
    if (game.isBanned(pid)) {
      emit(socket, { type: "KICKED", payload: null });
      socket.disconnect(true);
      return;
    }

    const name = normalizeName(auth.name) ?? DEFAULT_PLAYER_NAME;
    socket.join(pid);
    emit(socket, { type: "SESSION", payload: { id: pid, name } });
    game.join(pid, name);

    socket.on("action", (action: ClientAction) =>
      game.processAction(pid, action)
    );
    socket.on("disconnect", () => game.leave(pid));
  });
}

export function hooksFor(io: Server): GameHooks {
  return {
    broadcast(event) {
      io.emit("event", event);
    },
    send(pid, event) {
      io.to(pid).emit("event", event);
      // Told to go, and gone: a kicked player keeps no socket to hear the game through.
      if (event.type === "KICKED") io.in(pid).disconnectSockets(true);
    },
  };
}

function emit(socket: Socket, event: ServerEvent): void {
  socket.emit("event", event);
}
