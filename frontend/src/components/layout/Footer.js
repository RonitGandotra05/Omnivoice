import Link from "next/link";
export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-top">
        <Link href="/" className="footer-brand">
          omni<span>voice</span>
          <small>Good conversations. Thoughtfully built.</small>
        </Link>
        <div className="footer-links">
          <Link href="/try-for-free">Agent studio</Link>
          <Link href="/docs">How it works</Link>
          <Link href="/tutorial">Tutorial</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/contact">Contact</Link>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} OmniVoice Labs</span>
        <div className="creator-credit">
          <span>
            Made by{" "}
            <a
              className="creator-name"
              href="https://github.com/RonitGandotra05"
              target="_blank"
              rel="noopener noreferrer"
            >
              Ronit Gandotra
            </a>
          </span>
          <a
            href="https://github.com/RonitGandotra05"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub <span aria-hidden="true">↗</span>
          </a>
          <a
            href="https://www.linkedin.com/in/ronitgandotra"
            target="_blank"
            rel="noopener noreferrer"
          >
            LinkedIn <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
    </footer>
  );
}
