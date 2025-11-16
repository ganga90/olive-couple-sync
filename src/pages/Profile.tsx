import { SignedIn, SignedOut, SignIn, UserProfile } from "@clerk/clerk-react";
import { useSEO } from "@/hooks/useSEO";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PartnerInfo } from "@/components/PartnerInfo";
import { PhoneNumberField } from "@/components/PhoneNumberField";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { User, LogOut, Bell, Shield, HelpCircle } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { useClerk } from "@clerk/clerk-react";

const Profile = () => {
  useSEO({ title: "Profile — Olive", description: "Manage your Olive account profile and settings." });
  
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const { signOut } = useClerk();

  const handleSignOut = async () => {
    await signOut();
    navigate('/landing');
  };

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <User className="h-16 w-16 text-primary mb-4" />
        <h2 className="text-2xl font-semibold mb-2">Profile</h2>
        <p className="text-muted-foreground mb-6">Sign in to manage your account</p>
        <Button onClick={() => navigate('/sign-in')}>Sign In</Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-6 space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <User className="h-10 w-10 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-1">
            {user?.firstName || user?.fullName || 'Profile'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {user?.primaryEmailAddress?.emailAddress}
          </p>
        </div>

        {/* Partner Information */}
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="text-base">Partner Connection</CardTitle>
          </CardHeader>
          <CardContent>
            <PartnerInfo />
          </CardContent>
        </Card>

        {/* Phone Number */}
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="text-base">WhatsApp Notifications</CardTitle>
          </CardHeader>
          <CardContent>
            <PhoneNumberField />
          </CardContent>
        </Card>

        {/* WhatsApp AI Link */}
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="text-base">WhatsApp AI Assistant</CardTitle>
          </CardHeader>
          <CardContent>
            <WhatsAppLink />
          </CardContent>
        </Card>

        {/* Settings Menu */}
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="text-base">Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <button className="flex items-center gap-3 w-full p-3 rounded-[var(--radius-md)] hover:bg-muted transition-colors text-left">
              <Bell className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1">
                <p className="font-medium text-foreground">Notifications</p>
                <p className="text-xs text-muted-foreground">Manage notification preferences</p>
              </div>
            </button>

            <button className="flex items-center gap-3 w-full p-3 rounded-[var(--radius-md)] hover:bg-muted transition-colors text-left">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1">
                <p className="font-medium text-foreground">Privacy & Security</p>
                <p className="text-xs text-muted-foreground">Manage your privacy settings</p>
              </div>
            </button>

            <button className="flex items-center gap-3 w-full p-3 rounded-[var(--radius-md)] hover:bg-muted transition-colors text-left">
              <HelpCircle className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1">
                <p className="font-medium text-foreground">Help & Support</p>
                <p className="text-xs text-muted-foreground">Get help with Olive</p>
              </div>
            </button>
          </CardContent>
        </Card>

        {/* Account Actions */}
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="p-4">
            <Button
              variant="destructive"
              className="w-full"
              onClick={handleSignOut}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </CardContent>
        </Card>

        {/* Version Info */}
        <div className="text-center pb-4">
          <p className="text-xs text-muted-foreground">Olive v1.0.0</p>
        </div>
      </div>
    </div>
  );
};

export default Profile;