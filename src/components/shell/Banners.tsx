import { Link } from "react-router-dom";
import { Button, StatusDot, cn } from "../ui";
import type { Problem, ProblemTone } from "./problems";

const TONE: Record<ProblemTone, { box: string; title: string }> = {
  danger: { box: "border-danger/25 bg-danger-subtle", title: "text-danger-text" },
  warning: { box: "border-warning/25 bg-warning-subtle", title: "text-warning-text" },
  accent: { box: "border-accent/25 bg-accent-subtle", title: "text-fg" },
};

function FixButton({ problem }: { problem: Problem }) {
  const { label, to, href } = problem.action;
  const common = { size: "sm" as const, variant: "secondary" as const, className: "flex-shrink-0 self-start sm:self-center" };
  return to ? (
    <Button as={Link} to={to} {...common}>
      {label}
    </Button>
  ) : (
    <Button as="a" href={href} {...common}>
      {label}
    </Button>
  );
}

/** The problem banners (spec §4), most serious first, each with its fix. */
export function Banners({ problems }: { problems: Problem[] }) {
  if (problems.length === 0) return null;
  return (
    <section aria-label="Problems" className="mb-6 flex flex-col gap-3">
      {problems.map((p) => (
        <div
          key={p.id}
          data-problem={p.id}
          className={cn("flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center", TONE[p.tone].box)}
        >
          <div className="flex min-w-0 flex-1 gap-3">
            <StatusDot tone={p.tone} className="mt-1.5" />
            <div className="min-w-0">
              <p className={cn("text-[0.9375rem] font-semibold leading-snug", TONE[p.tone].title)}>{p.title}</p>
              <p className="mt-0.5 break-words text-sm text-fg">{p.body}</p>
              {p.details && p.details.length > 0 && (
                <ul className="mt-1.5 list-disc break-words pl-5 text-sm text-fg">
                  {p.details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <FixButton problem={p} />
        </div>
      ))}
    </section>
  );
}

export default Banners;
