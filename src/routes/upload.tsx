import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listOrganizations, parseAgendaFromPdf } from "@/lib/agenda.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Upload } from "lucide-react";

const SELECTED_ORG_STORAGE_KEY = "civicplexus_selected_org_id";
const NEW_ORG_VALUE = "__new__";

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Upload Agenda — Agenda Insight" },
      {
        name: "description",
        content:
          "Upload a council or public meeting agenda PDF for any city or organization on Agenda Insight.",
      },
      { property: "og:title", content: "Upload Agenda — Agenda Insight" },
      {
        property: "og:description",
        content:
          "Upload a council or public meeting agenda PDF for any city or organization on Agenda Insight.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UploadPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-destructive">
      Error: {error instanceof Error ? error.message : String(error)}
    </div>
  ),
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

function UploadPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const fetchOrgs = useServerFn(listOrganizations);
  const parse = useServerFn(parseAgendaFromPdf);

  const orgsQ = useQuery({
    queryKey: ["organizations"],
    queryFn: () => fetchOrgs(),
  });
  const orgs = orgsQ.data ?? [];

  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [newOrgName, setNewOrgName] = useState("");
  const [title, setTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (orgs.length === 0) return;
    if (selectedOrgId) return;
    const stored = window.localStorage.getItem(SELECTED_ORG_STORAGE_KEY);
    if (stored && orgs.some((o) => o.id === stored)) {
      setSelectedOrgId(stored);
    } else {
      setSelectedOrgId(orgs[0]!.id);
    }
  }, [orgs, selectedOrgId]);

  const effectiveOrgId = orgs.length === 0 ? NEW_ORG_VALUE : selectedOrgId || orgs[0]!.id;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError("Pick a PDF file first.");
      return;
    }
    const creatingNew = effectiveOrgId === NEW_ORG_VALUE;
    const trimmedOrg = newOrgName.trim();
    if (creatingNew && trimmedOrg.length > 120) {
      setError("City or organization name must be 120 characters or fewer.");
      return;
    }
    setBusy(true);
    try {
      // Upload PDF directly to storage (streamed) to avoid base64-encoding
      // a 20MB file through the server-function RPC payload.
      setStatus("Uploading PDF…");
      const pdfPath = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: upErr } = await supabase.storage
        .from("agenda-pdfs")
        .upload(pdfPath, file, { contentType: "application/pdf", upsert: false });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

      setStatus("Parsing with AI…");
      const result = await parse({
        data: {
          title: title || file.name.replace(/\.pdf$/i, ""),
          meetingDate: meetingDate || null,
          sourceFilename: file.name,
          organizationId: creatingNew ? null : effectiveOrgId,
          organizationName: creatingNew && trimmedOrg ? trimmedOrg : null,
          pdfPath,
        },
      });
      if (result.organizationId) {
        window.localStorage.setItem(SELECTED_ORG_STORAGE_KEY, result.organizationId);
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["organizations"] }),
        qc.invalidateQueries({ queryKey: ["agendas"] }),
      ]);
      router.navigate({ to: "/" });
      console.log("Parsed agenda", result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse");
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  return (
    <div>
      <header className="border-b border-t-4 border-t-highlight bg-card">
        <div className="container mx-auto flex flex-wrap items-center gap-3 px-6 py-4">
          <Link to="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" /> Dashboard
            </Button>
          </Link>
          <img
            src="/agenda-insight-mark.svg"
            alt="Agenda Insight"
            className="h-7 w-7 shrink-0 rounded"
          />
          <div><p className="font-display font-bold text-primary">Agenda Insight</p><h1 className="text-sm text-muted-foreground">Upload an agenda</h1></div>
        </div>
      </header>
      <main className="container mx-auto max-w-xl px-6 py-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Drop in a meeting agenda PDF</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <Label htmlFor="organization">City or organization</Label>
                {orgs.length > 0 && (
                  <Select value={effectiveOrgId} onValueChange={setSelectedOrgId}>
                    <SelectTrigger id="organization">
                      <SelectValue placeholder="Choose or create a city or organization" />
                    </SelectTrigger>
                    <SelectContent>
                      {orgs.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                      <SelectItem value={NEW_ORG_VALUE}>
                        + Create new city or organization…
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
                {effectiveOrgId === NEW_ORG_VALUE && (
                  <Input
                    id={orgs.length === 0 ? "organization" : "new-organization"}
                    placeholder="e.g. City of Austin, TX or Springfield School Board"
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="title">Agenda title</Label>
                <Input
                  id="title"
                  placeholder="e.g. Regular Meeting — July 7, 2026"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="date">Meeting date</Label>
                <Input
                  id="date"
                  type="date"
                  value={meetingDate}
                  onChange={(e) => setMeetingDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="file">Agenda PDF</Label>
                <Input
                  id="file"
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              {error && <div className="text-sm text-destructive">{error}</div>}
              <Button type="submit" disabled={busy}>
                <Upload className="mr-2 h-4 w-4" />
                {busy ? status || "Working…" : "Parse & add to dashboard"}
              </Button>
              <p className="text-xs text-muted-foreground">
                The PDF is sent to AI which extracts each numbered item, infers the
                owning department, pulls any dollar amount stated, and writes a plain-language
                summary. Takes ~20-40 seconds.
              </p>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
