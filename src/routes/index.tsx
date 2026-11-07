import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Field, Logo, Panel, PrimaryButton, Screen } from "@/components/app-shell";
import bg from "@/assets/cartoon-nest.jpg";
import { signIn } from "@/lib/auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Sign In — UBC SideQuest" },
      { name: "description", content: "Sign in to UBC SideQuest to find quests around campus." },
      { property: "og:title", content: "Sign In — UBC SideQuest" },
      { property: "og:description", content: "Sign in to UBC SideQuest to find quests around campus." },
    ],
  }),
  component: SignIn,
});

function SignIn() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = signIn(username, password);
    if (r === "ok") navigate({ to: "/home" });
    else if (r === "no-account") navigate({ to: "/signup" });
    else setError("Incorrect password.");
  }

  return (
    <Screen bg={bg} publicPage>
      <div className="mt-10 mb-auto pb-6"><Logo /></div>
      <Panel>
      <form onSubmit={submit} className="space-y-5">
        <Field label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" required />
        <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-base text-destructive text-pixel-shadow">{error}</p>}
        <PrimaryButton type="submit">Sign In</PrimaryButton>
      </form>
      <p className="mt-5 text-center text-base">
        Don't have an account?{" "}
        <Link to="/signup" className="text-brand font-bold underline underline-offset-4">Create Account</Link>
      </p>
      </Panel>
    </Screen>
  );
}
