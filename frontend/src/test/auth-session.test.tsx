import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { createAccount, currentUser, signIn, signOut } from "@/lib/auth";
import { SessionGate } from "@/components/session-gate";

const navigation = vi.hoisted(() => ({ navigate: vi.fn(), pathname: "/account" }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigation.navigate,
  useLocation: ({ select }: { select: (location: { pathname: string }) => string }) => select({ pathname: navigation.pathname }),
}));

beforeEach(() => { localStorage.clear(); navigation.navigate.mockClear(); });

describe("Sign-out session rules", () => {
  it("clears the active session while retaining the account for signing in again", () => {
    createAccount("hayden", "quest-pass");
    expect(currentUser()).toBe("hayden");
    signOut();
    expect(currentUser()).toBeNull();
    expect(signIn("hayden", "quest-pass")).toBe("ok");
  });

  it.each(["/home", "/account", "/chats", "/friends", "/stats", "/quest", "/verify", "/queue", "/map"])("blocks %s after sign-out and redirects to sign-in", async (pathname) => {
    navigation.pathname = pathname;
    createAccount("hayden", "quest-pass");
    signOut();
    const view = render(<SessionGate><div>Private content</div></SessionGate>);
    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith({ to: "/", replace: true }));
    expect(view.queryByText("Private content")).toBeNull();
    view.unmount();
  });

  it("allows a signed-in member to see the page", async () => {
    createAccount("hayden", "quest-pass");
    const view = render(<SessionGate><div>Private content</div></SessionGate>);
    expect(await view.findByText("Private content")).toBeInTheDocument();
    expect(navigation.navigate).not.toHaveBeenCalled();
    view.unmount();
  });
});