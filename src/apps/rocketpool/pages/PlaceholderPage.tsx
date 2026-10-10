import { Card, CardDescription, CardTitle } from "../../../components/ui";

/** A page whose screens come in a later step. */
export default function PlaceholderPage({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-4xl font-bold tracking-tight text-fg">{title}</h1>
      <Card className="flex flex-col gap-2">
        <CardTitle>Coming soon</CardTitle>
        <CardDescription>{text}</CardDescription>
      </Card>
    </div>
  );
}
