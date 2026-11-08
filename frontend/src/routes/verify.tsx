import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Camera, CheckCircle2 } from "lucide-react";
import { Panel, PrimaryButton, Screen } from "@/components/app-shell";
import bg from "@/assets/cartoon-forestry.jpg";
import { markVerified } from "@/lib/auth";

export const Route = createFileRoute("/verify")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Verify Student Status — UBC SideQuest" },
      { name: "description", content: "Upload your school ID to verify your student status." },
      { property: "og:title", content: "Verify Student Status — UBC SideQuest" },
      { property: "og:description", content: "Upload your school ID to verify your student status." },
    ],
  }),
  component: Verify,
});

function Verify() {
  const navigate = useNavigate();
  const [preview, setPreview] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function submit() {
    markVerified();
    setDone(true);
    setTimeout(() => navigate({ to: "/home" }), 1400);
  }

  if (done)
    return (
      <Screen bg={bg}>
        <div className="flex flex-1 items-center"><Panel className="w-full flex flex-col items-center text-center animate-in zoom-in-95">
          <CheckCircle2 className="h-20 w-20 text-brand" />
          <h1 className="mt-4 text-xl text-brand">Submitted!</h1>
          <p className="mt-3 text-lg">Your school ID was sent for verification.</p>
        </Panel></div>
      </Screen>
    );

  return (
    <Screen bg={bg}>
      <Panel className="mt-6">
      <h1 className="text-xl text-brand">Verify Your Student Status</h1>
      <p className="mt-3 text-lg">
        Upload a photo of your school ID so we can confirm you're a student.
      </p>
      </Panel>
      <label className="mt-8 flex aspect-[1.6] cursor-pointer flex-col items-center justify-center overflow-hidden pixel-panel">
        {preview ? (
          <img src={preview} alt="School ID preview" className="h-full w-full object-cover" />
        ) : (
          <>
            <Camera className="h-10 w-10 text-brand" />
            <span className="mt-2 font-display text-base font-bold">Take or choose a photo</span>
          </>
        )}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setPreview(URL.createObjectURL(f));
          }}
        />
      </label>
      <div className="mt-auto pt-8">
        <PrimaryButton disabled={!preview} onClick={submit}>Submit for Verification</PrimaryButton>
      </div>
    </Screen>
  );
}
