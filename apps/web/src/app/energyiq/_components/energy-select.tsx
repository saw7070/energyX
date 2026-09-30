"use client";

import React, {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { EnergyIcon } from "./icons";
import { useMessages } from "./energyiq-locale";
import { defineMessages } from "./energyiq-messages";

// Only the control's own fallback wording; option labels come from each caller.
const messages = defineMessages({
  placeholder: "Select an option",
}, {
  "zh-Hans": { placeholder: "请选择" },
  ms: { placeholder: "Pilih satu pilihan" },
});

export type EnergySelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type EnergySelectProps = {
  ariaLabel: string;
  value: string;
  options: EnergySelectOption[];
  onValueChange: (value: string) => void;
  leadingIcon?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  size?: "compact" | "small" | "medium";
};

type MenuPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  opensUp: boolean;
};

const sizeClasses = {
  compact: "min-h-8 px-2 text-[10px]",
  small: "min-h-9 px-2.5 text-xs",
  medium: "min-h-10 px-3 text-sm",
};

export function EnergySelect({
  ariaLabel,
  value,
  options,
  onValueChange,
  leadingIcon,
  placeholder,
  disabled = false,
  invalid = false,
  className = "",
  triggerClassName = "",
  menuClassName = "",
  size = "medium",
}: EnergySelectProps) {
  const t = useMessages(messages);
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const enabledIndexes = useMemo(
    () => options.flatMap((option, index) => option.disabled ? [] : [index]),
    [options],
  );

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportPadding = 8;
      const gap = 6;
      const estimatedWidth = Math.max(
        rect.width,
        Math.min(320, Math.max(...options.map((option) => option.label.length * 7.2 + 54), 160)),
      );
      const width = Math.min(estimatedWidth, window.innerWidth - viewportPadding * 2);
      const left = Math.min(
        Math.max(viewportPadding, rect.left),
        window.innerWidth - width - viewportPadding,
      );
      const roomBelow = window.innerHeight - rect.bottom - viewportPadding;
      const roomAbove = rect.top - viewportPadding;
      const desiredHeight = Math.min(288, options.length * 40 + 8);
      const opensUp = roomBelow < Math.min(desiredHeight, 180) && roomAbove > roomBelow;
      const maxHeight = Math.max(96, Math.min(desiredHeight, opensUp ? roomAbove - gap : roomBelow - gap));
      const top = opensUp
        ? Math.max(viewportPadding, rect.top - maxHeight - gap)
        : rect.bottom + gap;

      setPosition({ left, top, width, maxHeight, opensUp });
    };

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (optionRefs.current.some((option) => option?.contains(target))) return;
      setOpen(false);
    };

    updatePosition();
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, options]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const openMenu = (preferredIndex = selectedIndex) => {
    if (disabled || enabledIndexes.length === 0) return;
    const nextIndex = enabledIndexes.includes(preferredIndex) ? preferredIndex : enabledIndexes[0];
    setActiveIndex(nextIndex);
    setOpen(true);
  };

  const closeMenu = () => {
    setOpen(false);
    setPosition(null);
  };

  const moveActive = (direction: 1 | -1) => {
    if (enabledIndexes.length === 0) return;
    const currentPosition = enabledIndexes.indexOf(activeIndex);
    const nextPosition = currentPosition < 0
      ? direction === 1 ? 0 : enabledIndexes.length - 1
      : (currentPosition + direction + enabledIndexes.length) % enabledIndexes.length;
    setActiveIndex(enabledIndexes[nextPosition]);
  };

  const chooseOption = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onValueChange(option.value);
    setActiveIndex(index);
    closeMenu();
    triggerRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openMenu(event.key === "ArrowDown" ? selectedIndex : enabledIndexes.at(-1));
      else moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" && open) {
      event.preventDefault();
      setActiveIndex(enabledIndexes[0] ?? -1);
      return;
    }
    if (event.key === "End" && open) {
      event.preventDefault();
      setActiveIndex(enabledIndexes.at(-1) ?? -1);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      chooseOption(activeIndex);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && !open) {
      event.preventDefault();
      openMenu();
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key === "Tab" && open) {
      closeMenu();
    }
  };

  const listbox = open && position ? createPortal(
    <div
      id={`${id}-listbox`}
      role="listbox"
      aria-label={ariaLabel}
      className={[
        "energy-select-menu fixed z-[100] overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-[0_12px_32px_rgb(13_13_13/0.14)]",
        position.opensUp ? "origin-bottom" : "origin-top",
        menuClassName,
      ].join(" ")}
      style={{
        left: position.left,
        top: position.top,
        width: position.width,
        maxHeight: position.maxHeight,
      }}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        const active = index === activeIndex;
        return (
          <button
            key={option.value}
            ref={(element) => { optionRefs.current[index] = element; }}
            id={`${id}-option-${index}`}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={selected}
            disabled={option.disabled}
            onPointerDown={(event) => event.preventDefault()}
            onPointerMove={() => { if (!option.disabled) setActiveIndex(index); }}
            onClick={() => chooseOption(index)}
            className={[
              "energy-select-option flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs outline-none transition-colors",
              active ? "bg-surface-subtle text-foreground" : "text-muted hover:bg-surface-subtle hover:text-foreground",
              selected ? "font-semibold" : "font-medium",
              option.disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer",
            ].join(" ")}
          >
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            <EnergyIcon
              name="check"
              className={selected ? "h-3.5 w-3.5 shrink-0 text-foreground" : "h-3.5 w-3.5 shrink-0 opacity-0"}
            />
          </button>
        );
      })}
    </div>,
    // Keep options in the active modal top layer so they remain interactive.
    triggerRef.current?.closest("dialog") ?? document.body,
  ) : null;

  return (
    <div className={["relative min-w-0", className].join(" ")}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={`${id}-listbox`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => open ? closeMenu() : openMenu()}
        onKeyDown={handleKeyDown}
        className={[
          "energy-select-trigger flex w-full min-w-0 items-center gap-2 rounded-lg border bg-surface text-left font-medium text-foreground outline-none transition-colors",
          "hover:bg-surface-subtle focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-muted",
          invalid ? "border-step-error focus-visible:ring-step-error/15" : "border-border",
          sizeClasses[size],
          triggerClassName,
        ].join(" ")}
      >
        {leadingIcon ? <span className="shrink-0 text-muted-light">{leadingIcon}</span> : null}
        <span className={selectedOption ? "min-w-0 flex-1 truncate" : "min-w-0 flex-1 truncate text-muted-light"}>
          {selectedOption?.label ?? placeholder ?? t("placeholder")}
        </span>
        <EnergyIcon
          name="chevron"
          className={[
            "h-3 w-3 shrink-0 rotate-90 text-muted-light transition-transform duration-150",
            open ? "-rotate-90" : "rotate-90",
          ].join(" ")}
        />
      </button>
      {listbox}
    </div>
  );
}
