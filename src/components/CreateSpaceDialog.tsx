/**
 * CreateSpaceDialog — Modal to create a new space.
 *
 * Supports all space types: family, household, business, custom.
 * Couple spaces are auto-created from onboarding (not here).
 */
import React, { useState } from "react";
import { Home, Briefcase, Users, Settings2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useSpace, SpaceType } from "@/providers/SpaceProvider";

const SPACE_OPTIONS: Array<{
  type: SpaceType;
  label: string;
  description: string;
  icon: React.ReactNode;
  defaultName: string;
}> = [
  {
    type: "family",
    label: "Family",
    description: "Organize life with your family",
    icon: <Home className="h-5 w-5 text-amber-500" />,
    defaultName: "My Family",
  },
  {
    type: "household",
    label: "Household",
    description: "Manage shared living spaces",
    icon: <Home className="h-5 w-5 text-emerald-500" />,
    defaultName: "Our Household",
  },
  {
    type: "business",
    label: "Business",
    description: "Collaborate with your team",
    icon: <Briefcase className="h-5 w-5 text-blue-500" />,
    defaultName: "My Business",
  },
  {
    type: "custom",
    label: "Custom",
    description: "Create any kind of space",
    icon: <Settings2 className="h-5 w-5 text-violet-500" />,
    defaultName: "My Space",
  },
];

interface CreateSpaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

export const CreateSpaceDialog: React.FC<CreateSpaceDialogProps> = ({
  open,
  onOpenChange,
  onCreated,
}) => {
  const { createSpace } = useSpace();
  const [step, setStep] = useState<"type" | "details">("type");
  const [selectedType, setSelectedType] = useState<SpaceType | null>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [creating, setCreating] = useState(false);

  const reset = () => {
    setStep("type");
    setSelectedType(null);
    setName("");
    setIcon("");
    setCreating(false);
  };

  const handleTypeSelect = (type: SpaceType) => {
    setSelectedType(type);
    const option = SPACE_OPTIONS.find((o) => o.type === type);
    setName(option?.defaultName || "");
    setStep("details");
  };

  const handleCreate = async () => {
    if (!selectedType || !name.trim()) return;

    setCreating(true);
    try {
      const space = await createSpace({
        name: name.trim(),
        type: selectedType,
        icon: icon || undefined,
      });

      if (space) {
        onOpenChange(false);
        reset();
        onCreated?.();
      }
    } finally {
      setCreating(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) reset();
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {step === "type" ? "Create a new space" : "Name your space"}
          </DialogTitle>
          <DialogDescription>
            {step === "type"
              ? "Choose what kind of space you want to create."
              : "Give your space a name that everyone will recognize."}
          </DialogDescription>
        </DialogHeader>

        {step === "type" && (
          <div className="grid grid-cols-2 gap-3 py-4">
            {SPACE_OPTIONS.map((option) => (
              <button
                key={option.type}
                onClick={() => handleTypeSelect(option.type)}
                className={cn(
                  "flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-muted",
                  "hover:border-primary/50 hover:bg-accent/50 transition-all",
                  "text-center cursor-pointer"
                )}
              >
                <div className="p-2.5 rounded-xl bg-muted/50">{option.icon}</div>
                <div>
                  <div className="font-semibold text-sm">{option.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {option.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {step === "details" && (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="space-name">Space name</Label>
              <Input
                id="space-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. The Smiths, My Team"
                autoFocus
                maxLength={50}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) handleCreate();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="space-icon">Icon (optional emoji)</Label>
              <Input
                id="space-icon"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="e.g. 🏠 👨‍👩‍👧 💼"
                maxLength={2}
              />
            </div>
          </div>
        )}

        {step === "details" && (
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setStep("type")}>
              Back
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!name.trim() || creating}
            >
              {creating ? "Creating..." : "Create space"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default CreateSpaceDialog;
