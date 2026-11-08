import { createFileRoute } from "@tanstack/react-router";
import { SubPage } from "@/components/app-shell";
import bg from "@/assets/cartoon-chan.jpg";

export const Route = createFileRoute("/stats")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Stats — UBC SideQuest" },
      { name: "description", content: "Your activity and quest stats will appear here." },
      { property: "og:title", content: "Stats — UBC SideQuest" },
      { property: "og:description", content: "Your activity and quest stats will appear here." },
    ],
  }),
  component: () => <SubPage bg={bg} title="Stats" illustration="stats" text="Your activity and quest stats will appear here." />,
});
