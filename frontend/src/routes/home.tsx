import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Compass, Map, Menu, X } from "lucide-react";
import { Logo, PrimaryButton, Screen, pixelButton } from "@/components/app-shell";
import bg from "@/assets/cartoon-ikb.jpg";

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Home — UBC SideQuest" },
      { name: "description", content: "Meet UBC students and go on adventures around campus." },
      { property: "og:title", content: "Home — UBC SideQuest" },
      { property: "og:description", content: "Meet UBC students and go on adventures around campus." },
    ],
  }),
  component: Home,
});

const items = [
  { to: "/chats", label: "Chats", icon: "💬" },
  { to: "/friends", label: "Friends", icon: "🤝" },
  { to: "/stats", label: "Stats", icon: "📊" },
  { to: "/account", label: "Account", icon: "🛡️" },
] as const;

function Home() {
  const [open, setOpen] = useState(false);
  return (
    <Screen bg={bg}>
      <header className="flex items-center gap-4">
        <PrimaryButton variant="blue" onClick={() => setOpen(true)} aria-label="Open menu" className="!h-12 !w-12 shrink-0 flex-col gap-1">
          <Menu size={26} aria-hidden="true" />
        </PrimaryButton>
        <Logo compact />
      </header>

      {/* Map container: plug a map API in here later */}
      <div id="map" className="pixel-frame mt-6 flex min-h-[50svh] flex-1 items-center justify-center">
        <span className="pixel-box flex items-center gap-2 bg-secondary px-4 py-3 font-display text-sm font-bold text-secondary-foreground"><Map size={18} aria-hidden="true" /> Map coming soon</span>
      </div>

      <Link to="/quest" className={`mt-8 gap-3 ${pixelButton("quest", "lg")}`}>
        <Compass size={26} aria-hidden="true" /> Find Quest
      </Link>

      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-overlay animate-in fade-in" onClick={() => setOpen(false)} />
          <nav className="pixel-panel absolute inset-y-0 left-0 w-72 bg-popover p-6 pt-[max(env(safe-area-inset-top),1.5rem)] animate-in slide-in-from-left duration-300">
            <PrimaryButton variant="blue" onClick={() => setOpen(false)} aria-label="Close menu" className="mb-8 !h-11 !w-11"><X size={22} /></PrimaryButton>
            <ul className="space-y-4">
              {items.map(({ to, label, icon }) => (
                <li key={to}>
                  <Link to={to} className={`${pixelButton("blue")} justify-start gap-3 px-4`}>
                    <span className="text-lg">{icon}</span> {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}
    </Screen>
  );
}
