import { ReactNode } from "react";
import { INCREMENT_THRESHOLD } from "../../../server/shared_constants";
import { MaterialGroup } from "../materialCalc";

interface PlayerInfoBoxProps {
  clockTime: number;
  lostPieces: MaterialGroup[];
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
  const isLowTime = clockTime > 0 && clockTime <= INCREMENT_THRESHOLD;

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
          {lostPieces.map(({ figurine, count }) => (
            <span key={figurine} className="piece-group">
              {Array.from({ length: count }, (_, i) => (
                <span key={i} className="piece-figurine">
                  {figurine}
                </span>
              ))}
            </span>
          ))}
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
