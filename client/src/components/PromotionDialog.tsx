import { pieceToFigurineWhite, pieceToFigurineBlack } from "../constants";

interface PromotionDialogProps {
  promotionMove: { from: string; to: string } | null;
  turnColor: "w" | "b";
  onPromote: (piece: "q" | "r" | "b" | "n") => void;
}

export const PromotionDialog: React.FC<PromotionDialogProps> = ({
  promotionMove,
  turnColor,
  onPromote,
}) => {
  if (!promotionMove) return null;

  const promotionPieces = ["Q", "R", "B", "N"];
  const pieceMap =
    turnColor === "w" ? pieceToFigurineWhite : pieceToFigurineBlack;

  return (
    <div className="promotion-dialog">
      <h3>Promote to:</h3>
      <div className="promotion-choices">
        {promotionPieces.map((p) => (
          <button
            key={p}
            onClick={() => onPromote(p.toLowerCase() as "q" | "r" | "b" | "n")}
          >
            {" "}
            {pieceMap[p]}{" "}
          </button>
        ))}
      </div>
    </div>
  );
};
