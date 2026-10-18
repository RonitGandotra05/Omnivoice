import Link from "next/link";
import Icon from "@/components/ui/Icon";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Contact",
  description: "Discuss your business support workflow and OmniVoice setup.",
  alternates: { canonical: "/contact" },
};
export default function Contact() {
  const configured = (process.env.CONTACT_EMAIL || "").trim();
  const email = /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(configured)
    ? configured
    : null;
  return (
    <div className="page-shell guide-page">
      <header className="guide-heading">
        <p className="eyebrow">LET’S TALK</p>
        <h1>
          Support that fits <em>your business.</em>
        </h1>
        <p>Have a question or a company in mind? Get in touch with Ronit.</p>
      </header>
      <div className="contact-cards">
        <section className="panel contact-card">
          <Icon name="chat" />
          <h2>Talk about your setup.</h2>
          <p>
            Share your business, the questions you receive, and what you’d like
            your agent to handle.
          </p>
          <a
            className="button copper"
            href={
              email
                ? `mailto:${email}?subject=OmniVoice%20enquiry`
                : "https://www.linkedin.com/in/ronitgandotra"
            }
            {...(!email
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
          >
            {email ? "Email Ronit" : "Message on LinkedIn"}
            <Icon name="arrow" />
          </a>
        </section>
        <section className="panel contact-card">
          <Icon name="document" />
          <h2>Need a hand getting started?</h2>
          <p>
            Build a sample agent, add a few documents, and try your first
            conversation.
          </p>
          <Link href="/tutorial" className="button outline">
            Follow the tutorial <Icon name="arrow" />
          </Link>
          <a
            className="text-link"
            href="https://github.com/RonitGandotra05/Omnivoice/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            Report a technical issue <Icon name="right" />
          </a>
          <small>
            Keep passwords, API keys, and private customer information out of
            public reports.
          </small>
        </section>
      </div>
      <div className="guide-next">
        <p>Want to hear it first?</p>
        <Link className="text-link" href="/try-for-free">
          Try the free demo <Icon name="arrow" />
        </Link>
      </div>
    </div>
  );
}
