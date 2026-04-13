/**
 * InviteToSpaceDialog — Generate and share invite links for a space.
 *
 * Creates a space invite via the edge function and presents
 * a shareable link that recipients can use to join.
 */
import React, { useState } from "react";
import { Copy, Check, Link2, Mail, Share2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useSpace } from "@/providers/SpaceProvider";
import { Capacitor } from "@capacitor/core";

interface InviteToSpaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId?: string; // defaults to currentSpace
  spaceName?: string;
}

export const InviteToSpaceDialog: React.FC<InviteToSpaceDialogProps> = ({
  open,
  onOpenChange,
  spaceId: propSpaceId,
  spaceName: propSpaceName,
}) => {
  const { currentSpace, createInvite } = useSpace();
  const [email, setEmail] = useState("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const spaceId = propSpaceId || currentSpace?.id;
  const spaceName = propSpaceName || currentSpace?.name || "this space";

  const generateLink = async () => {
    if (!spaceId) return;

    setLoading(true);
    try {
      const invite = await createInvite(spaceId, {
        email: email.trim() || undefined,
      });

      if (invite) {
        const baseUrl = window.location.origin;
        const link = `${baseUrl}/join/${invite.token}`;
        setInviteLink(link);
      }
    } finally {
      setLoading(false);
    }
  };

  const copyLink = async () => {
    if (!inviteLink) return;

    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast.success("Invite link copied!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for iOS
      toast.error("Could not copy — tap and hold the link to copy");
    }
  };

  const shareLink = async () => {
    if (!inviteLink) return;

    const shareText = `Join my "${spaceName}" space on Olive! ${inviteLink}`;

    if (Capacitor.isNativePlatform() && navigator.share) {
      try {
        await navigator.share({
          title: `Join ${spaceName} on Olive`,
          text: shareText,
          url: inviteLink,
        });
        return;
      } catch {
        // User cancelled share — that's fine
      }
    } else if (navigator.share) {
      try {
        await navigator.share({ title: `Join ${spaceName}`, url: inviteLink });
        return;
      } catch {
        // Fallback to copy
      }
    }

    // Fallback: copy to clipboard
    await copyLink();
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setEmail("");
      setInviteLink(null);
      setLoading(false);
      setCopied(false);
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Invite to {spaceName}</DialogTitle>
          <DialogDescription>
            Generate a link to invite someone to your space. Links expire in 7 days.
          </DialogDescription>
        </DialogHeader>

        {!inviteLink ? (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">
                Email (optional)
              </Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="partner@email.com"
                onKeyDown={(e) => {
                  if (e.key === "Enter") generateLink();
                }}
              />
              <p className="text-xs text-muted-foreground">
                If provided, we'll track who the invite was for.
              </p>
            </div>

            <Button
              onClick={generateLink}
              disabled={loading}
              className="w-full"
            >
              <Link2 className="h-4 w-4 mr-2" />
              {loading ? "Generating..." : "Generate invite link"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            {/* Invite link display */}
            <div className="space-y-2">
              <Label>Invite link</Label>
              <div className="flex gap-2">
                <Input
                  value={inviteLink}
                  readOnly
                  className="text-sm font-mono"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={copyLink}
                  className="shrink-0"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <Button onClick={shareLink} className="flex-1">
                <Share2 className="h-4 w-4 mr-2" />
                Share link
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setInviteLink(null);
                  setEmail("");
                }}
              >
                New link
              </Button>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              Anyone with this link can join your space for the next 7 days.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default InviteToSpaceDialog;
