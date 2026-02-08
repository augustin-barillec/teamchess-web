import { useState, useEffect } from "react";
import { Players, KickVoteState } from "../types";
import { DisconnectedIcon } from "../DisconnectedIcon";
import { DEFAULT_PLAYER_NAME, UI } from "../messages";

interface PlayersPanelProps {
  activeTab: string;
  players: Players;
  myId: string;
  amDisconnected: boolean;
  openNameModal: () => void;
  hasPlayed: (playerId: string, teamSide: "white" | "black") => boolean;
  kickVote: KickVoteState;
  onStartKickVote: (targetId: string) => void;
  onSendKickVote: (vote: "yes" | "no") => void;
}

function KickVoteBox({
  kickVote,
  onSendKickVote,
}: {
  kickVote: KickVoteState;
  onSendKickVote: (vote: "yes" | "no") => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!kickVote.isActive) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [kickVote.isActive]);

  const timeLeft = Math.max(0, Math.ceil((kickVote.endTime - now) / 1000));

  const canVote = kickVote.myVoteEligible && !kickVote.amTarget;
  const canVoteYes = canVote && kickVote.myCurrentVote !== "yes";
  const canVoteNo = canVote && kickVote.myCurrentVote !== "no";

  return (
    <div style={{ marginTop: "6px", marginBottom: "6px" }}>
      <div
        style={{
          background: "#ebf8ff",
          padding: "10px",
          borderRadius: "6px",
          border: "1px solid #bee3f8",
        }}
      >
        <div style={{ fontWeight: "bold", marginBottom: "5px" }}>
          {kickVote.amTarget ? UI.kickVoteTargetSelf : UI.kickVoteTargetOther}
        </div>
        <div
          style={{
            fontSize: "0.85em",
            color: "#666",
            marginBottom: "10px",
            fontStyle: "italic",
          }}
        >
          Time left: {timeLeft}s &bull; Required: {kickVote.requiredVotes}
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={() => onSendKickVote("yes")}
            disabled={!canVoteYes}
            style={{
              flex: 1,
              background:
                kickVote.myCurrentVote === "yes"
                  ? "#b2f5ea"
                  : canVoteYes
                    ? "#e6fffa"
                    : "#eee",
              borderColor:
                kickVote.myCurrentVote === "yes"
                  ? "#38b2ac"
                  : canVoteYes
                    ? "#38b2ac"
                    : "#ccc",
              color:
                kickVote.myCurrentVote === "yes"
                  ? "#234e52"
                  : canVoteYes
                    ? "#234e52"
                    : "#999",
              fontWeight: "bold",
              cursor: canVoteYes ? "pointer" : "default",
              opacity: canVoteYes || kickVote.myCurrentVote === "yes" ? 1 : 0.6,
            }}
          >
            Yes ({kickVote.yesVotes.length})
          </button>
          <button
            onClick={() => onSendKickVote("no")}
            disabled={!canVoteNo}
            style={{
              flex: 1,
              background:
                kickVote.myCurrentVote === "no"
                  ? "#fed7d7"
                  : canVoteNo
                    ? "#fff5f5"
                    : "#eee",
              borderColor:
                kickVote.myCurrentVote === "no"
                  ? "#fc8181"
                  : canVoteNo
                    ? "#fc8181"
                    : "#ccc",
              color:
                kickVote.myCurrentVote === "no"
                  ? "#742a2a"
                  : canVoteNo
                    ? "#742a2a"
                    : "#999",
              fontWeight: "bold",
              cursor: canVoteNo ? "pointer" : "default",
              opacity: canVoteNo || kickVote.myCurrentVote === "no" ? 1 : 0.6,
            }}
          >
            No ({kickVote.noVotes.length})
          </button>
        </div>
        {kickVote.yesVotes.length > 0 && (
          <div
            style={{ fontSize: "0.8em", marginTop: "6px", color: "#2c7a7b" }}
          >
            Yes: {kickVote.yesVotes.join(", ")}
          </div>
        )}
        {kickVote.noVotes.length > 0 && (
          <div
            style={{ fontSize: "0.8em", marginTop: "2px", color: "#c53030" }}
          >
            No: {kickVote.noVotes.join(", ")}
          </div>
        )}
        {!kickVote.myVoteEligible && !kickVote.amTarget && (
          <div
            style={{
              fontSize: "0.8em",
              marginTop: "8px",
              color: "#555",
              fontStyle: "italic",
            }}
          >
            {UI.voteInProgress}
          </div>
        )}
      </div>
    </div>
  );
}

export const PlayersPanel: React.FC<PlayersPanelProps> = ({
  activeTab,
  players,
  myId,
  amDisconnected,
  openNameModal,
  hasPlayed,
  kickVote,
  onStartKickVote,
  onSendKickVote,
}) => {
  const renderPlayerEntry = (
    p: { id: string; name: string; connected: boolean },
    teamSide?: "white" | "black"
  ) => {
    const isMe = p.id === myId;
    const disconnected = isMe ? amDisconnected : !p.connected;
    const showKickButton = !isMe && !kickVote.isActive;
    const isKickTarget = kickVote.isActive && kickVote.targetId === p.id;

    return (
      <li key={p.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {isMe ? (
            <strong>
              <button className="clickable-name" onClick={openNameModal}>
                {p.name}
                {p.name === DEFAULT_PLAYER_NAME ? " ✏️" : ""}
              </button>
            </strong>
          ) : (
            <span>{p.name}</span>
          )}
          {disconnected && <DisconnectedIcon />}
          {teamSide && hasPlayed(p.id, teamSide) && <span>✔️</span>}
          {showKickButton && (
            <button
              onClick={() => onStartKickVote(p.id)}
              title={UI.kickVoteTooltip(p.name)}
              style={{
                marginLeft: "auto",
                background: "none",
                border: "1px solid #ccc",
                borderRadius: "4px",
                padding: "2px 6px",
                fontSize: "0.75em",
                color: "#999",
                cursor: "pointer",
                lineHeight: 1,
              }}
            >
              {UI.btnKick}
            </button>
          )}
        </div>
        {isKickTarget && (
          <KickVoteBox kickVote={kickVote} onSendKickVote={onSendKickVote} />
        )}
      </li>
    );
  };

  return (
    <div
      className={
        "tab-panel players-panel " + (activeTab === "players" ? "active" : "")
      }
    >
      <h3>{UI.headingPlayers}</h3>
      <div className="player-lists-container">
        <div>
          <h3>{UI.headingSpectators}</h3>
          <ul className="player-list">
            {players.spectators.map((p) => renderPlayerEntry(p))}
          </ul>
        </div>
        <div>
          <h3>{UI.headingWhite}</h3>
          <ul className="player-list">
            {players.whitePlayers.map((p) => renderPlayerEntry(p, "white"))}
          </ul>
        </div>
        <div>
          <h3>{UI.headingBlack}</h3>
          <ul className="player-list">
            {players.blackPlayers.map((p) => renderPlayerEntry(p, "black"))}
          </ul>
        </div>
      </div>
    </div>
  );
};
