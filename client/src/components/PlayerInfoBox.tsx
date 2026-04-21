import { ReactNode } from "react";
import { LOW_TIME_THRESHOLD } from "../constants";

interface PlayerInfoBoxProps {
  clockTime: number;
  lostPieces: string[];
  materialAdv: number;
  isActive: boolean;
  actionSlot?: ReactNode;
}

export const PlayerInfoBox: React.FC<PlayerInfoBoxProps> = ({
  clockTime,
  lostPieces,
  materialAdv,
  isActive,
  actionSlot,
}) => {
  const isLowTime = clockTime > 0 && clockTime <= LOW_TIME_THRESHOLD;

  return (
    <div className="game-player-info">
      <div
        className={`clock-box ${isActive ? "active" : ""} ${
          isLowTime ? "low-time" : ""
        }`}
      >
        {String(Math.floor(clockTime / 60)).padStart(2, "0")}:
        {String(clockTime % 60).padStart(2, "0")}
      </div>
      <div className="material-display">
        <span className="material-pieces">
          {lostPieces.map((s, i) => {
            const xIdx = s.indexOf("x");
            const figurine = xIdx === -1 ? s : s.slice(0, xIdx);
            const count = xIdx === -1 ? "" : s.slice(xIdx);
            return (
              <span key={i} className="piece-group">
                <span className="piece-figurine">{figurine}</span>
                {count && <span className="piece-count">{count}</span>}
              </span>
            );
          })}
        </span>
        <span
          className="material-adv-label"
          style={{ visibility: materialAdv > 0 ? "visible" : "hidden" }}
        >
          {materialAdv > 0 ? `+${materialAdv}` : ""}
        </span>
      </div>
      {actionSlot && <div className="player-info-actions">{actionSlot}</div>}
    </div>
  );
};
