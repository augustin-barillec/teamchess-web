interface PlayerInfoBoxProps {
  clockTime: number;
  lostPieces: string[];
  materialAdv: number;
  isActive: boolean;
}

export const PlayerInfoBox: React.FC<PlayerInfoBoxProps> = ({
  clockTime,
  lostPieces,
  materialAdv,
  isActive,
}) => {
  const isLowTime = clockTime > 0 && clockTime <= 60;

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
        <span>{lostPieces.join(" ")}</span>
        <span
          className="material-adv-label"
          style={{ visibility: materialAdv > 0 ? "visible" : "hidden" }}
        >
          {materialAdv > 0 ? `+${materialAdv}` : ""}
        </span>
      </div>
    </div>
  );
};
