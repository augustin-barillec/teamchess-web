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

const PlayedCheck: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-label="Played"
    style={{ color: "var(--color-success)" }}
  >
    <title>Played</title>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const PencilIcon: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    className="pencil-hint"
  >
    <title>Edit name</title>
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </svg>
);

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
  const yesClass =
    "vote-yes-btn" + (kickVote.myCurrentVote === "yes" ? " cast" : "");
  const noClass =
    "vote-no-btn" + (kickVote.myCurrentVote === "no" ? " cast" : "");

  return (
    <div className="kick-vote-wrap">
      <div className="vote-box">
        <div className="vote-box-title">
          {kickVote.amTarget ? UI.kickVoteTargetSelf : UI.kickVoteTargetOther}
        </div>
        <div className="vote-box-meta">
          {kickVote.yesVotes.length}/{kickVote.requiredVotes} &bull; {timeLeft}s
        </div>

        <div className="vote-box-buttons">
          <button
            onClick={() => onSendKickVote("yes")}
            disabled={!canVoteYes}
            className={yesClass}
          >
            Yes ({kickVote.yesVotes.length})
          </button>
          <button
            onClick={() => onSendKickVote("no")}
            disabled={!canVoteNo}
            className={noClass}
          >
            No ({kickVote.noVotes.length})
          </button>
        </div>
        {kickVote.yesVotes.length > 0 && (
          <div className="vote-box-yes-list">
            Yes: {kickVote.yesVotes.join(", ")}
          </div>
        )}
        {kickVote.noVotes.length > 0 && (
          <div className="vote-box-no-list">
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
      <li key={p.id} className="player-list-item-column">
        <div className="player-entry">
          {teamSide && hasPlayed(p.id, teamSide) && (
            <span className="player-icon-slot">
              <PlayedCheck />
            </span>
          )}
          {isMe ? (
            <button className="clickable-name" onClick={openNameModal}>
              <span className="player-name-text">{p.name}</span>
              {p.name === DEFAULT_PLAYER_NAME && <PencilIcon />}
              <span className="player-you-tag">(You)</span>
            </button>
          ) : (
            <span className="player-name-text">{p.name}</span>
          )}
          {disconnected && (
            <span className="player-icon-slot">
              <DisconnectedIcon />
            </span>
          )}
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
        {showJoinControls ? (
          <>
            {renderSection(
              "spectator",
              UI.headingSpectators,
              players.spectators
            )}
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
            {renderSection("white", UI.headingWhite, players.whitePlayers)}
            {renderSection("black", UI.headingBlack, players.blackPlayers)}
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
