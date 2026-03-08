import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart3, Users, FileText, CheckCircle2, Lock, MessageSquare,
  Calendar, Brain, Zap, TrendingUp, Shield, Activity, Smartphone,
  Globe, Mail, Heart
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";

interface AnalyticsData {
  overview: {
    totalUsers: number;
    newUsersLast30d: number;
    activeUsersLast7d: number;
    totalCouples: number;
    totalLists: number;
  };
  notes: {
    total: number;
    createdLast7d: number;
    completed: number;
    completionRate: number;
    sensitive: number;
    sensitiveRate: number;
    byCategory: Record<string, number>;
    bySource: Record<string, number>;
    byPriority: Record<string, number>;
    dailyCreation: Record<string, number>;
  };
  channels: {
    whatsappNotes: number;
    calendarConnections: number;
    calendarEvents: number;
    ouraConnections: number;
    emailConnections: number;
  };
  ai: {
    totalRouterCalls: number;
    avgConfidence: number;
    intentDistribution: Record<string, number>;
    agentRuns: number;
    agentCompleted: number;
    agentSuccessRate: number;
  };
  memory: {
    totalFiles: number;
    totalChunks: number;
  };
  privacy: {
    distribution: Record<string, number>;
    decryptionAuditEvents: number;
  };
  engagement: {
    totalNotifications: number;
    totalFeedback: number;
    totalBetaRequests: number;
  };
}

const CHART_COLORS = [
  "hsl(142, 71%, 45%)", // primary green
  "hsl(47, 96%, 53%)",  // amber
  "hsl(199, 89%, 48%)", // blue
  "hsl(340, 82%, 52%)", // rose
  "hsl(262, 83%, 58%)", // violet
  "hsl(24, 95%, 53%)",  // orange
  "hsl(173, 80%, 40%)", // teal
  "hsl(315, 70%, 50%)", // fuchsia
];

