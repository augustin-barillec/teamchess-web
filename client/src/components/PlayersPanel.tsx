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
          background: "var(--color-vote-bg)",
          padding: "10px",
          borderRadius: "6px",
          border: "1px solid var(--color-vote-border)",
        }}
      >
        <div style={{ fontWeight: "bold", marginBottom: "5px" }}>
          {kickVote.amTarget ? UI.kickVoteTargetSelf : UI.kickVoteTargetOther}
        </div>
        <div
          style={{
            fontSize: "0.85em",
            color: "var(--color-text-tertiary)",
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
                  ? "var(--color-vote-yes-bg-active)"
                  : canVoteYes
                    ? "var(--color-vote-yes-bg)"
                    : "var(--color-vote-disabled-bg)",
              borderColor:
                kickVote.myCurrentVote === "yes"
                  ? "var(--color-vote-yes-border)"
                  : canVoteYes
                    ? "var(--color-vote-yes-border)"
                    : "var(--color-vote-disabled-border)",
              color:
                kickVote.myCurrentVote === "yes"
                  ? "var(--color-vote-yes-text)"
                  : canVoteYes
                    ? "var(--color-vote-yes-text)"
                    : "var(--color-vote-disabled-text)",
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
                  ? "var(--color-vote-no-bg-active)"
                  : canVoteNo
                    ? "var(--color-vote-no-bg)"
                    : "var(--color-vote-disabled-bg)",
              borderColor:
                kickVote.myCurrentVote === "no"
                  ? "var(--color-vote-no-border)"
                  : canVoteNo
                    ? "var(--color-vote-no-border)"
                    : "var(--color-vote-disabled-border)",
              color:
                kickVote.myCurrentVote === "no"
                  ? "var(--color-vote-no-text)"
                  : canVoteNo
                    ? "var(--color-vote-no-text)"
                    : "var(--color-vote-disabled-text)",
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
            style={{
              fontSize: "0.8em",
              marginTop: "6px",
              color: "var(--color-vote-yes-label)",
            }}
          >
            Yes: {kickVote.yesVotes.join(", ")}
          </div>
        )}
        {kickVote.noVotes.length > 0 && (
          <div
            style={{
              fontSize: "0.8em",
              marginTop: "2px",
              color: "var(--color-vote-no-label)",
            }}
          >
            No: {kickVote.noVotes.join(", ")}
          </div>
        )}
        {!kickVote.myVoteEligible && !kickVote.amTarget && (
          <div
            style={{
              fontSize: "0.8em",
              marginTop: "8px",
              color: "var(--color-text-secondary)",
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
                border: "1px solid var(--color-border-primary)",
                borderRadius: "4px",
                padding: "2px 6px",
                fontSize: "0.75em",
                color: "var(--color-vote-disabled-text)",
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
