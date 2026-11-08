import { createFileRoute } from "@tanstack/react-router";
import { SubPage } from "@/components/app-shell";
import bg from "@/assets/cartoon-rosegarden.jpg";

export const Route = createFileRoute("/friends")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Friends — UBC SideQuest" },
      { name: "description", content: "View and manage your friends here soon." },
      { property: "og:title", content: "Friends — UBC SideQuest" },
      { property: "og:description", content: "View and manage your friends here soon." },
    ],
  }),
  component: () => <SubPage bg={bg} title="Friends" emoji="🤝" text="View and manage your friends here soon." />,
});
