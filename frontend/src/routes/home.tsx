import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Compass, Menu, X } from "lucide-react";
import { Logo, PrimaryButton, Screen, pixelButton } from "@/components/app-shell";
import bg from "@/assets/cartoon-ikb.jpg";
import { CampusIllustration } from "@/components/campus-illustration";
import { questPrototype } from "@/lib/quest-prototype";
import { gameModes, useGameMode } from "@/components/game-mode-provider";

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
  { to: "/chats", label: "Chats", icon: "chats" },
  { to: "/friends", label: "Friends", icon: "friends" },
  { to: "/stats", label: "Stats", icon: "stats" },
  { to: "/account", label: "Account", icon: "account" },
] as const;

function Home() {
  const [open, setOpen] = useState(false);
  const { activeGameMode, setActiveGameMode } = useGameMode();
  const activeModeLabel = gameModes.find(mode => mode.value === activeGameMode)?.label;
  return (
    <Screen bg={bg}>
      <header className="flex items-center gap-4">
        <PrimaryButton variant="blue" onClick={() => setOpen(true)} aria-label="Open menu" className="!h-12 !w-12 shrink-0 flex-col gap-1">
          <Menu size={26} aria-hidden="true" />
        </PrimaryButton>
        <Logo compact />
      </header>

      <div className="flex-1 min-h-32" />
      <div className="grid grid-cols-2 gap-3" role="group" aria-label="Game mode">
        {gameModes.map(mode => (
          <PrimaryButton key={mode.value} variant="mode" aria-pressed={activeGameMode === mode.value}
            onClick={() => setActiveGameMode(mode.value)} className="game-mode-button">
            {mode.label}
          </PrimaryButton>
        ))}
      </div>

      <Link to={questPrototype.queuePath} className={`mt-8 flex-col gap-1 ${pixelButton("quest", "lg")}`}>
        <span className="flex items-center gap-3"><Compass size={26} aria-hidden="true" /> Find Quest</span>
        <span className="text-sm font-semibold" aria-live="polite">Current Mode: {activeModeLabel}</span>
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
                    <CampusIllustration kind={icon} size="menu" /> {label}
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
