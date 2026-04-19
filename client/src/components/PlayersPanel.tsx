import { useState, useEffect } from "react";
import { Players, KickVoteState, GameStatus } from "../types";
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
  /** Desktop-only: when provided, renders join/auto-assign controls in section headings. */
  showJoinControls?: boolean;
  side?: "white" | "black" | "spectator";
  gameStatus?: GameStatus;
  joinSide?: (target: "white" | "black" | "spectator") => void;
  autoAssign?: () => void;
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
          {kickVote.yesVotes.length}/{kickVote.requiredVotes} &bull; {timeLeft}s
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
  showJoinControls = false,
  side,
  gameStatus,
  joinSide,
  autoAssign,
}) => {
  const isSetup = gameStatus === GameStatus.Setup;
  const canJoin = (target: "white" | "black" | "spectator") => {
    if (!showJoinControls) return false;
    if (!gameStatus || gameStatus === GameStatus.Over) return false;
    if (side === target) return false;
    if (
      (target === "white" || target === "black") &&
      side !== "spectator" &&
      !isSetup
    )
      return false;
    return true;
  };
  const showAutoAssign =
    showJoinControls &&
    gameStatus !== undefined &&
    gameStatus !== GameStatus.Over &&
    side === "spectator";
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          {isMe ? (
            <button className="clickable-name" onClick={openNameModal}>
              {p.name}
              {p.name === DEFAULT_PLAYER_NAME ? " ✏️" : ""} (You)
            </button>
          ) : (
            <span>{p.name}</span>
          )}
          {disconnected && <DisconnectedIcon />}
          {teamSide && hasPlayed(p.id, teamSide) && <span>✔️</span>}
          {showKickButton && (
            <button
              className="kick-btn"
              onClick={() => onStartKickVote(p.id)}
              title={UI.kickVoteTooltip(p.name)}
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

  const renderSection = (
    target: "white" | "black" | "spectator",
    label: string,
    list: { id: string; name: string; connected: boolean }[]
  ) => {
    const joinable = canJoin(target);
    const teamSide = target === "spectator" ? undefined : target;
    return (
      <div className="player-section">
        <div className="player-section-heading">
          <h3>{label}</h3>
          {joinable && joinSide && (
            <button className="join-btn" onClick={() => joinSide(target)}>
              {UI.btnJoin}
            </button>
          )}
        </div>
        <ul className="player-list">
          {list.map((p) => renderPlayerEntry(p, teamSide))}
        </ul>
      </div>
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
        {showAutoAssign && autoAssign && (
          <button
            className="auto-assign-btn"
            onClick={autoAssign}
            title={UI.tooltipAutoAssign}
            aria-label={UI.tooltipAutoAssign}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m16 3 4 4-4 4" />
              <path d="M20 7H4" />
              <path d="m8 21-4-4 4-4" />
              <path d="M4 17h16" />
            </svg>
          </button>
        )}
        {showJoinControls ? (
          <>
            {renderSection("white", UI.headingWhite, players.whitePlayers)}
            {renderSection("black", UI.headingBlack, players.blackPlayers)}
            {renderSection(
              "spectator",
              UI.headingSpectators,
              players.spectators
            )}
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
};
