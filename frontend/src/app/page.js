import Link from "next/link";
import Icon from "@/components/ui/Icon";
import VoiceInstrument from "@/components/ui/VoiceInstrument";
export const metadata = {
  alternates: { canonical: "/" },
};
const steps = [
  [
    "01",
    "Give it your world.",
    "Upload FAQs, product guides, and policies. Get answers grounded in your company’s documents.",
    "document",
  ],
  [
    "02",
    "Define the handoff.",
    "Route billing, technical questions, and exceptions to your team’s inboxes.",
    "settings",
  ],
  [
    "03",
    "Test before you connect.",
    "Ask customer questions, review the sources, and check handoffs before connecting your phone line.",
    "phone",
  ],
];
export default function Home() {
  return (
    <div className="page-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="status-dot" /> AI CUSTOMER SUPPORT
          </p>
          <h1>
            Your company.
            <br />
            Every call.
            <br />
            <em>Understood.</em>
          </h1>
          <p className="hero-description">
            Your documents. Your policies. Your people.
            <br />
            One support agent that fits your company.
            <br />
            Answer with evidence. Escalate with context.
          </p>
          <div className="hero-actions">
            <Link href="/try-for-free" className="button copper">
              Build your company agent <Icon name="arrow" />
            </Link>
            <Link href="/#how-it-works" className="text-link">
              See how it works <Icon name="right" />
            </Link>
          </div>
          <p className="microcopy">
            Try it with sample documents. No phone call required.
          </p>
        </div>
        <VoiceInstrument />
      </section>
      <section id="how-it-works" className="workflow" aria-label="How it works">
        {steps.map(([n, title, text, icon]) => (
          <article key={n}>
            <div className="workflow-number">
              <span>{n} /</span>
              <Icon name={icon} />
            </div>
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>
      <section id="features" className="feature-section">
        <div>
          <p className="eyebrow">BUILT FOR THE EVERYDAY</p>
          <h2>
            Small details.
            <br />
            <em>Better conversations.</em>
          </h2>
          <p className="section-description">
            From the first question to the next step, give your agent a clear
            purpose.
          </p>
          <Link href="/try-for-free" className="text-link">
            Explore the company studio <Icon name="arrow" />
          </Link>
        </div>
        <div className="feature-grid">
          {[
            [
              "chat",
              "Support that stays on topic",
              "Ground answers in your business facts and hand off questions that need a person.",
            ],
            [
              "phone",
              "Escalations with context",
              "Save the caller’s issue and transcript. Route it to a team and track email delivery.",
            ],
            [
              "shield",
              "Thoughtful guardrails",
              "Keep missing facts, off-topic requests, and sensitive information in check.",
            ],
            [
              "bolt",
              "A company API, ready to plug in",
              "Company-scoped keys connect document search and human handoffs to your existing tools.",
            ],
          ].map(([icon, title, text]) => (
            <article key={title}>
              <Icon name={icon} />
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="cta-panel">
        <div>
          <p className="eyebrow">START WITH A CONVERSATION</p>
          <h2>
            Support that knows
            <br />
            <em>your business.</em>
          </h2>
          <p>
            Test the flow. Shape the personality. Connect when you’re ready.
          </p>
        </div>
        <Link href="/try-for-free" className="button copper">
          Open the studio <Icon name="arrow" />
        </Link>
      </section>
    </div>
  );
}
