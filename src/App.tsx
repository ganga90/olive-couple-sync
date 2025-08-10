import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Lists from "./pages/Lists";
import Onboarding from "./pages/Onboarding";
import Profile from "./pages/Profile";
import NoteDetails from "./pages/NoteDetails";
import Welcome from "./pages/Welcome";
import NavBar from "./components/NavBar";
import MobileTabBar from "./components/MobileTabBar";
import { CoupleProvider } from "./providers/CoupleProvider";
import { NotesProvider } from "./providers/NotesProvider";
import SignInPage from "./pages/SignIn";
import SignUpPage from "./pages/SignUp";
const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <CoupleProvider>
        <NotesProvider>
          <BrowserRouter>
            <NavBar />
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/lists" element={<Lists />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/welcome" element={<Welcome />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/notes/:id" element={<NoteDetails />} />
              <Route path="/sign-in" element={<SignInPage />} />
              <Route path="/sign-up" element={<SignUpPage />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            <MobileTabBar />
          </BrowserRouter>
        </NotesProvider>
      </CoupleProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
