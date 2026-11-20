import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  listOrganizations,
  createOrganization,
  listAgendas,
  getAgenda,
  enrichAgenda,
  deleteAgenda,
  deleteAllAgendas,
  testAIConnection,
} from "@/lib/agenda.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  Upload,
  FileText,
  Search,
  Sparkles,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Building2,
  Plus,
} from "lucide-react";

const SELECTED_ORG_STORAGE_KEY = "civicplexus_selected_org_id";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CivicPlexus Agenda — Public Meeting Dashboard" },
      {
        name: "description",
        content:
          "Plain-language agenda dashboard for any city or organization — costs, departments, grants, and summaries. Part of the CivicPlexus family of sites.",
      },
      { property: "og:title", content: "CivicPlexus Agenda — Public Meeting Dashboard" },
      {
        property: "og:description",
        content:
          "Plain-language agenda dashboard for any city or organization — costs, departments, grants, and summaries.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
  errorComponent: ({ error }) => (
    <div className="p-8 text-destructive">
      Error: {error instanceof Error ? error.message : String(error)}
    </div>
  ),
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

const TYPE_COLORS: Record<string, string> = {
  Ordinance: "var(--chart-1)",
  Resolution: "var(--chart-2)",
  Minutes: "var(--chart-3)",
  "Public Hearing": "var(--chart-4)",
  "Executive Session": "var(--chart-5)",
  Election: "var(--chart-1)",
  Other: "var(--muted-foreground)",
};

function Dashboard() {
  const router = useRouter();
  const qc = useQueryClient();
  const fetchOrgs = useServerFn(listOrganizations);
  const addOrg = useServerFn(createOrganization);
  const fetchAgendas = useServerFn(listAgendas);
  const delOne = useServerFn(deleteAgenda);
  const delAll = useServerFn(deleteAllAgendas);

  const orgsQ = useQuery({
    queryKey: ["organizations"],
    queryFn: () => fetchOrgs(),
  });
  const agendasQ = useQuery({
    queryKey: ["agendas"],
    queryFn: () => fetchAgendas(),
  });

  const orgs = orgsQ.data ?? [];
  const allAgendas = agendasQ.data ?? [];
  const [selectedOrgId, setSelectedOrgId] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  useEffect(() => {
    const stored = window.localStorage.getItem(SELECTED_ORG_STORAGE_KEY);
    if (stored) setSelectedOrgId(stored);
  }, []);

  const activeOrg = useMemo(
    () => (selectedOrgId !== "all" ? orgs.find((o) => o.id === selectedOrgId) ?? null : null),
    [orgs, selectedOrgId],
  );

  const effectiveOrgId = activeOrg ? activeOrg.id : "all";

  const agendas = useMemo(() => {
    if (effectiveOrgId === "all") return allAgendas;
    return allAgendas.filter((a) => a.organization_id === effectiveOrgId);
  }, [allAgendas, effectiveOrgId]);

  const activeId = selectedId ?? agendas[0]?.id;
  const activeAgenda = agendas.find((a) => a.id === activeId);
  const activeAgendaOrgName =
    (activeAgenda as { organizations?: { name?: string | null } | null } | undefined)
      ?.organizations?.name ?? activeOrg?.name ?? null;

  function handleSelectOrg(val: string) {
    setSelectedOrgId(val);
    setSelectedId(undefined);
    if (val === "all") {
      window.localStorage.removeItem(SELECTED_ORG_STORAGE_KEY);
    } else {
      window.localStorage.setItem(SELECTED_ORG_STORAGE_KEY, val);
    }
  }

  async function handleCreateOrg(name: string) {
    const created = await addOrg({ data: { name } });
    await qc.invalidateQueries({ queryKey: ["organizations"] });
    handleSelectOrg(created.id);
    return created;
  }

  const shellProps = {
    orgs,
    selectedOrgId: effectiveOrgId,
    activeOrgName: activeOrg?.name ?? null,
    onSelectOrg: handleSelectOrg,
    onCreateOrg: handleCreateOrg,
  };

  if (agendasQ.isLoading || orgsQ.isLoading) {
    return (
      <Shell {...shellProps}>
        <div className="text-muted-foreground">Loading…</div>
      </Shell>
    );
  }
  if (agendas.length === 0) {
    return (
      <Shell {...shellProps}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {activeOrg ? `No agendas yet for ${activeOrg.name}` : "No agendas yet"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload a council or public meeting agenda PDF to get started. AI will parse
              each item, identify departments, extract any disclosed costs, and write
              plain-language summaries.
            </p>
            {orgs.length === 0 && <InlineCreateOrg onCreate={handleCreateOrg} />}
            <div className="flex flex-wrap gap-2">
              <Link to="/upload">
                <Button>
                  <Upload className="mr-2 h-4 w-4" /> Upload an agenda
                </Button>
              </Link>
              {activeOrg && allAgendas.length > 0 && (
                <Button variant="outline" onClick={() => handleSelectOrg("all")}>
                  Show all cities & organizations ({allAgendas.length})
                </Button>
              )}
              <TestGeminiButton />
            </div>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell {...shellProps}>
      <div className="flex flex-wrap items-center gap-3">
        <Select value={activeId} onValueChange={setSelectedId}>
          <SelectTrigger className="w-[420px] max-w-full">
            <SelectValue placeholder="Select an agenda" />
          </SelectTrigger>
          <SelectContent>
            {agendas.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Link to="/upload">
          <Button variant="outline" size="sm">
            <Upload className="mr-2 h-4 w-4" /> Upload new agenda
          </Button>
        </Link>
        {activeId && (
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const a = agendas.find((x) => x.id === activeId);
              if (!confirm(`Delete agenda "${a?.title}"? This cannot be undone.`)) return;
              await delOne({ data: { id: activeId } });
              setSelectedId(undefined);
              qc.invalidateQueries({ queryKey: ["agendas"] });
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Delete agenda
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={async () => {
            if (!confirm(`Delete ALL ${allAgendas.length} agendas? This cannot be undone.`)) return;
            await delAll({});
            setSelectedId(undefined);
            qc.invalidateQueries({ queryKey: ["agendas"] });
            router.invalidate();
          }}
        >
          <Trash2 className="mr-2 h-4 w-4" /> Delete all
        </Button>
        <TestGeminiButton />
      </div>
      {activeId && <AgendaDashboard agendaId={activeId} orgName={activeAgendaOrgName} />}
    </Shell>
  );
}

function TestGeminiButton() {
  const test = useServerFn(testAIConnection);
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "running" }
    | { status: "ok"; ms: number; itemsParsed: number; usingLovable: boolean }
    | { status: "error"; error: string; usingLovable: boolean }
  >({ status: "idle" });

  async function run() {
    setState({ status: "running" });
    try {
      const r = await test({});
      if (r.ok) {
        setState({
          status: "ok",
          ms: r.ms,
          itemsParsed: r.itemsParsed,
          usingLovable: r.usingLovable,
        });
      } else {
        setState({ status: "error", error: r.error, usingLovable: r.usingLovable });
      }
    } catch (err) {
      setState({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        usingLovable: true,
      });
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={run}
        disabled={state.status === "running"}
      >
        {state.status === "running" ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : state.status === "ok" ? (
          <CheckCircle2 className="mr-2 h-4 w-4 text-green-600" />
        ) : state.status === "error" ? (
          <XCircle className="mr-2 h-4 w-4 text-destructive" />
        ) : (
          <Sparkles className="mr-2 h-4 w-4" />
        )}
        Test AI connection
      </Button>
      {state.status === "ok" && (
        <span className="text-xs text-muted-foreground">
          {state.usingLovable ? "Lovable AI" : "Fallback (your Gemini key)"} · parsed{" "}
          {state.itemsParsed} item{state.itemsParsed === 1 ? "" : "s"} in{" "}
          {state.ms} ms
        </span>
      )}
      {state.status === "error" && (
        <span className="text-xs text-destructive">{state.error}</span>
      )}
    </div>
  );
}

function InlineCreateOrg({
  onCreate,
  onCancel,
}: {
  onCreate: (name: string) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a city or organization name.");
      return;
    }
    if (trimmed.length > 120) {
      setError("Name must be 120 characters or fewer.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onCreate(trimmed);
      setName("");
      onCancel?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save organization.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="City or organization name"
          placeholder="Create a city or organization (e.g. City of Austin, TX)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 w-72 max-w-full"
          disabled={busy}
        />
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}

function Shell({
  children,
  orgs,
  selectedOrgId,
  activeOrgName,
  onSelectOrg,
  onCreateOrg,
}: {
  children: React.ReactNode;
  orgs: Array<{ id: string; name: string }>;
  selectedOrgId: string;
  activeOrgName: string | null;
  onSelectOrg: (id: string) => void;
  onCreateOrg: (name: string) => Promise<unknown>;
}) {
  const [addingOrg, setAddingOrg] = useState(false);

  return (
    <div>
      <header className="border-b">
        <div className="container mx-auto flex flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <img
              src="/civicplexus-mark.png"
              alt="CivicPlexus"
              className="h-9 w-9 shrink-0 rounded-md"
            />
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Part of the CivicPlexus family of sites
              </div>
              <h1 className="text-xl font-semibold">
                {activeOrgName ? `${activeOrgName} — Agenda Dashboard` : "CivicPlexus Agenda"}
              </h1>
              <p className="text-sm text-muted-foreground">
                Plain-language summaries · departments · disclosed costs
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {addingOrg ? (
              <InlineCreateOrg onCreate={onCreateOrg} onCancel={() => setAddingOrg(false)} />
            ) : (
              <>
                {orgs.length > 0 && (
                  <Select value={selectedOrgId} onValueChange={onSelectOrg}>
                    <SelectTrigger className="w-64 max-w-full" aria-label="Select city or organization">
                      <Building2 className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                      <SelectValue placeholder="All cities & orgs" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All cities & organizations</SelectItem>
                      {orgs.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button variant="outline" size="sm" onClick={() => setAddingOrg(true)}>
                  <Plus className="mr-1.5 h-4 w-4" /> New city / org
                </Button>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="container mx-auto space-y-6 px-6 py-6">{children}</main>
    </div>
  );
}

function AgendaDashboard({
  agendaId,
  orgName,
}: {
  agendaId: string;
  orgName: string | null;
}) {
  const fetchAgenda = useServerFn(getAgenda);
  const enrich = useServerFn(enrichAgenda);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["agenda", agendaId],
    queryFn: () => fetchAgenda({ data: { id: agendaId } }),
  });
  const enrichMut = useMutation({
    mutationFn: () => enrich({ data: { agendaId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agenda", agendaId] }),
  });

  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [grantsOnly, setGrantsOnly] = useState(false);

  const allItems = q.data?.items ?? [];
  // Exclude Minutes — they're not policy items and clutter the dashboard.
  const items = allItems.filter((i) => i.item_type !== "Minutes");

  const departments = useMemo(
    () => Array.from(new Set(items.map((i) => i.department).filter(Boolean))).sort(),
    [items],
  );
  const types = useMemo(
    () => Array.from(new Set(items.map((i) => i.item_type).filter(Boolean))).sort(),
    [items],
  );

  const filtered = items.filter((i) => {
    if (grantsOnly && !i.is_grant) return false;
    if (deptFilter !== "all" && i.department !== deptFilter) return false;
    if (typeFilter !== "all" && i.item_type !== typeFilter) return false;
    if (search) {
      const hay = `${i.raw_title} ${i.plain_summary ?? ""} ${i.item_number ?? ""}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const nonGrantItems = items.filter((i) => !i.is_grant);
  const grantItems = items.filter((i) => i.is_grant);
  const totalCost = nonGrantItems.reduce((sum, i) => sum + (Number(i.cost_numeric) || 0), 0);
  const disclosed = nonGrantItems.filter((i) => i.cost_numeric != null).length;
  const grantIncome = grantItems.reduce(
    (sum, i) => sum + (Number(i.grant_award_amount) || 0),
    0,
  );
  const grantMatch = grantItems.reduce(
    (sum, i) => sum + (Number(i.grant_match_amount) || 0),
    0,
  );

  const byDept = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((i) => {
      if (!i.department) return;
      map.set(i.department, (map.get(i.department) || 0) + 1);
    });
    return Array.from(map, ([department, count]) => ({ department, count })).sort(
      (a, b) => b.count - a.count,
    );
  }, [items]);

  const byType = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((i) => {
      const t = i.item_type ?? "Other";
      map.set(t, (map.get(t) || 0) + 1);
    });
    return Array.from(map, ([type, count]) => ({ type, count }));
  }, [items]);

  const enrichedCount = items.filter((i) => i.enrichment_status === "done").length;
  const pendingCount = items.filter((i) => i.enrichment_status === "pending").length;

  if (q.isLoading) return <div className="text-muted-foreground">Loading agenda…</div>;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          Staff reports parsed: <span className="font-medium text-foreground">{enrichedCount}</span> of {items.length}
          {enrichMut.isPending && " · reading staff reports…"}
        </div>
        <Button
          size="sm"
          onClick={() => enrichMut.mutate()}
          disabled={enrichMut.isPending || pendingCount === 0}
        >
          <Sparkles className="mr-2 h-4 w-4" />
          {pendingCount === 0
            ? "All items enriched"
            : `Fetch ${pendingCount} staff report${pendingCount === 1 ? "" : "s"}`}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Total items" value={items.length.toString()} />
        <Stat label="With disclosed cost" value={`${disclosed} of ${nonGrantItems.length}`} />
        <Stat
          label="Disclosed cost total (non-grant)"
          value={
            totalCost > 0
              ? `$${totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
              : "—"
          }
        />
        <Stat label="Departments involved" value={departments.length.toString()} />
      </div>

      {grantItems.length > 0 && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">
                Grants — {grantItems.length} item{grantItems.length === 1 ? "" : "s"}
              </CardTitle>
              <Button
                size="sm"
                variant={grantsOnly ? "default" : "outline"}
                onClick={() => setGrantsOnly((v) => !v)}
              >
                {grantsOnly ? "Showing grants only" : "Show grants only"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <Stat
              label="Potential income (awards in)"
              value={grantIncome > 0 ? `$${grantIncome.toLocaleString()}` : "—"}
            />
            <Stat
              label="Potential local cost (match)"
              value={grantMatch > 0 ? `$${grantMatch.toLocaleString()}` : "$0"}
            />
            <Stat
              label={orgName ? `Net potential to ${orgName}` : "Net potential to organization"}
              value={
                grantIncome - grantMatch !== 0
                  ? `${grantIncome - grantMatch >= 0 ? "+" : "−"}$${Math.abs(grantIncome - grantMatch).toLocaleString()}`
                  : "—"
              }
            />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Items by department</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byDept} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="department" width={160} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" fill="var(--chart-1)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Items by type</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={byType}
                  dataKey="count"
                  nameKey="type"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label
                >
                  {byType.map((entry) => (
                    <Cell key={entry.type} fill={TYPE_COLORS[entry.type] || "var(--chart-1)"} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle className="text-base">Agenda items</CardTitle>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search items…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-64 pl-8"
                />
              </div>
              <Select value={deptFilter} onValueChange={setDeptFilter}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All departments</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d} value={d!}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {types.map((t) => (
                    <SelectItem key={t} value={t!}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Item #</TableHead>
                  <TableHead className="w-32">Type</TableHead>
                  <TableHead className="w-48">Department</TableHead>
                  <TableHead>Plain-language summary</TableHead>
                  <TableHead className="w-32 text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((it) => {
                  const flagged =
                    it.on_consent && (Number(it.cost_numeric) || 0) > 1_000_000;
                  return (
                    <TableRow
                      key={it.id}
                      className={
                        "align-top " +
                        (flagged
                          ? "bg-destructive/5 hover:bg-destructive/10 border-l-2 border-l-destructive/60"
                          : "")
                      }
                    >
                      <TableCell className="font-mono text-xs">
                        <Link
                          to="/item/$id"
                          params={{ id: it.id }}
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {it.item_number || "—"}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{it.item_type}</Badge>
                        {it.on_consent && (
                          <Badge variant="outline" className="ml-1 text-[10px]">
                            Consent
                          </Badge>
                        )}
                        {it.is_grant && (
                          <Badge className="ml-1 border-emerald-500/40 bg-emerald-500/15 text-[10px] text-emerald-800 dark:text-emerald-300">
                            Grant
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{it.department}</TableCell>
                      <TableCell className="text-sm">
                        <Link
                          to="/item/$id"
                          params={{ id: it.id }}
                          className="block font-medium hover:underline"
                        >
                          {it.raw_title.length > 110
                            ? it.raw_title.slice(0, 110) + "…"
                            : it.raw_title}
                        </Link>
                        <span className="mt-1 block text-muted-foreground">
                          {it.plain_summary}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {it.is_grant ? (
                          <div className="space-y-0.5">
                            {it.grant_award_amount != null && (
                              <div className="font-medium text-emerald-700 dark:text-emerald-400">
                                +${Number(it.grant_award_amount).toLocaleString()} in
                              </div>
                            )}
                            {it.grant_match_amount != null && Number(it.grant_match_amount) > 0 && (
                              <div className="text-xs text-muted-foreground">
                                −${Number(it.grant_match_amount).toLocaleString()} match
                              </div>
                            )}
                            {it.grant_award_amount == null && it.grant_match_amount == null && (
                              <span className="text-muted-foreground">Amount pending</span>
                            )}
                          </div>
                        ) : it.cost_estimate ? (
                          <span
                            className={
                              flagged ? "font-semibold text-destructive" : "font-medium"
                            }
                          >
                            {it.cost_estimate}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Not disclosed</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      <FileText className="mx-auto mb-2 h-5 w-5" />
                      No items match the filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
