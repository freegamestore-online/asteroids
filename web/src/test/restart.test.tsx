import { render, screen, fireEvent } from "@testing-library/react";
import { useEffect } from "react";
import { describe, it, expect, vi } from "vitest";

const mounts = vi.hoisted(() => ({ count: 0, paused: [] as boolean[] }));

vi.mock("../components/Game", () => ({
  Game: ({ paused }: { paused: boolean }) => {
    useEffect(() => {
      mounts.count++;
    }, []);
    mounts.paused.push(paused);
    return null;
  },
}));

import App from "../App";

describe("topbar restart", () => {
  it("remounts the game and clears pause mid-game", () => {
    render(<App />);
    expect(mounts.count).toBe(1);

    fireEvent.click(screen.getByLabelText("Pause"));
    expect(mounts.paused.at(-1)).toBe(true);

    fireEvent.click(screen.getByLabelText("Restart"));
    expect(mounts.count).toBe(2);
    expect(mounts.paused.at(-1)).toBe(false);
  });
});
