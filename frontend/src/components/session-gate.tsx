import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { currentUser } from "@/lib/auth";

// This guards the existing browser-only demo session, not server-side data.
export function SessionGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const [allowedPath, setAllowedPath] = useState<string | null>(null);

  useEffect(() => {
    function checkSession() {
      if (currentUser()) {
        setAllowedPath(pathname);
      } else {
        setAllowedPath(null);
        void navigate({ to: "/", replace: true });
      }
    }
    checkSession();
    window.addEventListener("storage", checkSession);
    window.addEventListener("pageshow", checkSession);
    return () => {
      window.removeEventListener("storage", checkSession);
      window.removeEventListener("pageshow", checkSession);
    };
  }, [navigate, pathname]);

  return allowedPath === pathname ? children : null;
}