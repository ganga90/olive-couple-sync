/**
 * PollCard — Create and vote on team polls.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  BarChart3,
  Plus,
  Check,
  ChevronDown,
  ChevronUp,
  Lock,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSubscription, Poll } from "@/hooks/useSubscription";
import { useSpace } from "@/providers/SpaceProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { formatDistanceToNow } from "date-fns";

interface PollCardProps {
  className?: string;
}

export const PollCard: React.FC<PollCardProps> = ({ className }) => {
  const { listPolls, createPoll, votePoll, getPollResults, closePoll } = useSubscription();
  const { currentSpace } = useSpace();
  const { selectionChanged, notifySuccess } = useHaptics();
  const [polls, setPolls] = useState<Poll[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [creating, setCreating] = useState(false);
  const [votingPoll, setVotingPoll] = useState<string | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string[]>>({});
  const [results, setResults] = useState<Record<string, any>>({});

  const fetchData = useCallback(async () => {
    if (!currentSpace) return;
    setLoading(true);
    const pollsData = await listPolls(currentSpace.id);
    setPolls(pollsData);

    // Fetch results for closed polls
    for (const poll of pollsData.filter((p) => p.status === "closed").slice(0, 5)) {
      const r = await getPollResults(poll.id);
      if (r?.results) setResults((prev) => ({ ...prev, [poll.id]: r }));
    }
    setLoading(false);
  }, [listPolls, getPollResults, currentSpace]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async () => {
    if (!currentSpace || !question.trim()) return;
    const validOptions = options.filter((o) => o.trim());
    if (validOptions.length < 2) {
      toast.error("Need at least 2 options");
      return;
    }
    setCreating(true);
    const result = await createPoll({
      space_id: currentSpace.id,
      question: question.trim(),
      options: validOptions.map((o) => ({ text: o.trim() })),
    });
    if (result?.success) {
      toast.success("Poll created!");
      setQuestion("");
      setOptions(["", ""]);
      setShowForm(false);
      await fetchData();
    } else {
      toast.error(result?.error || "Failed to create poll");
    }
    setCreating(false);
  };

  const handleVote = async (pollId: string) => {
    const selected = selectedOptions[pollId] || [];
    if (selected.length === 0) { toast.error("Select an option"); return; }

    const result = await votePoll(pollId, selected);
    if (result?.success) {
      toast.success("Vote cast!");
      setVotingPoll(null);
      // Fetch results
      const r = await getPollResults(pollId);
      if (r?.results) setResults((prev) => ({ ...prev, [pollId]: r }));
    } else {
      toast.error(result?.error || "Vote failed");
    }
  };

  const toggleOption = (pollId: string, optionId: string, pollType: string) => {
    selectionChanged();
    setSelectedOptions((prev) => {
      const current = prev[pollId] || [];
      if (pollType === "single") return { ...prev, [pollId]: [optionId] };
      return {
        ...prev,
        [pollId]: current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId],
      };
    });
  };

  if (loading) return null;

  const openPolls = polls.filter((p) => p.status === "open");
  const closedPolls = polls.filter((p) => p.status === "closed");

  return (
    <div className={cn("space-y-3", className)}>
      {/* Open polls */}
      {openPolls.map((poll) => {
        const pollResults = results[poll.id];
        const selected = selectedOptions[poll.id] || [];
        const hasResults = !!pollResults;

        return (
          <div key={poll.id} className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{poll.question}</span>
              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">Open</span>
            </div>

            {/* Voting options */}
            <div className="space-y-1">
              {(poll.options || []).map((opt) => {
                const isSelected = selected.includes(opt.id);
                const result = hasResults ? pollResults.results.find((r: any) => r.id === opt.id) : null;

                return (
                  <button
                    key={opt.id}
                    onClick={() => toggleOption(poll.id, opt.id, poll.poll_type)}
                    className={cn(
                      "w-full text-left text-sm rounded-lg p-3 min-h-[44px] border transition-all relative overflow-hidden",
                      isSelected ? "border-primary bg-primary/10" : "border-border active:border-primary/30 hover:border-primary/30"
                    )}
                  >
                    {result && (
                      <div
                        className="absolute inset-y-0 left-0 bg-primary/10 transition-all"
                        style={{ width: `${result.percentage}%` }}
                      />
                    )}
                    <div className="relative flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        {isSelected && <Check className="h-3 w-3 text-primary" />}
                        {opt.text}
                      </span>
                      {result && (
                        <span className="text-muted-foreground">{result.percentage}%</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2">
              <Button size="sm" onClick={() => handleVote(poll.id)} className="flex-1 text-xs">
                Vote
              </Button>
              <Button size="sm" variant="outline" onClick={async () => {
                const r = await getPollResults(poll.id);
                if (r?.results) setResults((prev) => ({ ...prev, [poll.id]: r }));
              }} className="text-xs">
                <BarChart3 className="h-3 w-3 mr-1" />
                Results
              </Button>
            </div>

            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              {poll.anonymous && <><Lock className="h-2.5 w-2.5" /> Anonymous</>}
              <Users className="h-2.5 w-2.5 ml-auto" />
              <span>{poll.vote_count || 0} votes</span>
              <span>· {formatDistanceToNow(new Date(poll.created_at), { addSuffix: true })}</span>
            </div>
          </div>
        );
      })}

      {/* Create button */}
      <Button variant="outline" size="sm" onClick={() => setShowForm(!showForm)} className="w-full">
        <Plus className="h-3.5 w-3.5 mr-1.5" />
        {showForm ? "Cancel" : "New Poll"}
      </Button>

      {/* Create form */}
      {showForm && (
        <div className="space-y-2 bg-muted/20 rounded-xl p-3">
          <Input
            placeholder="What should we decide?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            className="text-base"
          />
          {options.map((opt, i) => (
            <Input
              key={i}
              placeholder={`Option ${i + 1}`}
              value={opt}
              onChange={(e) => {
                const newOpts = [...options];
                newOpts[i] = e.target.value;
                setOptions(newOpts);
              }}
              className="text-base"
            />
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOptions([...options, ""])}
            className="w-full text-xs"
          >
            + Add Option
          </Button>
          <Button size="sm" onClick={handleCreate} disabled={creating} className="w-full">
            {creating ? "Creating..." : "Create Poll"}
          </Button>
        </div>
      )}

      {/* Closed polls summary */}
      {closedPolls.length > 0 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="flex items-center gap-1 text-xs text-muted-foreground active:text-foreground hover:text-foreground transition-colors w-full justify-center py-2.5 min-h-[44px]"
          aria-label={showAll ? "Hide closed polls" : `Show ${closedPolls.length} closed polls`}
        >
          {showAll ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {showAll ? "Hide closed" : `${closedPolls.length} closed polls`}
        </button>
      )}

      {openPolls.length === 0 && !showForm && (
        <p className="text-xs text-muted-foreground text-center py-2">
          No active polls. Create one to make team decisions faster.
        </p>
      )}

      <p className="text-[11px] text-muted-foreground">
        Quick polls for team decisions. Everyone in the space can vote.
      </p>
    </div>
  );
};

export default PollCard;
