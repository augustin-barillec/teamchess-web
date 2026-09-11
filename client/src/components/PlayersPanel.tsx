import { useState } from "react";
import { Player, Players, GameStatus } from "../types";
import { DisconnectedIcon } from "../DisconnectedIcon";
import { DEFAULT_PLAYER_NAME, UI } from "../messages";
import { colorForPlayer } from "../playerColors";
import { ConfirmModal } from "./ConfirmModal";

interface PlayersPanelProps {
  players: Players;
  myId: string;
  /** The lead kicks players and resets the game; everyone else sees neither. */
  amILead: boolean;
  leadId: string | null;
  amDisconnected: boolean;
  openNameModal: () => void;
  hasPlayed: (playerId: string, teamSide: "white" | "black") => boolean;
  onKickPlayer: (targetId: string) => void;
  side: "white" | "black" | "spectator";
  gameStatus: GameStatus;
  joinSide: (target: "white" | "black" | "spectator") => void;
  autoAssign: () => void;
}

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

const LeadCrown: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-label={UI.leadLabel}
  >
    <title>{UI.leadLabel}</title>
    <path d="M2 18h20" />
    <path d="M3 7l5 5 4-8 4 8 5-5-2 11H5z" />
  </svg>
);

export const PlayersPanel: React.FC<PlayersPanelProps> = ({
  players,
  myId,
  amILead,
  leadId,
  amDisconnected,
  openNameModal,
  hasPlayed,
  onKickPlayer,
  side,
  gameStatus,
  joinSide,
  autoAssign,
}) => {
  const [pendingKick, setPendingKick] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const isSetup = gameStatus === GameStatus.Setup;
  const canJoin = (target: "white" | "black" | "spectator") => {
    if (gameStatus === GameStatus.Over) return false;
    if (side === target) return false;
    if (
      (target === "white" || target === "black") &&
      side !== "spectator" &&
      !isSetup
    )
      return false;
    return true;
  };
  const showAutoAssign = gameStatus !== GameStatus.Over && side === "spectator";

  const renderPlayerEntry = (p: Player, teamSide?: "white" | "black") => {
    const isMe = p.id === myId;
    const isLead = p.id === leadId;
    // Only about our own link: a teammate who is gone is gone from the list.
    const disconnected = isMe && amDisconnected;
    const showKickButton = amILead && !isMe;
    const played = teamSide ? hasPlayed(p.id, teamSide) : false;
    const nameStyle = { color: colorForPlayer(p.id) };

    return (
      <li key={p.id} className="player-list-item-column">
        <div className="player-entry">
          {isMe ? (
            <button className="clickable-name" onClick={openNameModal}>
              <span className="player-name-text" style={nameStyle}>
                {p.name}
              </span>
              {p.name === DEFAULT_PLAYER_NAME && <PencilIcon />}
            </button>
          ) : (
            <span className="player-name-text" style={nameStyle}>
              {p.name}
            </span>
          )}
          {played && (
            <span
              className="player-played-check"
              title={UI.playedThisTurn}
              aria-label={UI.playedThisTurn}
            >
              ✓
            </span>
          )}
          {isMe && <span className="player-you-tag">(You)</span>}
          {isLead && (
            <span className="player-icon-slot">
              <LeadCrown />
            </span>
          )}
          {disconnected && (
            <span className="player-icon-slot">
              <DisconnectedIcon />
            </span>
          )}
          {showKickButton && (
            <button
              className="kick-btn"
              onClick={() => setPendingKick({ id: p.id, name: p.name })}
              title={UI.kickTooltip(p.name)}
            >
              {UI.btnKick}
            </button>
          )}
        </div>
      </li>
    );
  };

  const renderSection = (
    target: "white" | "black" | "spectator",
    label: string,
    list: Player[]
  ) => {
    const joinable = canJoin(target);
    const teamSide = target === "spectator" ? undefined : target;
    return (
      <div className="player-section">
        <div className="player-section-heading">
          <h3>{label}</h3>
          {joinable && (
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
    <div className="tab-panel players-panel">
      <div className="player-lists-container">
        {renderSection("spectator", UI.headingSpectators, players.spectators)}
        {showAutoAssign && (
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
      </div>
      {pendingKick && (
        <ConfirmModal
          message={UI.confirmKick(pendingKick.name)}
          onConfirm={() => {
            onKickPlayer(pendingKick.id);
            setPendingKick(null);
          }}
          onCancel={() => setPendingKick(null)}
        />
      )}
    </div>
  );
};
