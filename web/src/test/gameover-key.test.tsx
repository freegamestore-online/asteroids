import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const game = vi.hoisted(() => ({ onGameOver: () => {} }));

vi.mock("../components/Game", () => ({
  Game: ({ onGameOver }: { onGameOver: () => void }) => {
    game.onGameOver = onGameOver;
    return null;
  },
}));

import App from "../App";

describe("game-over screen keys", () => {
  it("ignores auto-repeated Space from holding fire, starts on a fresh press", () => {
    render(<App />);
    act(() => game.onGameOver());
    expect(screen.getByText(/Game Over!/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: " ", repeat: true });
    expect(screen.getByText(/Game Over!/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: " " });
    expect(screen.queryByText(/Game Over!/)).not.toBeInTheDocument();
  });
});
