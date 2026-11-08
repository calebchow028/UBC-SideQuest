import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { Panel, Screen, pixelButton } from "@/components/app-shell";
import { CampusIllustration } from "@/components/campus-illustration";
import { QuestHomeLink } from "@/components/quest-home-link";
import { questPrototype } from "@/lib/quest-prototype";
import bg from "@/assets/cartoon-moa.jpg";

export const Route = createFileRoute("/quest")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Side Quest — UBC SideQuest" },
      { name: "description", content: "Your next adventure: learn to pirouette at the ice skating rink." },
      { property: "og:title", content: "Side Quest — UBC SideQuest" },
      { property: "og:description", content: "Your next adventure: learn to pirouette at the ice skating rink." },
    ],
  }),
  component: SideQuest,
});

function SideQuest() {
  return <Screen bg={bg}>
    <h1 className="title-chip text-center text-2xl text-brand">SIDE QUEST</h1>
    <div className="flex flex-1 items-center py-8">
      <Panel className="w-full text-center">
        <CampusIllustration kind="quest" />
        <p className="mt-5 text-2xl font-extrabold leading-relaxed">{questPrototype.assignment}</p>
      </Panel>
    </div>
    <div className="space-y-4">
      <Link to={questPrototype.mapPath} className={`${pixelButton("quest")} gap-2`}><Check size={22} aria-hidden="true" />Confirm Quest</Link>
      <QuestHomeLink />
    </div>
  </Screen>;
}
