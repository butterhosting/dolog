import clsx from "clsx";
import React, { useEffect, useRef } from "react";

type Props = {
  isOpen: boolean;
  onCloseRequest?: () => unknown;
  issueCloseRequestWhenPressingEscape?: boolean;
  issueCloseRequestWhenClickingBackdrop?: boolean;
  children: React.ReactNode;
  className?: string;
};
export function Modal({
  isOpen,
  onCloseRequest = () => null,
  issueCloseRequestWhenPressingEscape = false,
  issueCloseRequestWhenClickingBackdrop = false,
  children,
  className,
}: Props) {
  const modalRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const modal = modalRef.current!;
    /**
     * Both branches belong to Escape. Closing used to be decided outside that check, so a modal
     * that opted into escape-to-close was dismissed by *any* keystroke -- invisible until one of
     * them held a text field to type into.
     */
    const preventEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") {
        return;
      }
      e.preventDefault();
      if (issueCloseRequestWhenPressingEscape) {
        onCloseRequest();
      }
    };
    modal.addEventListener("keydown", preventEsc);
    return () => modal.removeEventListener("keydown", preventEsc);
  }, [issueCloseRequestWhenPressingEscape]);

  useEffect(() => {
    const modal = modalRef.current!;
    if (isOpen) {
      modal.showModal();
    } else {
      modal.close();
    }
  }, [isOpen]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    const modal = modalRef.current!;
    if (e.target === modal && issueCloseRequestWhenClickingBackdrop) {
      onCloseRequest();
    }
  };

  return (
    <dialog
      ref={modalRef}
      className={clsx(
        "fixed top-[30%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-2xl",
        "rounded-lg focus:outline-none",
        "bg-white backdrop:bg-c-dark-full/10 backdrop:backdrop-blur-xs shadow-2xl",
        className,
      )}
      onClick={handleBackdropClick}
      onClose={onCloseRequest}
    >
      {children}
    </dialog>
  );
}
