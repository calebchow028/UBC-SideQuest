import { createFileRoute } from "@tanstack/react-router";
import { SubPage } from "@/components/app-shell";
import bg from "@/assets/cartoon-moa.jpg";

export const Route = createFileRoute("/quest")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Quest — UBC SideQuest" },
      { name: "description", content: "Quests near you will show up here soon." },
      { property: "og:title", content: "Quest — UBC SideQuest" },
      { property: "og:description", content: "Quests near you will show up here soon." },
    ],
  }),
  component: () => <SubPage bg={bg} title="Quest" emoji="🗺️" text="Quests near you will show up here soon." />,
});
