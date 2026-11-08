// Front-end-only mock auth. Swap these functions for a real backend later.
const USERS = "qa_users";
const SESSION = "qa_session";

type Users = Record<string, { password: string; verified: boolean }>;

function readUsers(): Users {
  try {
    return JSON.parse(localStorage.getItem(USERS) || "{}");
  } catch {
    return {};
  }
}
function writeUsers(u: Users) {
  localStorage.setItem(USERS, JSON.stringify(u));
}

export function signIn(username: string, password: string): "ok" | "no-account" | "bad-password" {
  const u = readUsers()[username.trim().toLowerCase()];
  if (!u) return "no-account";
  if (u.password !== password) return "bad-password";
  localStorage.setItem(SESSION, username.trim().toLowerCase());
  return "ok";
}

export function createAccount(username: string, password: string): boolean {
  const key = username.trim().toLowerCase();
  const users = readUsers();
  if (users[key]) return false;
  users[key] = { password, verified: false };
  writeUsers(users);
  localStorage.setItem(SESSION, key);
  return true;
}

export function markVerified() {
  const key = currentUser();
  if (!key) return;
  const users = readUsers();
  if (users[key]) users[key].verified = true;
  writeUsers(users);
}

export function currentUser(): string | null {
  return localStorage.getItem(SESSION);
}

export function signOut() {
  localStorage.removeItem(SESSION);
}
