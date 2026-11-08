import { createFileRoute } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import { Screen } from "@/components/app-shell";
import { QuestHomeLink } from "@/components/quest-home-link";
import bg from "@/assets/cartoon-campus.jpg";

export const Route = createFileRoute("/map")({
  head: () => ({ meta: [
    { title: "Quest Map — UBC SideQuest" },
    { name: "description", content: "The map for your UBC campus side quest." },
    { property: "og:title", content: "Quest Map — UBC SideQuest" },
    { property: "og:description", content: "The map for your UBC campus side quest." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: QuestMap,
});

function QuestMap() {
  return <Screen bg={bg}>
    <h1 className="title-chip text-center text-2xl text-brand">Quest Map</h1>
    <div id="quest-map" aria-label="Quest map placeholder" className="pixel-frame my-6 flex min-h-[55svh] flex-1 items-center justify-center bg-muted/90">
      <div className="flex flex-col items-center gap-3 text-muted-foreground"><MapPin size={36} aria-hidden="true" /><span className="text-lg font-bold">Map coming soon</span></div>
    </div>
    <QuestHomeLink />
  </Screen>;
}