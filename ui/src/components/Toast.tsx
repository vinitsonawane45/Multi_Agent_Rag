import { Toast as ToastType } from "../types";

type ToastContainerProps = {
  toasts: ToastType[];
  onDismiss: (id: string) => void;
};

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function Toast({ toast, onDismiss }: { toast: ToastType; onDismiss: (id: string) => void }) {
  const getIcon = () => {
    switch (toast.type) {
      case "success": return "✓";
      case "error": return "✕";
      case "warning": return "⚠";
      case "info": return "ℹ";
    }
  };

  return (
    <div className={`toast toast-${toast.type} animate-slideIn`}>
      <div className="toast-icon">{getIcon()}</div>
      <div className="toast-content">{toast.message}</div>
      <button className="toast-dismiss" onClick={() => onDismiss(toast.id)}>×</button>
      <div className="toast-progress"></div>
    </div>
  );
}
