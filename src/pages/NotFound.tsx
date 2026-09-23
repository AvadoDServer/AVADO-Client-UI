import { Link } from "react-router-dom";
import { Button } from "../components/ui";

/** Any address the app doesn't know. */
export default function NotFound() {
  return (
    <div className="flex flex-col items-start gap-4 py-10">
      <h1 className="font-display text-3xl font-bold tracking-tight">Page not found</h1>
      <p className="max-w-prose text-fg-muted">There is nothing at this address. It may have moved in an update.</p>
      <Button as={Link} to="/">
        Go to validators
      </Button>
    </div>
  );
}
