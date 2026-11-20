import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enrichAgendaItem, getItem } from "@/lib/agenda.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink, Sparkles } from "lucide-react";

export const Route = createFileRoute("/item/$id")({
  head: () => ({
    meta: [
      { title: "Agenda Item — Agenda Insight" },
      {
        name: "description",
        content:
          "Detailed plain-language breakdown, funding, locations, and source documents for a public meeting agenda item on Agenda Insight.",
      },
      { property: "og:title", content: "Agenda Item — Agenda Insight" },
      {
        property: "og:description",
        content:
          "Detailed plain-language breakdown, funding, locations, and source documents for a public meeting agenda item.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ItemDetail,
  errorComponent: ({ error }) => (
    <div className="p-8 text-destructive">
      Error: {error instanceof Error ? error.message : String(error)}
    </div>
  ),
  notFoundComponent: () => <div className="p-8">Item not found</div>,
});

function ItemDetail() {
  const { id } = Route.useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const fetchItem = useServerFn(getItem);
  const enrich = useServerFn(enrichAgendaItem);

  const q = useQuery({
    queryKey: ["item", id],
    queryFn: () => fetchItem({ data: { id } }),
  });

  const enrichMut = useMutation({
    mutationFn: () => enrich({ data: { itemId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["item", id] }),
  });

  if (q.isLoading)
    return <div className="container mx-auto p-8 text-muted-foreground">Loading…</div>;
  if (!q.data) return <div className="container mx-auto p-8">Not found.</div>;
  const it = q.data as Record<string, unknown> & {
    id: string;
    item_number: string | null;
    item_type: string;
    department: string;
    cost_estimate: string | null;
    raw_title: string;
    plain_summary: string;
    enrichment_status: string;
    enrichment_error: string | null;
    funding_source: string | null;
    vendor: string | null;
    recommendation: string | null;
    background: string | null;
    detailed_summary: string | null;
    staff_report_url: string | null;
    matter_status: string | null;
    matter_url: string | null;
    locations: string[] | null;
    attachments: { name: string; url: string }[] | null;
    is_grant: boolean | null;
    grant_award_amount: number | string | null;
    grant_match_amount: number | string | null;
    grantor: string | null;
    agendas?: {
      id: string;
      title: string;
      meeting_date: string | null;
      organizations?: { id: string; name: string } | null;
    } | null;
  };

  const orgName = it.agendas?.organizations?.name ?? null;
  const enriched = it.enrichment_status === "done";
  const busy = enrichMut.isPending;

  return (
    <div>
      <header className="border-b border-t-4 border-t-highlight bg-card">
        <div className="container mx-auto flex flex-wrap items-center gap-3 px-6 py-4">
          <Button variant="ghost" size="sm" onClick={() => router.history.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
          <img
            src="/agenda-insight-mark.svg"
            alt="Agenda Insight"
            className="h-7 w-7 shrink-0 rounded"
          />
          <div>
            <p className="font-display font-bold text-primary">Agenda Insight</p><h1 className="text-sm font-semibold">Agenda item {it.item_number}</h1>
            {orgName && <p className="text-xs text-muted-foreground">{orgName}</p>}
          </div>
          <div className="ml-auto">
            <Button
              size="sm"
              variant={enriched ? "outline" : "default"}
              onClick={() => enrichMut.mutate()}
              disabled={busy}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {busy
                ? "Reading staff report…"
                : enriched
                  ? "Re-read staff report"
                  : "Fetch staff report"}
            </Button>
          </div>
        </div>
      </header>
      <main className="container mx-auto max-w-3xl space-y-4 px-6 py-6">
        <div className="flex flex-wrap gap-2">
          <Badge>{it.item_type}</Badge>
          <Badge variant="secondary">{it.department}</Badge>
          {it.cost_estimate && <Badge variant="outline">{it.cost_estimate}</Badge>}
          {it.matter_status && <Badge variant="outline">{it.matter_status}</Badge>}
          {it.is_grant && (
            <Badge className="border-success/40 bg-success/15 text-success-foreground">
              Grant{it.grantor ? ` · ${it.grantor}` : ""}
            </Badge>
          )}
          <EnrichmentBadge status={it.enrichment_status} />
        </div>

        {it.enrichment_status === "failed" && it.enrichment_error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            Enrichment failed: {it.enrichment_error}
          </div>
        )}

        {it.is_grant && (
          <Card className="border-success/30 bg-success/5">
            <CardHeader>
              <CardTitle className="text-base">
                Grant impact{it.grantor ? ` — ${it.grantor}` : ""}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Potential income (award)
                </div>
                <div className="mt-1 text-xl font-semibold text-success-foreground">
                  {it.grant_award_amount != null
                    ? `+$${Number(it.grant_award_amount).toLocaleString()}`
                    : "Not yet disclosed"}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Potential local cost (match)
                </div>
                <div className="mt-1 text-xl font-semibold">
                  {it.grant_match_amount != null && Number(it.grant_match_amount) > 0
                    ? `−$${Number(it.grant_match_amount).toLocaleString()}`
                    : it.grant_match_amount != null
                      ? "$0 (no match required)"
                      : "Not yet disclosed"}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

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
          <CardContent className="text-sm leading-relaxed">
            {it.detailed_summary || it.plain_summary}
          </CardContent>
        </Card>

        {(it.background || it.recommendation || it.vendor || it.funding_source) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">From the staff report</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-relaxed">
              {it.background && (
                <Section label="Background">{it.background}</Section>
              )}
              {it.recommendation && (
                <Section label="Staff recommendation">{it.recommendation}</Section>
              )}
              {it.vendor && <Section label="Vendor / counterparty">{it.vendor}</Section>}
              {it.funding_source && (
                <Section label="Funding source">{it.funding_source}</Section>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <Field label="Item number" value={it.item_number || "—"} />
            <Field label="Type" value={it.item_type || "—"} />
            <Field label="Owning department" value={it.department || "—"} />
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Cost</div>
              <div className="mt-1">{it.cost_estimate || "Not disclosed"}</div>
              {!it.cost_estimate &&
                (it.enrichment_status === "done" || it.enrichment_status === "none") &&
                it.enrichment_error && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {it.enrichment_error}.
                  </div>
                )}
            </div>
          </CardContent>
        </Card>

        {it.locations && it.locations.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {it.locations.length === 1 ? "Location" : "Locations"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {it.locations.map((loc, i) => {
                const q = encodeURIComponent(orgName ? `${loc}, ${orgName}` : loc);
                return (
                  <div key={i} className="space-y-2">
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${q}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 font-medium text-primary underline-offset-2 hover:underline"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {loc}
                    </a>
                    <iframe
                      title={`Map of ${loc}`}
                      src={`https://www.google.com/maps?q=${q}&output=embed`}
                      className="h-64 w-full rounded-md border"
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                    />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {(it.attachments && it.attachments.length > 0) || it.matter_url ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Source documents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {it.matter_url && (
                <a
                  href={it.matter_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 font-medium text-primary underline-offset-2 hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  View on Legistar (official record)
                </a>
              )}
              {it.attachments?.map((a, i) => (
                <a
                  key={i}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 text-primary underline-offset-2 hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {a.name}
                  {a.url === it.staff_report_url && (
                    <Badge variant="outline" className="ml-1 text-[10px]">primary</Badge>
                  )}
                </a>
              ))}
            </CardContent>
          </Card>
        ) : null}

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

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function EnrichmentBadge({ status }: { status: string }) {
  if (status === "done") return <Badge variant="outline" className="border-success/50 text-success-foreground">Staff report parsed</Badge>;
  if (status === "failed") return <Badge variant="destructive">Enrichment failed</Badge>;
  if (status === "none") return <Badge variant="outline">No staff report</Badge>;
  return <Badge variant="outline">Awaiting staff report</Badge>;
}
