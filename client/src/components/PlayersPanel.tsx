import { Players, Proposal } from "../types";
import { DisconnectedIcon } from "../DisconnectedIcon";

interface PlayersPanelProps {
  activeTab: string;
  players: Players;
  myId: string;
  amDisconnected: boolean;
  openNameModal: () => void;
  hasPlayed: (playerId: string, teamSide: "white" | "black") => boolean;
}

export const PlayersPanel: React.FC<PlayersPanelProps> = ({
  activeTab,
  players,
  myId,
  amDisconnected,
  openNameModal,
  hasPlayed,
}) => {
  return (
    <div
      className={
        "tab-panel players-panel " + (activeTab === "players" ? "active" : "")
      }
    >
      <h3>Players</h3>
      <div className="player-lists-container">
        <div>
          {" "}
          <h3>Spectators</h3>{" "}
          <ul className="player-list">
            {" "}
            {players.spectators.map((p) => {
              const isMe = p.id === myId;
              const disconnected = isMe ? amDisconnected : !p.connected;
              return (
                <li key={p.id}>
                  {" "}
                  {isMe ? (
                    <strong>
                      <button
                        className="clickable-name"
                        onClick={openNameModal}
                      >
                        {p.name}
                        {p.name === "Player" ? " ✏️" : ""}
                      </button>
                    </strong>
                  ) : (
                    <span>{p.name}</span>
                  )}{" "}
                  {disconnected && <DisconnectedIcon />}{" "}
                </li>
              );
            })}{" "}
          </ul>{" "}
        </div>
        <div>
          {" "}
          <h3>White</h3>{" "}
          <ul className="player-list">
            {" "}
            {players.whitePlayers.map((p) => {
              const isMe = p.id === myId;
              const disconnected = isMe ? amDisconnected : !p.connected;
              return (
                <li key={p.id}>
                  {" "}
                  {isMe ? (
                    <strong>
                      <button
                        className="clickable-name"
                        onClick={openNameModal}
                      >
                        {p.name}
                        {p.name === "Player" ? " ✏️" : ""}
                      </button>
                    </strong>
                  ) : (
                    <span>{p.name}</span>
                  )}{" "}
                  {disconnected && <DisconnectedIcon />}{" "}
                  {hasPlayed(p.id, "white") && <span>✔️</span>}{" "}
                </li>
              );
            })}{" "}
          </ul>{" "}
        </div>
        <div>
          {" "}
          <h3>Black</h3>{" "}
          <ul className="player-list">
            {" "}
            {players.blackPlayers.map((p) => {
              const isMe = p.id === myId;
              const disconnected = isMe ? amDisconnected : !p.connected;
              return (
                <li key={p.id}>
                  {" "}
                  {isMe ? (
                    <strong>
                      <button
                        className="clickable-name"
                        onClick={openNameModal}
                      >
                        {p.name}
                        {p.name === "Player" ? " ✏️" : ""}
                      </button>
                    </strong>
                  ) : (
                    <span>{p.name}</span>
                  )}{" "}
                  {disconnected && <DisconnectedIcon />}{" "}
                  {hasPlayed(p.id, "black") && <span>✔️</span>}{" "}
                </li>
              );
            })}{" "}
          </ul>{" "}
        </div>
      </div>
    </div>
  );
};
