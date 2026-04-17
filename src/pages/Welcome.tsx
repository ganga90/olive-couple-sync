import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";

/**
 * /welcome now redirects to /landing — single canonical landing page.
 */
const Welcome = () => {
  const navigate = useNavigate();
  const getLocalizedPath = useLocalizedHref();

  useEffect(() => {
    navigate(getLocalizedPath("/landing"), { replace: true });
  }, [navigate, getLocalizedPath]);

  return null;
};

export default Welcome;
