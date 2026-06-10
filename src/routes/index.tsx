import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  listAgendas,
  getAgenda,
  seedDefaultAgendaIfEmpty,
  enrichAgenda,
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
import { Upload, FileText, Search } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "McKinney Council Agenda Dashboard" },
      {
        name: "description",
        content:
          "Plain-language dashboard for McKinney, TX City Council agenda items — costs, departments, and summaries.",
      },
    ],
  }),
  component: Dashboard,
  errorComponent: ({ error }) => (
    <div className="p-8 text-destructive">Error: {error.message}</div>
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
  const seed = useServerFn(seedDefaultAgendaIfEmpty);
  const fetchAgendas = useServerFn(listAgendas);

  const agendasQ = useQuery({
    queryKey: ["agendas"],
    queryFn: () => fetchAgendas(),
  });

  // On first load, if no agendas, seed the bundled June 16 agenda.
  const [seeding, setSeeding] = useState(false);
  useEffect(() => {
    if (agendasQ.data && agendasQ.data.length === 0 && !seeding) {
      setSeeding(true);
      seed({})
        .then(() => router.invalidate())
        .finally(() => setSeeding(false));
    }
  }, [agendasQ.data, seed, router, seeding]);

  const agendas = agendasQ.data ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const activeId = selectedId ?? agendas[0]?.id;

  if (agendasQ.isLoading) {
    return <Shell><div className="text-muted-foreground">Loading…</div></Shell>;
  }
  if (seeding || (agendas.length === 0)) {
    return (
      <Shell>
        <div className="text-muted-foreground">
          Parsing the June 16, 2026 agenda with AI — this takes ~20 seconds the first time…
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
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
      </div>
      {activeId && <AgendaDashboard agendaId={activeId} />}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold">McKinney Council Agenda Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Plain-language summaries · departments · disclosed costs
            </p>
          </div>
        </div>
      </header>
      <main className="container mx-auto space-y-6 px-6 py-6">{children}</main>
    </div>
  );
}

function AgendaDashboard({ agendaId }: { agendaId: string }) {
  const fetchAgenda = useServerFn(getAgenda);
  const q = useQuery({
    queryKey: ["agenda", agendaId],
    queryFn: () => fetchAgenda({ data: { id: agendaId } }),
  });

  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const items = q.data?.items ?? [];

  const departments = useMemo(
    () => Array.from(new Set(items.map((i) => i.department).filter(Boolean))).sort(),
    [items],
  );
  const types = useMemo(
    () => Array.from(new Set(items.map((i) => i.item_type).filter(Boolean))).sort(),
    [items],
  );

  const filtered = items.filter((i) => {
    if (deptFilter !== "all" && i.department !== deptFilter) return false;
    if (typeFilter !== "all" && i.item_type !== typeFilter) return false;
    if (search) {
      const hay = `${i.raw_title} ${i.plain_summary ?? ""} ${i.item_number ?? ""}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const totalCost = items.reduce((sum, i) => sum + (Number(i.cost_numeric) || 0), 0);
  const disclosed = items.filter((i) => i.cost_numeric != null).length;

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

  if (q.isLoading) return <div className="text-muted-foreground">Loading agenda…</div>;

  return (
    <>
      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Total items" value={items.length.toString()} />
        <Stat label="With disclosed cost" value={`${disclosed} of ${items.length}`} />
        <Stat
          label="Disclosed cost total"
          value={
            totalCost > 0
              ? `$${totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
              : "—"
          }
        />
        <Stat label="Departments involved" value={departments.length.toString()} />
      </div>

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
                {filtered.map((it) => (
                  <TableRow key={it.id} className="align-top">
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
                      {it.cost_estimate ? (
                        <span className="font-medium">{it.cost_estimate}</span>
                      ) : (
                        <span className="text-muted-foreground">Not disclosed</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
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
