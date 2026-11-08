import chats from "@/assets/illustration-chats.png";
import friends from "@/assets/illustration-friends.png";
import stats from "@/assets/illustration-stats.png";
import account from "@/assets/illustration-account.png";
import quest from "@/assets/illustration-quest.png";

const illustrations = { chats, friends, stats, account, quest };
export type CampusIllustrationKind = keyof typeof illustrations;

export function CampusIllustration({ kind, size = "page" }: { kind: CampusIllustrationKind; size?: "menu" | "page" }) {
  return <img src={illustrations[kind]} alt="" aria-hidden="true" width={816} height={816} loading="lazy" className={`campus-illustration campus-illustration-${size}`} />;
}