import { useState } from "react";
import { SignedIn, SignedOut, SignInButton, SignUpButton } from "@clerk/clerk-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const Index = () => {
  const [note, setNote] = useState("");

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    toast.success("Note captured — AI will organize it soon.");
    setNote("");
  };

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto flex max-w-3xl flex-col items-center justify-center gap-6 px-4 py-20 text-center">
        <h1 className="text-4xl font-bold">Olive — your couple’s second brain</h1>
        <p className="text-lg text-muted-foreground">Capture anything in one place. Olive organizes it for both of you.</p>
        <SignedOut>
          <div className="flex items-center gap-3">
            <SignInButton mode="modal">
              <Button size="lg">Sign in</Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button variant="outline" size="lg">Create account</Button>
            </SignUpButton>
          </div>
        </SignedOut>
        <SignedIn>
          <div className="w-full">
            <form onSubmit={onSubmit} className="space-y-3">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g., Buy lemons tomorrow and book dental checkup" />
              <div className="flex justify-center">
                <Button type="submit">Add note</Button>
              </div>
            </form>
          </div>
        </SignedIn>
      </section>
    </main>
  );
};

export default Index;
