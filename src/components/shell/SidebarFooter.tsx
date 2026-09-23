import { useMode, type Mode } from "../../settings/ModeProvider";
import { useTheme, type ThemePreference } from "../../theme/ThemeProvider";
import { cn } from "../ui";
import { ArrowLeftIcon } from "./icons";
import { ADMIN_URL } from "./links";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match computer" },
];

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: "simple", label: "Simple" },
  { value: "advanced", label: "Advanced" },
];

/**
 * A labelled group of toggle buttons (aria-pressed), as in the Admin's
 * sidebar footer. Not a radiogroup: there is no arrow-key roving focus, so
 * plain Tab order between the buttons is the right pattern.
 */
function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={opt.value === value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "h-11 flex-1 rounded-md px-1 text-[0.8125rem] leading-tight transition-colors lg:h-[2.125rem]",
            "focus-visible:shadow-focus focus-visible:outline-none",
            opt.value === value
              ? "bg-surface font-semibold text-fg shadow-sm dark:bg-border"
              : "bg-transparent text-fg-muted hover:text-fg",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Sidebar footer: the way back to the AVADO Admin, and the theme and mode switches. */
export function SidebarFooter() {
  const { preference, setPreference } = useTheme();
  const { mode, setMode } = useMode();
  return (
    <div className="flex flex-col gap-2.5 rounded-lg bg-bg-subtle p-3.5">
      <a
        href={ADMIN_URL}
        className="flex items-center gap-2.5 rounded-md p-1 text-sm font-semibold text-fg no-underline transition-colors hover:bg-fg/[0.05] hover:text-fg focus-visible:shadow-focus focus-visible:outline-none"
      >
        <span
          aria-hidden="true"
          className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-accent/15 font-display text-[0.8125rem] font-extrabold text-accent"
        >
          AV
        </span>
        <span className="min-w-0 flex-1 truncate">My AVADO</span>
        <ArrowLeftIcon className="flex-shrink-0 text-fg-muted" width={16} height={16} />
      </a>
      <SegmentedControl label="Theme" options={THEME_OPTIONS} value={preference} onChange={setPreference} />
      <SegmentedControl label="Mode" options={MODE_OPTIONS} value={mode} onChange={setMode} />
    </div>
  );
}

export default SidebarFooter;