function KpiCard({ icon: Icon, label, value, sub, color = "text-primary" }: {
  icon: any; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`h-10 w-10 shrink-0 rounded-full bg-primary/10 flex items-center justify-center`}>
          <Icon className={`h-5 w-5 ${color}`} />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-bold text-foreground">{value}</p>
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          {sub && <p className="text-[10px] text-muted-foreground/70">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function toChartArray(map: Record<string, number>) {
  return Object.entries(map)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

function toDailyChart(map: Record<string, number>) {
  return Object.entries(map)
    .map(([date, count]) => ({ date: date.substring(5), count })) // MM-DD
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function AnalyticsDashboard({ data, loading }: { data: AnalyticsData | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!data) return <p className="text-muted-foreground text-center py-12">No analytics data available.</p>;

  const categoryData = toChartArray(data.notes.byCategory);
  const sourceData = toChartArray(data.notes.bySource);
  const intentData = toChartArray(data.ai.intentDistribution).slice(0, 10);
  const dailyData = toDailyChart(data.notes.dailyCreation);
  const privacyData = toChartArray(data.privacy.distribution);
  const priorityData = toChartArray(data.notes.byPriority);

  return (
    <div className="space-y-6">
      {/* Section: Overview KPIs */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <TrendingUp className="h-4 w-4" /> Overview
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={Users} label="Total Users" value={data.overview.totalUsers} sub={`+${data.overview.newUsersLast30d} last 30d`} />
          <KpiCard icon={Activity} label="Active (7d)" value={data.overview.activeUsersLast7d} />
          <KpiCard icon={Heart} label="Couples" value={data.overview.totalCouples} />
          <KpiCard icon={FileText} label="Total Lists" value={data.overview.totalLists} />
        </div>
      </div>

      {/* Section: Notes & Tasks */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <FileText className="h-4 w-4" /> Notes & Tasks
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={FileText} label="Total Notes" value={data.notes.total} sub={`+${data.notes.createdLast7d} last 7d`} />
          <KpiCard icon={CheckCircle2} label="Completed" value={data.notes.completed} sub={`${data.notes.completionRate}% rate`} color="text-emerald-600" />
          <KpiCard icon={Lock} label="Sensitive" value={data.notes.sensitive} sub={`${data.notes.sensitiveRate}% of total`} color="text-amber-600" />
          <KpiCard icon={MessageSquare} label="Via WhatsApp" value={data.channels.whatsappNotes} color="text-emerald-500" />
        </div>
      </div>

      {/* Daily Creation Trend */}
      {dailyData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-foreground">Notes Created — Last 30 Days</CardTitle>
          </CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="count" stroke="hsl(142, 71%, 45%)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Category & Source Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {categoryData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">By Category</CardTitle>
            </CardHeader>
            <CardContent className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="value" fill="hsl(142, 71%, 45%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {sourceData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">By Source</CardTitle>
            </CardHeader>
            <CardContent className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={sourceData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                    {sourceData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Priority distribution */}
      {priorityData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">By Priority</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {priorityData.map((p) => (
                <Badge key={p.name} variant="outline" className="text-sm py-1 px-3">
                  {p.name}: <span className="font-bold ml-1">{p.value}</span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Section: AI & Intelligence */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <Brain className="h-4 w-4" /> AI & Intelligence
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={Zap} label="Router Calls" value={data.ai.totalRouterCalls} />
          <KpiCard icon={BarChart3} label="Avg Confidence" value={`${data.ai.avgConfidence}%`} color={data.ai.avgConfidence >= 80 ? "text-emerald-600" : "text-amber-600"} />
          <KpiCard icon={Activity} label="Agent Runs" value={data.ai.agentRuns} sub={`${data.ai.agentSuccessRate}% success`} />
          <KpiCard icon={Brain} label="Memory Chunks" value={data.memory.totalChunks} sub={`${data.memory.totalFiles} files`} />
        </div>
      </div>

      {/* Intent Distribution */}
      {intentData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Top Intent Classifications</CardTitle>
          </CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={intentData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" angle={-30} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="value" fill="hsl(199, 89%, 48%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Section: Integrations & Channels */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <Globe className="h-4 w-4" /> Integrations & Channels
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={Calendar} label="Calendar Links" value={data.channels.calendarConnections} sub={`${data.channels.calendarEvents} events`} />
          <KpiCard icon={Smartphone} label="WhatsApp Notes" value={data.channels.whatsappNotes} color="text-emerald-500" />
          <KpiCard icon={Heart} label="Oura Links" value={data.channels.ouraConnections} color="text-violet-500" />
          <KpiCard icon={Mail} label="Email Links" value={data.channels.emailConnections} color="text-blue-500" />
        </div>
      </div>

      {/* Section: Privacy & Compliance */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <Shield className="h-4 w-4" /> Privacy & Compliance
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <KpiCard icon={Lock} label="Encrypted Notes" value={data.notes.sensitive} sub={`${data.notes.sensitiveRate}% adoption`} color="text-amber-600" />
          <KpiCard icon={Shield} label="Audit Events" value={data.privacy.decryptionAuditEvents} sub="Decryption logs" />
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-2">Default Privacy Preference</p>
              <div className="flex flex-wrap gap-1.5">
                {privacyData.map((p) => (
                  <Badge key={p.name} variant={p.name === "private" ? "default" : "outline"} className="text-xs">
                    {p.name}: {p.value}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Section: Engagement */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <MessageSquare className="h-4 w-4" /> Engagement
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <KpiCard icon={Users} label="Beta Requests" value={data.engagement.totalBetaRequests} />
          <KpiCard icon={MessageSquare} label="Feedback" value={data.engagement.totalFeedback} />
          <KpiCard icon={Activity} label="Notifications Sent" value={data.engagement.totalNotifications} />
        </div>
      </div>
    </div>
  );
}
