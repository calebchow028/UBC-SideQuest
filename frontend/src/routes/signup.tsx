import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Field, Logo, Panel, PrimaryButton, Screen } from "@/components/app-shell";
import bg from "@/assets/cartoon-clocktower.jpg";
import { createAccount } from "@/lib/auth";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Create Account — UBC SideQuest" },
      { name: "description", content: "Create your UBC SideQuest account." },
      { property: "og:title", content: "Create Account — UBC SideQuest" },
      { property: "og:description", content: "Create your UBC SideQuest account." },
    ],
  }),
  component: SignUp,
});

function SignUp() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("Passwords don't match.");
    if (!createAccount(username, password)) return setError("That username is taken.");
    navigate({ to: "/verify" });
  }

  return (
    <Screen bg={bg} publicPage>
      <div className="mt-6 mb-auto pb-6"><Logo /></div>
      <Panel>
      <h2 className="mb-5 text-center text-xl text-brand">Create your account</h2>
      <form onSubmit={submit} className="space-y-5">
        <Field label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" required />
        <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <Field label="Confirm Password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        {error && <p className="text-base text-destructive text-pixel-shadow">{error}</p>}
        <PrimaryButton type="submit">Create Account</PrimaryButton>
      </form>
      <p className="mt-5 text-center text-base">
        Already have an account? <Link to="/" className="text-brand font-bold underline underline-offset-4">Sign In</Link>
      </p>
      </Panel>
    </Screen>
  );
}
