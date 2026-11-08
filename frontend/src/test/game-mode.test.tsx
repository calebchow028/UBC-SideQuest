import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GAME_MODE_STORAGE_KEY, GameModeProvider, gameModes, gameModePlayerTotals, useGameMode } from "@/components/game-mode-provider";

function ModeConsumer() {
  const { activeGameMode, setActiveGameMode } = useGameMode();
  return <><output data-testid="mode">{activeGameMode}</output>{gameModes.map(mode => <button key={mode.value} onClick={() => setActiveGameMode(mode.value)}>{mode.label}</button>)}</>;
}

describe("shared activeGameMode", () => {
  it.each([
    ["singleplayer", 1], ["2player", 2], ["4player", 4], ["10player", 10],
  ] as const)("requires %i players for %s", (mode, total) => {
    expect(gameModePlayerTotals[mode]).toBe(total);
  });
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);
  it("defaults to 2player on a first visit", () => {
    render(<GameModeProvider><ModeConsumer /></GameModeProvider>);
    expect(screen.getByTestId("mode")).toHaveTextContent("2player");
  });
  it.each([['Singleplayer', 'singleplayer'], ['2 Player', '2player'], ['4 Player', '4player'], ['10 Player', '10player']])("selects and persists %s", (label, value) => {
    render(<GameModeProvider><ModeConsumer /></GameModeProvider>);
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(screen.getByTestId("mode")).toHaveTextContent(value);
    expect(localStorage.getItem(GAME_MODE_STORAGE_KEY)).toBe(value);
  });
  it("restores the selected mode after a refresh", () => {
    localStorage.setItem(GAME_MODE_STORAGE_KEY, "10player");
    render(<GameModeProvider><ModeConsumer /></GameModeProvider>);
    expect(screen.getByTestId("mode")).toHaveTextContent("10player");
  });
  it("retains selection when the page changes", () => {
    const view = render(<GameModeProvider><ModeConsumer key="home" /></GameModeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "4 Player" }));
    view.rerender(<GameModeProvider><ModeConsumer key="queue" /></GameModeProvider>);
    expect(screen.getByTestId("mode")).toHaveTextContent("4player");
  });
  it("falls back to 2player for an unsupported stored value", () => {
    localStorage.setItem(GAME_MODE_STORAGE_KEY, "invalid");
    render(<GameModeProvider><ModeConsumer /></GameModeProvider>);
    expect(screen.getByTestId("mode")).toHaveTextContent("2player");
  });
});