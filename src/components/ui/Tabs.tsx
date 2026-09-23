import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";

export interface TabItem {
  id: string;
  label: ReactNode;
  badge?: ReactNode;
}

export interface TabsProps {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
  "aria-label"?: string;
}

/** Tabs — pill tabs with roving tabindex and arrow/Home/End keys. */
export function Tabs({ tabs, active, onChange, className, "aria-label": ariaLabel }: TabsProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusAndChange = (i: number) => {
    const next = tabs[i];
    if (!next) return;
    onChange(next.id);
    tabRefs.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (d) {
      e.preventDefault();
      focusAndChange((i + d + tabs.length) % tabs.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusAndChange(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusAndChange(tabs.length - 1);
    }
  };

  // If `active` isn't rendered, keep the first tab reachable.
  const hasSelected = tabs.some((t) => t.id === active);

  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("flex flex-wrap gap-1 overflow-x-auto", className)}>
      {tabs.map((t, i) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            ref={(node) => {
              tabRefs.current[i] = node;
            }}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected || (!hasSelected && i === 0) ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:shadow-focus",
              selected ? "bg-accent/10 text-fg" : "text-fg-muted hover:bg-fg/[0.05] hover:text-fg",
            )}
          >
            {t.label}
            {t.badge ? <span className="rounded-full bg-warning-subtle px-1.5 text-xs text-warning-text">{t.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export default Tabs;
