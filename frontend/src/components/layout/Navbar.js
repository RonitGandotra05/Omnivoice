"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import Icon from "@/components/ui/Icon";
export default function Navbar() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const links = [
    ["Overview", "/"],
    ["Agent studio", "/try-for-free"],
    ["Pricing", "/pricing"],
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
              aria-current={path === url ? "page" : undefined}
              className={path === url ? "active" : ""}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="nav-actions">
          <Link href="/account" className="sign-in">
            Sign in
          </Link>
          <Link href="/try-for-free" className="button dark small">
            Build an agent <Icon name="arrow" />
          </Link>
          <button
            type="button"
            className="menu-toggle"
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
          {[...links, ["Sign in", "/account"], ["Contact", "/contact"]].map(
            ([label, url]) => (
              <Link key={url} href={url} onClick={() => setOpen(false)}>
                {label}
                <Icon name="right" />
              </Link>
            ),
          )}
        </nav>
      )}
    </header>
  );
}
