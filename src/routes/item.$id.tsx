import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getItem } from "@/lib/agenda.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/item/$id")({
  head: () => ({
    meta: [{ title: "Agenda item — McKinney Council Dashboard" }],
  }),
  component: ItemDetail,
  errorComponent: ({ error }) => (
    <div className="p-8 text-destructive">Error: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-8">Item not found</div>,
});

function ItemDetail() {
  const { id } = Route.useParams();
  const router = useRouter();
  const fetchItem = useServerFn(getItem);
  const q = useQuery({
    queryKey: ["item", id],
    queryFn: () => fetchItem({ data: { id } }),
  });

  if (q.isLoading)
    return <div className="container mx-auto p-8 text-muted-foreground">Loading…</div>;
  if (!q.data) return <div className="container mx-auto p-8">Not found.</div>;
  const it = q.data;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex items-center gap-3 px-6 py-4">
          <Button variant="ghost" size="sm" onClick={() => router.history.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
          <h1 className="text-lg font-semibold">Agenda item {it.item_number}</h1>
        </div>
      </header>
      <main className="container mx-auto max-w-3xl space-y-4 px-6 py-6">
        <div className="flex flex-wrap gap-2">
          <Badge>{it.item_type}</Badge>
          <Badge variant="secondary">{it.department}</Badge>
          {it.cost_estimate && <Badge variant="outline">{it.cost_estimate}</Badge>}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Original item title</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-relaxed">{it.raw_title}</CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plain-language explanation</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-relaxed">{it.plain_summary}</CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <Field label="Item number" value={it.item_number || "—"} />
            <Field label="Type" value={it.item_type || "—"} />
            <Field label="Owning department (inferred)" value={it.department || "—"} />
            <Field
              label="Cost"
              value={it.cost_estimate || "Not disclosed in agenda title"}
            />
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          Department and summary inferred by AI from the agenda title. Costs only appear when
          stated in the agenda itself — most dollar figures live in linked staff reports.
        </p>

        <Link to="/" className="inline-block">
          <Button variant="outline" size="sm">Back to dashboard</Button>
        </Link>
      </main>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1">{value}</div>
    </div>
  );
}
