import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export const gameModes = [
  { value: "singleplayer", label: "Singleplayer" },
  { value: "2player", label: "2 Player" },
  { value: "4player", label: "4 Player" },
  { value: "10player", label: "10 Player" },
] as const;
export type GameMode = typeof gameModes[number]["value"];
export const gameModePlayerTotals: Record<GameMode, number> = {
  singleplayer: 1,
  "2player": 2,
  "4player": 4,
  "10player": 10,
};
export const GAME_MODE_STORAGE_KEY = "sidequest_activeGameMode";
export function isGameMode(value: unknown): value is GameMode {
  return gameModes.some(mode => mode.value === value);
}

const GameModeContext = createContext<{
  activeGameMode: GameMode;
  setActiveGameMode: (mode: GameMode) => void;
} | null>(null);

export function GameModeProvider({ children }: { children: ReactNode }) {
  const [activeGameMode, setMode] = useState<GameMode>("2player");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(GAME_MODE_STORAGE_KEY);
      if (isGameMode(saved)) setMode(saved);
    } catch { /* Selection still works if browser storage is disabled. */ }
    function syncMode(event: StorageEvent) {
      if (event.key === GAME_MODE_STORAGE_KEY) setMode(isGameMode(event.newValue) ? event.newValue : "2player");
    }
    window.addEventListener("storage", syncMode);
    return () => window.removeEventListener("storage", syncMode);
  }, []);

  function setActiveGameMode(mode: GameMode) {
    setMode(mode);
    try { localStorage.setItem(GAME_MODE_STORAGE_KEY, mode); } catch { /* Keep shared state available. */ }
  }

  return <GameModeContext.Provider value={{ activeGameMode, setActiveGameMode }}>{children}</GameModeContext.Provider>;
}

export function useGameMode() {
  const context = useContext(GameModeContext);
  if (!context) throw new Error("useGameMode requires GameModeProvider");
  return context;
}