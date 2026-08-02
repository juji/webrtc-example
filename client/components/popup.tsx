"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

const ANIMATION_MS = 200;

type PopupButton = {
  label: string;
  onClick: () => void;
  bgColor?: string;
  fgColor?: string;
};

type PopupProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  onConfirm?: () => void;
  confirmLabel?: string;
  closeLabel?: string;
  buttons?: PopupButton[];
};

export function Popup({
  open,
  onClose,
  title,
  children,
  onConfirm,
  confirmLabel = "Confirm",
  closeLabel = "Cancel",
  buttons,
}: PopupProps) {
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setRendered(true);
      setClosing(false);
      return;
    }
    if (!rendered) return;
    setClosing(true);
    const timeout = setTimeout(() => {
      setRendered(false);
      setClosing(false);
    }, ANIMATION_MS);
    return () => clearTimeout(timeout);
  }, [open, rendered]);

  if (!rendered) return null;

  let footerButtons = buttons;
  if (!footerButtons) {
    footerButtons = [{ label: closeLabel, onClick: onClose, bgColor: "#dc2626", fgColor: "#ffffff" }];
    if (onConfirm) {
      footerButtons.push({ label: confirmLabel, onClick: onConfirm, bgColor: "#16a34a", fgColor: "#ffffff" });
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 duration-200 md:bg-black/10 md:backdrop-blur-md ${
        closing ? "animate-out fade-out" : "animate-in fade-in"
      }`}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`flex h-full w-full flex-col overflow-hidden bg-background duration-200 md:h-auto md:max-h-[85vh] md:w-full md:max-w-md md:rounded-2xl md:border md:border-black/10 md:shadow-2xl md:shadow-black/20 md:dark:border-white/10 md:dark:shadow-black/60 ${
          closing
            ? "animate-out slide-out-to-bottom md:zoom-out-95 md:slide-out-to-bottom-2"
            : "animate-in slide-in-from-bottom md:zoom-in-95 md:slide-in-from-bottom-2"
        }`}
      >
        <div className="flex items-center justify-between gap-4 px-6 pt-6 pb-4">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>

        {footerButtons.length > 0 && (
          <div className="flex items-center justify-between gap-2 bg-black/2 px-6 py-4 dark:bg-white/3">
            {footerButtons.length > 1 ? (
              <button
                onClick={footerButtons[0].onClick}
                style={
                  footerButtons[0].bgColor || footerButtons[0].fgColor
                    ? { backgroundColor: footerButtons[0].bgColor, color: footerButtons[0].fgColor }
                    : undefined
                }
                className="rounded-full px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
              >
                {footerButtons[0].label}
              </button>
            ) : (
              <div />
            )}

            <div className={`flex items-center gap-2 ${footerButtons.length === 1 ? "w-full" : ""}`}>
              {(footerButtons.length > 1 ? footerButtons.slice(1) : footerButtons).map((b) => (
                <button
                  key={b.label}
                  onClick={b.onClick}
                  style={b.bgColor || b.fgColor ? { backgroundColor: b.bgColor, color: b.fgColor } : undefined}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 ${
                    footerButtons.length === 1 ? "w-full" : ""
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
