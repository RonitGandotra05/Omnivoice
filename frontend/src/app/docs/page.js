import Link from "next/link";
import Icon from "@/components/ui/Icon";
export const metadata = {
  title: "How it works",
  description:
    "A short guide to company knowledge, voice demos, and human handoffs in OmniVoice.",
};
export default function Guide() {
  return (
    <div className="page-shell guide-page">
      <header className="guide-heading">
        <p className="eyebrow">THE QUICK GUIDE</p>
        <h1>
          Your knowledge. <em>A helpful voice.</em>
        </h1>
        <p>
          Give your agent the facts, choose when it should ask for help, and
          test the conversation.
        </p>
        <Link className="button copper" href="/tutorial">
          Build your first agent <Icon name="arrow" />
        </Link>
      </header>
      <nav className="guide-jump-links" aria-label="Guide topics">
        <a href="#knowledge">Documents</a>
        <a href="#handoffs">Handoffs</a>
        <a href="#voice-demo">Voice demo</a>
        <a href="#workspace-data">Your data</a>
      </nav>
      <div className="guide-cards">
        <section id="knowledge" className="panel">
          <p className="eyebrow">01 / KNOWLEDGE</p>
          <h2>Bring the answers.</h2>
          <p>
            In Company setup, upload FAQs, service guides and policies, or paste
            text alongside them. Both sources are used together. Review
            extracted text before starting your agent.
          </p>
          <ul>
            <li>PDF, DOCX, TXT, Markdown, and JSON</li>
            <li>Up to 35 files per batch, 10 MB each</li>
            <li>Scanned PDFs use OCR and need your review</li>
          </ul>
          <details>
            <summary>Document limits and updates</summary>
            <p>
              Keep up to 100 documents in a workspace. Each document can contain
              200,000 extracted characters, with 5 million across the workspace.
              After editing or removing documents, publish again to update your
              agent.
            </p>
          </details>
        </section>
        <section id="handoffs" className="panel">
          <p className="eyebrow">02 / HUMAN SUPPORT</p>
          <h2>Know when to hand over.</h2>
          <p>
            Set team inboxes, routing keywords, business hours, and your
            timezone.
          </p>
          <p>
            If someone asks for a person, the agent can record their request and
            consented contact details. After hours, it can offer a callback
            request.
          </p>
          <details>
            <summary>What happens to a request?</summary>
            <p>
              Browser demos save requests for review. Email delivery and
              telephone transfers need a connected company setup. A saved
              callback request is not a confirmed appointment.
            </p>
          </details>
        </section>
        <section id="voice-demo" className="panel">
          <p className="eyebrow">03 / TRY IT</p>
          <h2>Hear your agent in action.</h2>
          <p>
            Sign in with a verified account for up to{" "}
            <strong>10 minutes daily</strong>.
          </p>
          <p>
            In the studio, open <strong>Test conversation</strong>, select play,
            and allow microphone access. Your agent is prepared automatically.
            Add company documents for specific answers, or skip uploads and try
            a general support conversation.
          </p>
          <details>
            <summary>How demo time works</summary>
            <p>
              Your remaining time is reserved when you start, even if the call
              ends early or fails to connect. Limits apply over a rolling 24
              hours and are shared across your account, browser, and network.
              Previous demo use counts toward your daily allowance.
            </p>
            <p>
              This is a browser conversation, so no phone number is needed.
              Audio is processed by the voice service. Text previews remain
              available when your voice allowance is used.
            </p>
          </details>
        </section>
        <section id="workspace-data" className="panel">
          <p className="eyebrow">04 / YOUR WORKSPACE</p>
          <h2>You choose what to share.</h2>
          <p>
            By default, documents and requests stay in this browser. Publishing
            shares approved extracted text with your voice agent.
          </p>
          <p>
            Export a backup before changing devices or clearing browser data.
          </p>
          <details>
            <summary>Before using customer information</summary>
            <p>
              Review document text and only publish information your business is
              allowed to share. Ask for permission before saving caller contact
              details. Connected company workspaces may also store records on
              the server.
            </p>
          </details>
        </section>
      </div>
      <div className="guide-next">
        <p>Ready to make it yours?</p>
        <Link href="/try-for-free" className="button copper">
          Open the studio <Icon name="arrow" />
        </Link>
        <Link href="/contact" className="text-link">
          Ask a question <Icon name="right" />
        </Link>
      </div>
    </div>
  );
}
