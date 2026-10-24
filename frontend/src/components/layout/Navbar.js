"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Icon from "@/components/ui/Icon";
import { useAccount } from "@/components/AccountPreferences";
export default function Navbar() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const menuButton = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  const { account, setTheme } = useAccount();
  const links = [
    ["Overview", "/"],
    ["Agent studio", "/try-for-free"],
    ["Guide", "/docs"],
    ["Pricing", "/pricing"],
    ...(account?.is_admin ? [["Admin", "/admin/dashboard"]] : []),
  ];
  return (
    <header className="site-header">
      <div className="nav-shell">
        <Link href="/" className="brand" onClick={() => setOpen(false)}>
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            omni<span className="brand-light">voice</span>
            <small>VOICE AGENT STUDIO</small>
          </span>
        </Link>
        <nav className="desktop-nav" aria-label="Main navigation">
          {links.map(([label, url]) => (
            <Link
              key={url}
              href={url}
              aria-current={
                path === url || (url === "/docs" && path === "/tutorial")
                  ? "page"
                  : undefined
              }
              className={
                path === url || (url === "/docs" && path === "/tutorial")
                  ? "active"
                  : ""
              }
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="nav-actions">
          <button
            type="button"
            className="theme-toggle"
            aria-label="Toggle dark mode"
            onClick={() =>
              setTheme(
                document.documentElement.dataset.theme === "dark"
                  ? "light"
                  : "dark",
              )
            }
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M20.5 13.1A8.5 8.5 0 0 1 10.9 3.5 8.5 8.5 0 1 0 20.5 13.1Z" />
            </svg>
          </button>
          <Link
            href={account ? "/account/settings" : "/account"}
            className="sign-in"
          >
            {account ? "Account" : "Sign in"}
          </Link>
          <Link href="/try-for-free" className="button dark small">
            Build an agent <Icon name="arrow" />
          </Link>
          <button
            type="button"
            className="menu-toggle"
            ref={menuButton}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-navigation"
            onClick={() => setOpen(!open)}
          >
            <Icon name={open ? "close" : "menu"} />
          </button>
        </div>
      </div>
      {open && (
        <nav
          id="mobile-navigation"
          className="mobile-nav"
          aria-label="Mobile navigation"
        >
          {[
            ...links,
            [
              account ? "Account settings" : "Sign in",
              account ? "/account/settings" : "/account",
            ],
            ["Contact", "/contact"],
          ].map(([label, url]) => (
            <Link key={url} href={url} onClick={() => setOpen(false)}>
              {label}
              <Icon name="right" />
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
