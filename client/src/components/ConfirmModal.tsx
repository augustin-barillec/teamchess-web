import { createPortal } from "react-dom";
import { UI } from "../messages";

interface ConfirmModalProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  message,
  onConfirm,
  onCancel,
}) => {
  return createPortal(
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <p>{message}</p>
        <div className="confirm-dialog-buttons">
          <button onClick={onCancel}>{UI.confirmCancel}</button>
          <button onClick={onConfirm}>{UI.confirmOk}</button>
        </div>
      </div>
    </div>,
    document.body
  );
};
