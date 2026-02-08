import type { ChangeEvent, RefObject, KeyboardEvent } from "react";
import { GameStatus } from "../types";
import { UI } from "../messages";

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
        <h3>{UI.nameModalTitle}</h3>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={UI.nameModalPlaceholder}
          aria-label={UI.nameModalAriaLabel}
        />

        <div className="name-modal-buttons">
          <button onClick={onClose}>{UI.nameModalCancel}</button>
          <button onClick={onSave}>{UI.nameModalSave}</button>
        </div>
      </div>
    </div>
  );
};
