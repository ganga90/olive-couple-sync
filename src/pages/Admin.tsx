import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdmin } from "@/hooks/useAdmin";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalizedNavigate } from "@/hooks/useLocalizedNavigate";
import { supabase } from "@/integrations/supabase/client";
import { OliveLogo } from "@/components/OliveLogo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Users, Mail, Clock, Shield, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface BetaRequest {
  id: string;
  user_name: string | null;
  contact_email: string | null;
  message: string;
  created_at: string;
  category: string;
}

interface FeedbackItem {
  id: string;
  user_name: string | null;
  contact_email: string | null;
  message: string;
  created_at: string;
  category: string;
  page: string | null;
}

const AdminPage = () => {
  const { t } = useTranslation("common");
  const { isAdmin, loading: adminLoading } = useAdmin();
  const { loading: authLoading } = useAuth();
  const navigate = useLocalizedNavigate();

  const [betaRequests, setBetaRequests] = useState<BetaRequest[]>([]);
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [activeTab, setActiveTab] = useState<"beta" | "feedback">("beta");

  useEffect(() => {
    if (adminLoading || authLoading) return;
    if (!isAdmin) {
      navigate("/");
      return;
    }
    fetchData();
  }, [isAdmin, adminLoading, authLoading]);

  const fetchData = async () => {
    setLoadingData(true);
    try {
      // We need to use the edge function since beta_feedback SELECT is blocked by RLS
      // Instead, query directly — admin has RLS on user_roles but beta_feedback has SELECT = false
      // We'll create a simple admin edge function
      const { data, error } = await supabase.functions.invoke("admin-dashboard", {
        body: { action: "list" },
      });

      if (error) throw error;

      setBetaRequests(data?.betaRequests || []);
      setFeedback(data?.feedback || []);
    } catch (err) {
      console.error("[Admin] Error fetching data:", err);
      toast.error("Failed to load admin data");
    } finally {
      setLoadingData(false);
    }
  };

  if (adminLoading || authLoading) {
    return (
      <main className="min-h-screen bg-background p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </main>
    );
  }

  if (!isAdmin) return null;

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/home")} className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <h1 className="text-2xl font-bold text-foreground">Admin Dashboard</h1>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <Card className="cursor-pointer transition-colors" onClick={() => setActiveTab("beta")}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{betaRequests.length}</p>
                <p className="text-xs text-muted-foreground">Beta Requests</p>
              </div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer transition-colors" onClick={() => setActiveTab("feedback")}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-accent/50 flex items-center justify-center">
                <Mail className="h-5 w-5 text-accent-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold">{feedback.length}</p>
                <p className="text-xs text-muted-foreground">Feedback</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-border pb-2">
          <button
            onClick={() => setActiveTab("beta")}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === "beta"
                ? "text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Beta Requests
          </button>
          <button
            onClick={() => setActiveTab("feedback")}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === "feedback"
                ? "text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Feedback
          </button>
        </div>

        {/* Content */}
        {loadingData ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : activeTab === "beta" ? (
          <div className="space-y-3">
            {betaRequests.length === 0 ? (
              <p className="text-muted-foreground text-center py-12">No beta requests yet.</p>
            ) : (
              betaRequests.map((req) => (
                <Card key={req.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <p className="font-semibold text-foreground">{req.user_name || "Unknown"}</p>
                        <p className="text-sm text-muted-foreground">{req.contact_email}</p>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatDate(req.created_at)}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {feedback.length === 0 ? (
              <p className="text-muted-foreground text-center py-12">No feedback yet.</p>
            ) : (
              feedback.map((fb) => (
                <Card key={fb.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-foreground">{fb.user_name || "Anonymous"}</p>
                          <Badge variant="outline" className="text-xs">{fb.category}</Badge>
                        </div>
                        {fb.contact_email && (
                          <p className="text-sm text-muted-foreground">{fb.contact_email}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatDate(fb.created_at)}
                      </div>
                    </div>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{fb.message}</p>
                    {fb.page && (
                      <p className="text-xs text-muted-foreground mt-1">Page: {fb.page}</p>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}
      </div>
    </main>
  );
};

export default AdminPage;
