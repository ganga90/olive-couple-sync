import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart3, Users, FileText, CheckCircle2, Lock, MessageSquare,
  Calendar, Brain, Zap, TrendingUp, Shield, Activity, Smartphone,
  Globe, Mail, Heart, Info, ChevronDown, ChevronUp, UserCheck,
  UserPlus, Repeat
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface AnalyticsData {
  overview: {
    totalUsers: number;
    newUsersLast30d: number;
    dau: number;
    wau: number;
    mau: number;
    totalCouples: number;
    totalLists: number;
  };
  retention: {
    d7Retention: number;
    d7Eligible: number;
    d7Retained: number;
    d30Retention: number;
    d30Eligible: number;
    d30Retained: number;
    cohort: { week: string; signups: number; retained: number }[];
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
  "hsl(142, 71%, 45%)",
  "hsl(47, 96%, 53%)",
  "hsl(199, 89%, 48%)",
  "hsl(340, 82%, 52%)",
  "hsl(262, 83%, 58%)",
  "hsl(24, 95%, 53%)",
  "hsl(173, 80%, 40%)",
  "hsl(315, 70%, 50%)",
];

// ── Metric Definitions ──
const METRIC_DEFINITIONS: Record<string, string> = {
  "Total Users": "Count of unique rows in clerk_profiles. Each row = one Clerk-authenticated user. Deduplicated by Clerk user ID.",
  "New Users (30d)": "Unique profiles created in the last 30 calendar days (clerk_profiles.created_at ≥ now - 30d).",
  "DAU": "Daily Active Users — distinct author_id values on clerk_notes created today (UTC). Measures users who created or saved at least 1 note today.",
  "WAU": "Weekly Active Users — distinct author_id values on clerk_notes created in the last 7 days. Users who created ≥1 note in the past week.",
  "MAU": "Monthly Active Users — distinct author_id values on clerk_notes created in the last 30 days.",
  "Couples": "Count of rows in clerk_couples. Each row = one shared space created by a user.",
  "Total Lists": "Count of rows in clerk_lists. Includes both auto-created and manual lists.",
  "Total Notes": "Count of all rows in clerk_notes regardless of status, source, or completion.",
  "Notes (7d)": "clerk_notes created in the last 7 days.",
  "Completed": "clerk_notes where completed = true. Completion rate = completed / total × 100.",
  "Sensitive": "clerk_notes where is_sensitive = true. These have encrypted_original_text stored.",
  "Via WhatsApp": "clerk_notes where source = 'whatsapp'. These are notes processed from the WhatsApp webhook (whatsapp-webhook → process-note pipeline).",
  "D7 Retention": "Of users who signed up ≥7 days ago, what % created a note in the last 7 days. Formula: (retained / eligible) × 100.",
  "D30 Retention": "Of users who signed up ≥30 days ago, what % created a note in the last 30 days.",
  "Cohort": "Weekly signup cohorts (last 8 weeks). 'Retained' = users from that cohort who were active in the last 7 days.",
  "Router Calls": "Total rows in olive_router_log. Each row = one AI intent classification call.",
  "Avg Confidence": "Mean of olive_router_log.confidence × 100. Higher = more certain intent classification.",
  "Agent Runs": "Total rows in olive_agent_runs. Success rate = completed / total × 100.",
  "Memory Chunks": "Total rows in olive_memory_chunks. Files = olive_memory_files rows.",
  "By Category": "Breakdown of clerk_notes.category. Set by AI during note processing.",
  "By Source": "Breakdown of clerk_notes.source. Values: 'web' (app), 'whatsapp' (webhook), 'voice' (voice input). Normalized to lowercase.",
  "By Priority": "Breakdown of clerk_notes.priority enum: urgent, high, medium, low, none.",
  "Calendar Links": "Active calendar_connections (is_active = true). Events = total calendar_events rows.",
  "Oura Links": "Active oura_connections (is_active = true).",
  "Email Links": "Active olive_email_connections (is_active = true).",
  "Encrypted Notes": "Same as Sensitive notes — notes with is_sensitive = true and encrypted content.",
  "Audit Events": "Rows in decryption_audit_log. Each row = one server-side note decryption event.",
  "Beta Requests": "beta_feedback rows where category = 'beta_request'.",
  "Feedback": "beta_feedback rows where category ≠ 'beta_request'.",
  "Notifications": "Total rows in notifications table. Includes reminders, nudges, and system notifications.",
};

function MetricDef({ name }: { name: string }) {
  const def = METRIC_DEFINITIONS[name];
  if (!def) return null;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className="h-3 w-3 text-muted-foreground/50 cursor-help inline ml-1 shrink-0" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
          <p className="font-semibold mb-1">{name}</p>
          <p>{def}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function KpiCard({ icon: Icon, label, value, sub, color = "text-primary", defKey }: {
  icon: any; label: string; value: string | number; sub?: string; color?: string; defKey?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="h-10 w-10 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
          <Icon className={`h-5 w-5 ${color}`} />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-bold text-foreground">{value}</p>
          <p className="text-xs text-muted-foreground truncate flex items-center">
            {label}
            {defKey && <MetricDef name={defKey} />}
          </p>
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
    .map(([date, count]) => ({ date: date.substring(5), count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function SectionHeader({ icon: Icon, title, children }: { icon: any; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
        <Icon className="h-4 w-4" /> {title}
      </h3>
      {children}
    </div>
  );
}

export function AnalyticsDashboard({ data, loading }: { data: AnalyticsData | null; loading: boolean }) {
  const [showDefinitions, setShowDefinitions] = useState(false);

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
  const cohortData = (data.retention?.cohort || []).map(c => ({
    ...c,
    retentionRate: c.signups > 0 ? Math.round((c.retained / c.signups) * 100) : 0,
  }));

  return (
    <div className="space-y-6">
      {/* Metric Definitions Collapsible */}
      <Collapsible open={showDefinitions} onOpenChange={setShowDefinitions}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full border border-border rounded-lg px-3 py-2 bg-muted/30">
            <Info className="h-3.5 w-3.5" />
            <span className="font-medium">Metric Definitions & Methodology</span>
            {showDefinitions ? <ChevronUp className="h-3.5 w-3.5 ml-auto" /> : <ChevronDown className="h-3.5 w-3.5 ml-auto" />}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Card className="mt-2">
            <CardContent className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                {Object.entries(METRIC_DEFINITIONS).map(([key, def]) => (
                  <div key={key} className="py-1.5 border-b border-border/50 last:border-0">
                    <p className="text-xs font-semibold text-foreground">{key}</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{def}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {/* Section: Overview KPIs */}
      <div>
        <SectionHeader icon={TrendingUp} title="Overview" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={Users} label="Total Users" value={data.overview.totalUsers} sub={`+${data.overview.newUsersLast30d} last 30d`} defKey="Total Users" />
          <KpiCard icon={UserCheck} label="DAU" value={data.overview.dau} defKey="DAU" />
          <KpiCard icon={Activity} label="WAU" value={data.overview.wau} defKey="WAU" />
          <KpiCard icon={UserPlus} label="MAU" value={data.overview.mau} defKey="MAU" />
          <KpiCard icon={Heart} label="Couples" value={data.overview.totalCouples} defKey="Couples" />
          <KpiCard icon={FileText} label="Total Lists" value={data.overview.totalLists} defKey="Total Lists" />
        </div>
      </div>

      {/* Section: Retention */}
      <div>
        <SectionHeader icon={Repeat} title="Retention" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <KpiCard
            icon={Repeat}
            label="D7 Retention"
            value={`${data.retention?.d7Retention || 0}%`}
            sub={`${data.retention?.d7Retained || 0} of ${data.retention?.d7Eligible || 0} eligible`}
            color={((data.retention?.d7Retention || 0) >= 40) ? "text-emerald-600" : "text-amber-600"}
            defKey="D7 Retention"
          />
          <KpiCard
            icon={Repeat}
            label="D30 Retention"
            value={`${data.retention?.d30Retention || 0}%`}
            sub={`${data.retention?.d30Retained || 0} of ${data.retention?.d30Eligible || 0} eligible`}
            color={((data.retention?.d30Retention || 0) >= 25) ? "text-emerald-600" : "text-amber-600"}
            defKey="D30 Retention"
          />
        </div>

        {/* Cohort Chart */}
        {cohortData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center">
                Weekly Signup Cohort — 7d Retention
                <MetricDef name="Cohort" />
              </CardTitle>
            </CardHeader>
            <CardContent className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cohortData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                  <RechartsTooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(value: any, name: string) => {
                      if (name === "signups") return [value, "Signups"];
                      if (name === "retained") return [value, "Retained (7d)"];
                      return [value, name];
                    }}
                  />
                  <Bar dataKey="signups" fill="hsl(199, 89%, 48%)" radius={[4, 4, 0, 0]} name="signups" />
                  <Bar dataKey="retained" fill="hsl(142, 71%, 45%)" radius={[4, 4, 0, 0]} name="retained" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Section: Notes & Tasks */}
      <div>
        <SectionHeader icon={FileText} title="Notes & Tasks" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={FileText} label="Total Notes" value={data.notes.total} sub={`+${data.notes.createdLast7d} last 7d`} defKey="Total Notes" />
          <KpiCard icon={CheckCircle2} label="Completed" value={data.notes.completed} sub={`${data.notes.completionRate}% rate`} color="text-emerald-600" defKey="Completed" />
          <KpiCard icon={Lock} label="Sensitive" value={data.notes.sensitive} sub={`${data.notes.sensitiveRate}% of total`} color="text-amber-600" defKey="Sensitive" />
          <KpiCard icon={MessageSquare} label="Via WhatsApp" value={data.channels.whatsappNotes} color="text-emerald-500" defKey="Via WhatsApp" />
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
                <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
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
              <CardTitle className="text-sm font-medium flex items-center">By Category<MetricDef name="By Category" /></CardTitle>
            </CardHeader>
            <CardContent className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} stroke="hsl(var(--muted-foreground))" />
                  <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="value" fill="hsl(142, 71%, 45%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {sourceData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center">By Source<MetricDef name="By Source" /></CardTitle>
            </CardHeader>
            <CardContent className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={sourceData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                    {sourceData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
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
            <CardTitle className="text-sm font-medium flex items-center">By Priority<MetricDef name="By Priority" /></CardTitle>
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
        <SectionHeader icon={Brain} title="AI & Intelligence" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={Zap} label="Router Calls" value={data.ai.totalRouterCalls} defKey="Router Calls" />
          <KpiCard icon={BarChart3} label="Avg Confidence" value={`${data.ai.avgConfidence}%`} color={data.ai.avgConfidence >= 80 ? "text-emerald-600" : "text-amber-600"} defKey="Avg Confidence" />
          <KpiCard icon={Activity} label="Agent Runs" value={data.ai.agentRuns} sub={`${data.ai.agentSuccessRate}% success`} defKey="Agent Runs" />
          <KpiCard icon={Brain} label="Memory Chunks" value={data.memory.totalChunks} sub={`${data.memory.totalFiles} files`} defKey="Memory Chunks" />
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
                <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="value" fill="hsl(199, 89%, 48%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Section: Integrations & Channels */}
      <div>
        <SectionHeader icon={Globe} title="Integrations & Channels" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={Calendar} label="Calendar Links" value={data.channels.calendarConnections} sub={`${data.channels.calendarEvents} events`} defKey="Calendar Links" />
          <KpiCard icon={Smartphone} label="WhatsApp Notes" value={data.channels.whatsappNotes} color="text-emerald-500" defKey="Via WhatsApp" />
          <KpiCard icon={Heart} label="Oura Links" value={data.channels.ouraConnections} color="text-violet-500" defKey="Oura Links" />
          <KpiCard icon={Mail} label="Email Links" value={data.channels.emailConnections} color="text-blue-500" defKey="Email Links" />
        </div>
      </div>

      {/* Section: Privacy & Compliance */}
      <div>
        <SectionHeader icon={Shield} title="Privacy & Compliance" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <KpiCard icon={Lock} label="Encrypted Notes" value={data.notes.sensitive} sub={`${data.notes.sensitiveRate}% adoption`} color="text-amber-600" defKey="Encrypted Notes" />
          <KpiCard icon={Shield} label="Audit Events" value={data.privacy.decryptionAuditEvents} sub="Decryption logs" defKey="Audit Events" />
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
        <SectionHeader icon={MessageSquare} title="Engagement" />
        <div className="grid grid-cols-3 gap-3">
          <KpiCard icon={Users} label="Beta Requests" value={data.engagement.totalBetaRequests} defKey="Beta Requests" />
          <KpiCard icon={MessageSquare} label="Feedback" value={data.engagement.totalFeedback} defKey="Feedback" />
          <KpiCard icon={Activity} label="Notifications Sent" value={data.engagement.totalNotifications} defKey="Notifications" />
        </div>
      </div>
    </div>
  );
}
