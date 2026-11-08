import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { PrimaryButton, SubPage } from "@/components/app-shell";
import { signOut } from "@/lib/auth";
import bg from "@/assets/cartoon-koerner.jpg";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Account — UBC SideQuest" },
      { name: "description", content: "View and edit your account info here soon." },
      { property: "og:title", content: "Account — UBC SideQuest" },
      { property: "og:description", content: "View and edit your account info here soon." },
    ],
  }),
  component: Account,
});

function Account() {
  const navigate = useNavigate();
  return (
    <SubPage bg={bg} title="Account" illustration="account" text="View and edit your account info here soon.">
      <PrimaryButton onClick={() => {
        signOut();
        void navigate({ to: "/", replace: true });
      }} className="gap-3"><LogOut aria-hidden="true" size={20} />Sign Out</PrimaryButton>
    </SubPage>
  );
}
