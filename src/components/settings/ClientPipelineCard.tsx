/**
 * ClientPipelineCard — Visual client pipeline with stage-based columns.
 *
 * Shows pipeline stats, follow-up alerts, and quick client management.
 * Designed for compact display in settings/profile with expand capability.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  UserPlus,
  Phone,
  Mail,
  Calendar,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  DollarSign,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useBusinessTools, Client, PipelineStats, FollowUp } from "@/hooks/useBusinessTools";
import { useSpace } from "@/providers/SpaceProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { formatDistanceToNow } from "date-fns";

const STAGE_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  lead: { label: "Lead", color: "text-blue-600", bgColor: "bg-blue-50" },
  prospect: { label: "Prospect", color: "text-violet-600", bgColor: "bg-violet-50" },
  active: { label: "Active", color: "text-emerald-600", bgColor: "bg-emerald-50" },
  completed: { label: "Done", color: "text-stone-500", bgColor: "bg-stone-50" },
  lost: { label: "Lost", color: "text-red-500", bgColor: "bg-red-50" },
  paused: { label: "Paused", color: "text-amber-500", bgColor: "bg-amber-50" },
};

const ACTIVE_STAGES = ["lead", "prospect", "active"];

interface ClientPipelineCardProps {
  className?: string;
}

export const ClientPipelineCard: React.FC<ClientPipelineCardProps> = ({ className }) => {
  const { listClients, createClient, updateClient, getPipelineStats, getFollowUps } = useBusinessTools();
  const { currentSpace } = useSpace();
  const { notifySuccess, impactMedium } = useHaptics();
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [followUps, setFollowUps] = useState<{ overdue: FollowUp[]; upcoming: FollowUp[] }>({ overdue: [], upcoming: [] });
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showClients, setShowClients] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientCompany, setNewClientCompany] = useState("");
  const [adding, setAdding] = useState(false);

  const fetchData = useCallback(async () => {
    if (!currentSpace) return;
    setLoading(true);
    const [statsData, followUpData, clientsData] = await Promise.all([
      getPipelineStats(currentSpace.id),
      getFollowUps(currentSpace.id),
      listClients(currentSpace.id, { limit: 10 }),
    ]);
    setStats(statsData);
    setFollowUps(followUpData);
    setClients(clientsData.clients);
    setLoading(false);
  }, [getPipelineStats, getFollowUps, listClients, currentSpace]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddClient = async () => {
    if (!currentSpace || !newClientName.trim()) return;
    setAdding(true);
    const result = await createClient({
      space_id: currentSpace.id,
      name: newClientName.trim(),
      company: newClientCompany.trim() || undefined,
    });
    if (result?.success) {
      notifySuccess();
      toast.success(`${newClientName} added as a new lead`);
      setNewClientName("");
      setNewClientCompany("");
      setShowAddForm(false);
      await fetchData();
    } else {
      toast.error(result?.error || "Failed to add client");
    }
    setAdding(false);
  };

  const handleAdvanceStage = async (client: Client) => {
    impactMedium();
    const nextStage: Record<string, string> = {
      lead: "prospect",
      prospect: "active",
      active: "completed",
    };
    const next = nextStage[client.stage];
    if (!next) return;

    const result = await updateClient(client.id, { stage: next } as any);
    if (result?.success) {
      toast.success(`${client.name} moved to ${STAGE_CONFIG[next]?.label}`);
      await fetchData();
    }
  };

  if (loading) return null;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Pipeline funnel */}
      {stats && (
        <div className="space-y-2">
          {ACTIVE_STAGES.map((stage) => {
            const config = STAGE_CONFIG[stage];
            const count = stats.counts[stage] || 0;
            const value = stats.values[stage] || 0;
            const maxCount = Math.max(...ACTIVE_STAGES.map((s) => stats.counts[s] || 0), 1);
            const width = Math.max(20, (count / maxCount) * 100);

            return (
              <div key={stage} className="flex items-center gap-2">
                <span className={cn("text-xs font-medium w-16", config.color)}>{config.label}</span>
                <div className="flex-1">
                  <div
                    className={cn("h-6 rounded-lg flex items-center px-2 transition-all", config.bgColor)}
                    style={{ width: `${width}%` }}
                  >
                    <span className={cn("text-xs font-bold", config.color)}>{count}</span>
                  </div>
                </div>
                {value > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    ${value.toLocaleString()}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Stats row */}
      {stats && (
        <div className="flex gap-3 text-xs text-muted-foreground bg-muted/20 rounded-lg p-2.5">
          <div className="flex items-center gap-1">
            <DollarSign className="h-3 w-3" />
            <span>${stats.total_pipeline_value.toLocaleString()} pipeline</span>
          </div>
          {stats.overdue_follow_ups > 0 && (
            <div className="flex items-center gap-1 text-amber-600">
              <AlertTriangle className="h-3 w-3" />
              <span>{stats.overdue_follow_ups} overdue</span>
            </div>
          )}
          <div className="flex items-center gap-1 ml-auto">
            <Clock className="h-3 w-3" />
            <span>{stats.recent_activity_7d} activities (7d)</span>
          </div>
        </div>
      )}

      {/* Follow-up alerts */}
      {followUps.overdue.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
            <span className="text-xs font-medium text-amber-700">Overdue Follow-ups</span>
          </div>
          {followUps.overdue.slice(0, 3).map((fu) => (
            <p key={fu.id} className="text-xs text-amber-600 truncate">
              {fu.name}{fu.company ? ` (${fu.company})` : ""} — {formatDistanceToNow(new Date(fu.follow_up_date), { addSuffix: true })}
            </p>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex-1"
        >
          <UserPlus className="h-3.5 w-3.5 mr-1.5" />
          Add Client
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowClients(!showClients)}
          className="flex-1"
        >
          {showClients ? <ChevronUp className="h-3.5 w-3.5 mr-1.5" /> : <ChevronDown className="h-3.5 w-3.5 mr-1.5" />}
          {showClients ? "Hide" : `${clients.length} Clients`}
        </Button>
      </div>

      {/* Add client form */}
      {showAddForm && (
        <div className="space-y-2 bg-muted/20 rounded-xl p-3">
          <Input
            placeholder="Client name"
            value={newClientName}
            onChange={(e) => setNewClientName(e.target.value)}
            className="text-base"
          />
          <Input
            placeholder="Company (optional)"
            value={newClientCompany}
            onChange={(e) => setNewClientCompany(e.target.value)}
            className="text-base"
          />
          <Button
            size="sm"
            onClick={handleAddClient}
            disabled={adding || !newClientName.trim()}
            className="w-full"
          >
            {adding ? "Adding..." : "Add as Lead"}
          </Button>
        </div>
      )}

      {/* Client list */}
      {showClients && (
        <div className="space-y-2">
          {clients.map((client) => {
            const stageConfig = STAGE_CONFIG[client.stage];
            return (
              <div key={client.id} className="flex items-center gap-2 text-xs bg-muted/20 rounded-lg p-2.5">
                <span className={cn("px-1.5 py-0.5 rounded-full text-[10px] font-medium", stageConfig.bgColor, stageConfig.color)}>
                  {stageConfig.label}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="font-medium truncate block">{client.name}</span>
                  {client.company && (
                    <span className="text-muted-foreground truncate block">{client.company}</span>
                  )}
                </div>
                {client.estimated_value && (
                  <span className="text-muted-foreground">${client.estimated_value.toLocaleString()}</span>
                )}
                {["lead", "prospect", "active"].includes(client.stage) && (
                  <button
                    onClick={() => handleAdvanceStage(client)}
                    className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center active:bg-muted hover:bg-muted rounded-lg text-muted-foreground active:text-foreground hover:text-foreground transition-colors"
                    aria-label={`Move ${client.name} to ${STAGE_CONFIG[client.stage === "lead" ? "prospect" : client.stage === "prospect" ? "active" : "completed"]?.label}`}
                  >
                    <ArrowRight className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
          {clients.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">No clients yet</p>
          )}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Track clients from lead to completion. Olive will remind you about follow-ups.
      </p>
    </div>
  );
};

export default ClientPipelineCard;
