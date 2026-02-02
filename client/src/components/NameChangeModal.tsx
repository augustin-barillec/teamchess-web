import type { ChangeEvent, RefObject, KeyboardEvent } from "react";
import { GameStatus } from "../types";

interface NameChangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  gameStatus: GameStatus;
  side: "white" | "black" | "spectator";
}

export const NameChangeModal: React.FC<NameChangeModalProps> = ({
  isOpen,
  onClose,
  onSave,
  value,
  onChange,
  onKeyDown,
  inputRef,
  gameStatus: _gameStatus,
  side: _side,
}) => {
  if (!isOpen) return null;

  return (
    <div className="name-modal-overlay" onClick={onClose}>
      <div className="name-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Change Name</h3>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder="Set your name"
          aria-label="Set your name (Enter to save)"
        />

        <div className="name-modal-buttons">
          <button onClick={onClose}>Cancel</button>
          <button onClick={onSave}>Save</button>
        </div>
      </div>
    </div>
  );
};
