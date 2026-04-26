/**
 * InviteSpaceStep — Onboarding beat for inviting other members into a
 * shared Space (couple / family / household / business).
 *
 * Why this exists: Spaces are the moat. A solo user with a Family-typed
 * Space gets none of the "shared memory" value-prop until at least one
 * other person joins. This step gives the user a frictionless invite
 * link the moment after they create the Space — when intent is highest.
 *
 * Skipping is fine and explicitly supported. Solo (`custom`) spaces
 * skip this step entirely via parent-side conditional rendering.
 *
 * Wiring: uses `useSpace().createInvite()` which invokes the existing
 * `olive-space-manage` edge function (action: 'invite'), which writes
 * to `olive_space_invites` with a 7-day expiry token. The invitee
 * accepts via `/join/:token` (route already wired in App.tsx).
 */
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSpace } from "@/providers/SpaceProvider";
import { toast } from "sonner";
import {
  ArrowRight,
  Copy,
  MessageCircle,
  Sparkles,
  Users,
  Check,
  Link as LinkIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Maps space type → audience label used in copy. We never call the
// other person "the user" — we call them what their space type implies.
const AUDIENCE_LABEL: Record<string, string> = {
  couple: "your partner",
  family: "your family",
  household: "your housemates",
  business: "your team",
  custom: "people you share with",
};

const AUDIENCE_PLACEHOLDER: Record<string, string> = {
  couple: "Hey, join me on Olive — she remembers everything we plan together",
  family: "Add Olive to our family chat so nothing gets forgotten",
  household: "Olive will help us coordinate the house — join here",
  business: "Olive will track our clients and decisions — join here",
  custom: "Join me on Olive — she remembers what matters",
};

interface Props {
  spaceId: string | null;
  spaceType: string;
  spaceName: string;
  /** Telemetry — fired when an invite link is generated. */
  onInviteGenerated?: (token: string) => void;
  /** Called when the user is done (link generated and they're moving on, or skipped). */
  onContinue: () => void;
  /** Called when the user explicitly taps the skip link. */
  onSkip: () => void;
}

/**
 * Build the URL the invitee will tap. Uses the page's current origin so
 * Vercel preview deploys ('https://...vercel.app') get a working link
 * automatically. Native (Capacitor) builds need a hardcoded production
 * origin — we pick that up from the prod hostname constant.
 */
function buildInviteUrl(token: string): string {
  // Native iOS lives on capacitor:// or file:// — fall back to prod origin.
  const origin = typeof window !== "undefined" && window.location.origin.startsWith("http")
    ? window.location.origin
    : "https://witholive.app";
  return `${origin}/join/${token}`;
}

/**
 * Build a wa.me share URL with prefilled invite copy. wa.me works on
 * desktop (opens WhatsApp Web) and mobile (opens the app), and unlike
 * `https://api.whatsapp.com/send?...` it doesn't require a phone number.
 */
function buildWhatsAppShareUrl(message: string, inviteUrl: string): string {
  const text = `${message}\n\n${inviteUrl}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export const InviteSpaceStep: React.FC<Props> = ({
  spaceId,
  spaceType,
  spaceName,
  onInviteGenerated,
  onContinue,
  onSkip,
}) => {
  const { createInvite } = useSpace();
  const [token, setToken] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const audienceLabel = AUDIENCE_LABEL[spaceType] || AUDIENCE_LABEL.custom;
  const messagePlaceholder =
    AUDIENCE_PLACEHOLDER[spaceType] || AUDIENCE_PLACEHOLDER.custom;
  const [message, setMessage] = useState(messagePlaceholder);

  const inviteUrl = token ? buildInviteUrl(token) : null;

  const handleGenerate = async () => {
    if (!spaceId) {
      // Shouldn't normally happen — parent should auto-skip when spaceId
      // is missing — but guard so the user isn't stuck staring at a
      // disabled button.
      toast.error("We couldn't find your Space. Try again from Settings.");
      onSkip();
      return;
    }
    setGenerating(true);
    try {
      const invite = await createInvite(spaceId);
      if (!invite?.token) {
        // createInvite already toasts on failure inside the hook
        return;
      }
      setToken(invite.token);
      onInviteGenerated?.(invite.token);
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      toast.success("Invite link copied");
      // Reset the copied state so users can re-tap and feel the feedback
      // again. 2s is enough for the Check icon to register.
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Long-press the link to copy manually.");
    }
  };

  const handleWhatsAppShare = () => {
    if (!inviteUrl) return;
    window.open(buildWhatsAppShareUrl(message, inviteUrl), "_blank");
  };

  return (
    <div className="w-full max-w-md animate-fade-up space-y-6">
      <div className="flex justify-center mb-2">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 shadow-card border border-primary/20">
          <Users className="w-8 h-8 text-primary" />
        </div>
      </div>

      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-foreground font-serif">
          Bring {audienceLabel} in.
        </h1>
        <p className="text-muted-foreground">
          Olive works best when everyone in {spaceName} can talk to her.
        </p>
      </div>

      <Card className="p-5 bg-card/80 border-border/50 shadow-card space-y-4">
        {!token ? (
          <Button
            onClick={handleGenerate}
            disabled={generating || !spaceId}
            className="w-full h-12 text-base group"
          >
            {generating ? (
              <>
                <Sparkles className="w-4 h-4 mr-2 animate-spin" />
                Creating link…
              </>
            ) : (
              <>
                <LinkIcon className="w-4 h-4 mr-2" />
                Generate invite link
                <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
              </>
            )}
          </Button>
        ) : (
          <div className="space-y-3">
            {/* Show the actual link so users know what they're sharing */}
            <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <LinkIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <span className="text-xs font-mono text-muted-foreground truncate flex-1">
                {inviteUrl}
              </span>
              <button
                onClick={handleCopy}
                className="text-primary hover:text-primary/80 transition-colors flex-shrink-0"
                aria-label="Copy invite link"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>

            {/* Editable preview of the WhatsApp message — gives the user
                control without forcing them to write the message themselves */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Message to send
              </label>
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="text-sm"
              />
            </div>

            <Button
              onClick={handleWhatsAppShare}
              className={cn(
                "w-full h-12 text-base bg-green-600 hover:bg-green-700 text-white group",
              )}
            >
              <MessageCircle className="w-4 h-4 mr-2" />
              Share via WhatsApp
              <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              The link expires in 7 days. You can generate more anytime
              from your Space settings.
            </p>
          </div>
        )}
      </Card>

      <div className="space-y-2">
        <Button
          variant="ghost"
          onClick={onContinue}
          className="w-full h-11"
        >
          {token ? "Done — Continue" : "I'll invite later"}
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>

        {!token && (
          <button
            onClick={onSkip}
            className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
};

export default InviteSpaceStep;
