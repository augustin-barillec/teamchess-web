import { RefObject } from "react";
import { Turn } from "../types";
import { UI } from "../messages";

interface MovesPanelProps {
  activeTab: string;
  turns: Turn[];
  myId: string;
  movesRef: RefObject<HTMLDivElement | null>;
}

export const MovesPanel: React.FC<MovesPanelProps> = ({
  activeTab,
  turns,
  myId,
  movesRef,
}) => {
  return (
    <div
      className={
        "tab-panel moves-panel " + (activeTab === "moves" ? "active" : "")
      }
    >
      <h3>{UI.headingMoves}</h3>
      {turns.some((t) => t.selection) ? (
        <div ref={movesRef} className="moves-list">
          {turns
            .filter((t) => t.selection)
            .map((t) => (
              <div
                key={`${t.side}-${t.moveNumber}`}
                className="move-turn-header"
              >
                <strong>
                  {Math.ceil(t.moveNumber / 2)}.{" "}
                  {t.side === "white" ? "White" : "Black"}
                </strong>
                <ul className="move-proposals">
                  {t.proposals.map((p) => {
                    const isSel = t.selection!.lan === p.lan;
                    return (
                      <li
                        key={p.id}
                        className={
                          "move-proposal-item" + (isSel ? " selected" : "")
                        }
                      >
                        <span className="move-san-wrap">{p.san}</span>
                        <span className="move-player-name">{p.name}</span>
                        {p.id === myId && (
                          <span className="move-you-tag">(You)</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
        </div>
      ) : (
        <p className="moves-list-empty">{UI.noMovesYet}</p>
      )}
    </div>
  );
};
