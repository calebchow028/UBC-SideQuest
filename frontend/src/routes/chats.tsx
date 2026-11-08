import { createFileRoute } from "@tanstack/react-router";
import { SubPage } from "@/components/app-shell";
import bg from "@/assets/cartoon-buchanan.jpg";

export const Route = createFileRoute("/chats")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Chats — UBC SideQuest" },
      { name: "description", content: "Chat with other students here soon." },
      { property: "og:title", content: "Chats — UBC SideQuest" },
      { property: "og:description", content: "Chat with other students here soon." },
    ],
  }),
  component: () => <SubPage bg={bg} title="Chats" illustration="chats" text="Chat with other students here soon." />,
});
