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
          <Link href="/pricing">Pricing</Link>
          <Link href="/contact">Contact</Link>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} OmniVoice Labs</span>
        <span>DESIGNED FOR A MORE HUMAN CONNECTION.</span>
        <span>BUILT FOR YOUR BUSINESS</span>
      </div>
    </footer>
  );
}
