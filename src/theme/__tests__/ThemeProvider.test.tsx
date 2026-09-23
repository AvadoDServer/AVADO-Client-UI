import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { THEME_STORAGE_KEY, ThemeProvider, useTheme } from "../ThemeProvider";

function mockMatchMedia(prefersLight: boolean) {
  const listeners: Array<(e: MediaQueryListEvent) => void> = [];
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("light") ? prefersLight : false,
    media: query,
    addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.push(l),
    removeEventListener: vi.fn(),
  }));
  return (light: boolean) => listeners.forEach((l) => l({ matches: light } as MediaQueryListEvent));
}

function Probe() {
  const { theme, preference, setPreference } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="pref">{preference}</span>
      <button onClick={() => setPreference("light")}>light</button>
      <button onClick={() => setPreference("dark")}>dark</button>
      <button onClick={() => setPreference("system")}>system</button>
    </div>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => document.documentElement.removeAttribute("data-theme"));

  it("defaults to system (match computer) and follows the OS", () => {
    const fire = mockMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("pref")).toHaveTextContent("system");
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    act(() => fire(false));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("stores an explicit choice under avado.theme and clears it for system", async () => {
    mockMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByText("light"));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(THEME_STORAGE_KEY).toBe("avado.theme");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    await userEvent.click(screen.getByText("system"));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
  });

  it("restores a stored preference and ignores junk", () => {
    mockMatchMedia(true);
    localStorage.setItem("avado.theme", "dark");
    const { unmount } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    unmount();
    localStorage.setItem("avado.theme", "purple");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("pref")).toHaveTextContent("system");
  });
});
