import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, LoaderCircle, Users } from "lucide-react";
import { Screen, pixelButton } from "@/components/app-shell";
import { QuestHomeLink } from "@/components/quest-home-link";
import { questPrototype } from "@/lib/quest-prototype";
import { gameModePlayerTotals, useGameMode } from "@/components/game-mode-provider";
import bg from "@/assets/cartoon-campus.jpg";

export const Route = createFileRoute("/queue")({
  head: () => ({ meta: [
    { title: "Finding Your SideQuest — UBC SideQuest" },
    { name: "description", content: "Find your next campus adventure with another UBC student." },
    { property: "og:title", content: "Finding Your SideQuest — UBC SideQuest" },
    { property: "og:description", content: "Find your next campus adventure with another UBC student." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: Queue,
});

function Queue() {
  const { activeGameMode } = useGameMode();
  return <Screen bg={bg}>
    <h1 className="title-chip text-center text-2xl text-brand">Finding Your SideQuest...</h1>
    <div className="min-h-48 flex-1" />
    <div className="mt-6 space-y-4">
      <div role="status" className="title-chip flex items-center justify-center gap-3 text-lg font-bold">
        <Users size={22} aria-hidden="true" />
        <span>Players Queued: {questPrototype.queuedPlayers}/{gameModePlayerTotals[activeGameMode]}</span>
        <LoaderCircle className="shrink-0 animate-spin motion-reduce:animate-none" size={22} aria-hidden="true" />
      </div>
      <Link to={questPrototype.assignmentPath} className={`${pixelButton("quest")} gap-2`}>Continue<ArrowRight size={20} aria-hidden="true" /></Link>
      <QuestHomeLink />
    </div>
  </Screen>;
}