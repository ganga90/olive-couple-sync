import { Link, NavLink } from "react-router-dom";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";

const NavBar = () => {
  return (
    <header className="border-b bg-background">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link to="/" className="text-base font-semibold">
          Olive
        </Link>
        <div className="flex items-center gap-3">
          <NavLink to="/lists" className="text-sm text-muted-foreground hover:text-foreground">
            Lists
          </NavLink>
          <SignedOut>
            <SignInButton mode="modal">
              <Button size="sm">Sign in</Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button variant="outline" size="sm">Sign up</Button>
            </SignUpButton>
          </SignedOut>
          <SignedIn>
            <UserButton appearance={{ elements: { userButtonPopoverFooter: "hidden" } }} showName />
          </SignedIn>
        </div>
      </nav>
    </header>
  );
};

export default NavBar;
