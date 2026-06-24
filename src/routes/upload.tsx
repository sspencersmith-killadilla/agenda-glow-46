import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { parseAgendaFromPdf } from "@/lib/agenda.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Upload } from "lucide-react";

export const Route = createFileRoute("/upload")({
  head: () => ({ meta: [{ title: "Upload agenda — McKinney Council Dashboard" }] }),
  component: UploadPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-destructive">Error: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

function UploadPage() {
  const router = useRouter();
  const parse = useServerFn(parseAgendaFromPdf);

  const [title, setTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError("Pick a PDF file first.");
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
          pdfPath,
        },
      });
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
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex items-center gap-3 px-6 py-4">
          <Link to="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" /> Dashboard
            </Button>
          </Link>
          <h1 className="text-lg font-semibold">Upload an agenda</h1>
        </div>
      </header>
      <main className="container mx-auto max-w-xl px-6 py-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Drop in a council agenda PDF</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <Label htmlFor="title">Agenda title</Label>
                <Input
                  id="title"
                  placeholder="e.g. City Council Regular Meeting — July 7, 2026"
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
                {busy ? "Parsing with AI…" : "Parse & add to dashboard"}
              </Button>
              <p className="text-xs text-muted-foreground">
                The PDF is sent to Lovable AI which extracts each numbered item, infers the
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
