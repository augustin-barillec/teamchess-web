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
          {" "}
          {turns
            .filter((t) => t.selection)
            .map((t) => (
              <div
                key={`${t.side}-${t.moveNumber}`}
                className="move-turn-header"
                style={{ marginBottom: "1rem" }}
              >
                {" "}
                <strong>{t.moveNumber}</strong>{" "}
                <ul style={{ margin: 4, paddingLeft: "1.2rem" }}>
                  {" "}
                  {t.proposals.map((p) => {
                    const isSel = t.selection!.lan === p.lan;
                    return (
                      <li key={p.id}>
                        {" "}
                        {p.id === myId ? (
                          <strong>{p.name}</strong>
                        ) : (
                          p.name
                        )}{" "}
                        {isSel ? (
                          <span className="moves-list-item">{p.san}</span>
                        ) : (
                          p.san
                        )}{" "}
                      </li>
                    );
                  })}{" "}
                </ul>{" "}
              </div>
            ))}{" "}
        </div>
      ) : (
        <p style={{ padding: "10px", fontStyle: "italic" }}>{UI.noMovesYet}</p>
      )}
    </div>
  );
};
