import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { pixelButton } from "@/components/app-shell";

export function QuestHomeLink() {
  return <Link to="/home" className={`${pixelButton("blue")} gap-2`}><ArrowLeft size={20} aria-hidden="true" />Return to Home</Link>;
}