import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import { Button, ButtonText } from "./button";
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalTitle,
} from "./modal";

interface DeleteConfirmationProps {
  title: string;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deleting: boolean;
  onConfirm: () => void;
  /** Confirm button label while idle. Defaults to "Delete". */
  confirmLabel?: string;
  /** Confirm button label while `deleting` is true. Defaults to "Deleting...". */
  pendingLabel?: string;
  /** Confirm button variant. Defaults to "destructive". */
  variant?: "destructive" | "highlight";
}

export function DeleteConfirmation({
  title,
  description,
  open,
  onOpenChange,
  deleting,
  onConfirm,
  confirmLabel = "Delete",
  pendingLabel = "Deleting...",
  variant = "destructive",
}: DeleteConfirmationProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>{title}</ModalTitle>
        <ModalDescription>{description}</ModalDescription>
        <ModalFooter>
          <Button variant={variant} className="w-full justify-center" onClick={onConfirm} disabled={deleting}>
            {deleting && <LoaderCircle size={16} className="animate-spin" />}
            <ButtonText>{deleting ? pendingLabel : confirmLabel}</ButtonText>
          </Button>
          <Button variant="elevated" className="w-full justify-center" onClick={() => onOpenChange(false)}>
            <ButtonText>Cancel</ButtonText>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
