"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
const Preferences = createContext(null);
export function AccountPreferences({ children }) {
  const requestVersion = useRef(0);
  const [data, setData] = useState({
    account: null,
    providers: {},
    email_available: false,
    allowance: null,
  });
  const [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(""),
    [theme, setThemeState] = useState("light");
  const setTheme = useCallback((value) => {
    const choice = ["light", "dark", "system"].includes(value)
      ? value
      : "light";
    setThemeState(choice);
    try {
      localStorage.setItem("ov-theme", choice);
    } catch {}
    document.documentElement.dataset.theme =
      choice === "system"
        ? matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : choice;
  }, []);
  const refresh = useCallback(
    async ({ preserveTheme = false } = {}) => {
      const version = ++requestVersion.current;
      try {
        const response = await fetch("/api/account/session", {
            cache: "no-store",
          }),
          next = await response.json();
        if (!response.ok)
          throw Error(next.error || "Account details could not be loaded.");
        if (version !== requestVersion.current) return null;
        setData(next);
        setLoadError("");
        if (next.account && !preserveTheme) {
          let savedTheme = null;
          try {
            savedTheme = localStorage.getItem("ov-theme");
          } catch {}
          if (!["light", "dark", "system"].includes(savedTheme))
            setTheme(
              next.account.theme === "light" || next.account.theme === "dark"
                ? next.account.theme
                : "light",
            );
        }
        return next;
      } catch (error) {
        if (version === requestVersion.current) setLoadError(error.message);
        return null;
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    },
    [setTheme],
  );
  useEffect(() => {
    let savedTheme = null;
    try {
      savedTheme = localStorage.getItem("ov-theme");
    } catch {}
    if (["light", "dark", "system"].includes(savedTheme)) setTheme(savedTheme);
    refresh({
      preserveTheme: ["light", "dark", "system"].includes(savedTheme),
    });
  }, [refresh, setTheme]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const change = () => {
      if (theme === "system")
        document.documentElement.dataset.theme = media.matches
          ? "dark"
          : "light";
    };
    const storage = (event) => {
      if (event.key === "ov-theme") setTheme(event.newValue || "light");
    };
    media.addEventListener("change", change);
    window.addEventListener("storage", storage);
    return () => {
      media.removeEventListener("change", change);
      window.removeEventListener("storage", storage);
    };
  }, [theme, setTheme]);
  async function logout(all = false) {
    const response = await fetch(
      "/api/account/" + (all ? "logout-all" : "logout"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    if (!response.ok) throw Error("Could not sign out. Please try again.");
    requestVersion.current++;
    setData((current) => ({ ...current, account: null, allowance: null }));
  }
  return (
    <Preferences.Provider
      value={{ ...data, loading, loadError, refresh, logout, theme, setTheme }}
    >
      {children}
    </Preferences.Provider>
  );
}
export const useAccount = () => useContext(Preferences);
