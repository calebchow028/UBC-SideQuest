import { Link } from "@tanstack/react-router";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { SessionGate } from "@/components/session-gate";
import { ArrowLeft, Compass } from "lucide-react";

export function Screen({ bg, children, publicPage = false }: { bg: string; children: ReactNode; publicPage?: boolean }) {
  const content = (
    <div className="site-screen relative overflow-hidden bg-background">
      <img src={bg} alt="" aria-hidden width={768} height={1344} className="scene-image absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 scene-fade" />
      <div className="site-content relative mx-auto flex w-full flex-col animate-in fade-in duration-500">
        {children}
      </div>
    </div>
  );
  return publicPage ? content : <SessionGate>{content}</SessionGate>;
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-logo ${compact ? "brand-logo-compact" : ""}`}>
      {!compact && <div aria-hidden="true" className="brand-emblem pixel-box flex items-center justify-center bg-secondary"><Compass size={44} strokeWidth={1.75} /></div>}
      <h1 className="brand-title"><span>UBC</span><span>SideQuest</span></h1>
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`pixel-panel p-5 ${className}`}>{children}</div>;
}

export function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-base font-semibold text-foreground">{label}</span>
      <input
        {...props}
        className="pixel-box h-12 w-full bg-input px-4 text-lg text-ink outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}

type Variant = "gold" | "blue" | "quest";
const variants: Record<Variant, string> = {
  gold: "bg-primary text-primary-foreground",
  blue: "bg-secondary text-secondary-foreground",
  quest: "bg-accent text-accent-foreground quest-glow",
};

export function pixelButton(variant: Variant = "gold", size: "md" | "lg" = "md") {
  return `pixel-box pixel-press flex w-full items-center justify-center font-display ${
    size === "lg" ? "h-20 text-xl" : "h-14 text-base"
  } ${variants[variant]} disabled:opacity-50 disabled:pointer-events-none`;
}

export function PrimaryButton({ variant = "gold", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...props} className={`${pixelButton(variant)} ${props.className ?? ""}`} />;
}

export function SubPage({ title, emoji, text, bg, children }: { title: string; emoji: string; text: string; bg: string; children?: ReactNode }) {
  return (
    <Screen bg={bg}>
      <header className="mb-6">
        <Link to="/home" className="pixel-box pixel-press inline-flex h-11 items-center gap-2 bg-secondary px-4 font-display text-sm text-secondary-foreground">
          <ArrowLeft size={18} aria-hidden="true" /> Home
        </Link>
      </header>
      <h1 className="text-2xl text-brand text-pixel-shadow">{title}</h1>
      <div className={children ? "mt-8" : "mt-auto"}>
        <Panel className="text-center">
          <div className="text-5xl">{emoji}</div>
          <p className="mt-3 text-lg">{text}</p>
        </Panel>
        {children && <div className="mt-8">{children}</div>}
      </div>
    </Screen>
  );
}
