import Link from "next/link";
import Icon from "@/components/ui/Icon";
export const metadata = {
  title: "Your first agent",
  description:
    "Set up your company in one place, then talk to your support agent.",
  alternates: { canonical: "/tutorial" },
};
export default function Tutorial() {
  return (
    <div className="page-shell guide-page tutorial-page">
      <header className="guide-heading">
        <p className="eyebrow">YOUR FIRST AGENT</p>
        <h1>
          One setup. <em>Then start talking.</em>
        </h1>
        <p>
          Sign in, introduce your company, and hear your support agent in
          action.
        </p>
        <Link href="/try-for-free" className="button copper">
          Set up your company <Icon name="arrow" />
        </Link>
      </header>
      <ol className="tutorial-steps">
        <li className="panel">
          <span className="tutorial-number" aria-hidden="true">
            01
          </span>
          <div>
            <h2>Everything in Company setup.</h2>
            <p>
              Add your company name, greeting, tone, support hours and handoff
              contacts on one page.
            </p>
            <p>
              Upload PDFs and other documents, write or paste knowledge, or
              combine both. All sources feed the same agent. You can also skip
              knowledge for a general support demo.
            </p>
            <div className="guide-example">
              <span>Example company notes</span>
              <blockquote>
                Northstar Repairs fixes laptops and desktop computers. We’re
                open Monday–Friday, 9 am–5 pm. A technician must inspect a
                device before confirming a repair price.
              </blockquote>
            </div>
            <p className="guide-caption">
              Review extracted document text before use. Typed notes are
              included when you save or start your voice demo.
            </p>
          </div>
        </li>
        <li className="panel">
          <span className="tutorial-number" aria-hidden="true">
            02
          </span>
          <div>
            <h2>Talk to your agent.</h2>
            <p>
              Select <strong>Talk to your agent</strong>, press play, and allow
              microphone access. Your settings and knowledge are prepared
              automatically.
            </p>
            <div className="guide-example">
              <span>Say it aloud</span>
              <blockquote>Hi, I’m Alex. Can I get a repair quote?</blockquote>
            </div>
            <p>
              The agent asks for caller details during the conversation. Try
              requesting a human, then check collected details and requests in
              Activity & settings.
            </p>
            <p className="guide-caption">
              The browser demo records human-support requests; it does not
              transfer a phone call or send email on its own.
            </p>
            <Link href="/try-for-free?view=voice" className="text-link">
              Already set up? Start your voice demo <Icon name="right" />
            </Link>
          </div>
        </li>
      </ol>
      <div className="guide-next">
        <p>Make it your company’s voice.</p>
        <Link href="/try-for-free" className="button copper">
          Open your workspace <Icon name="arrow" />
        </Link>
        <Link href="/docs" className="text-link">
          Read the guide <Icon name="right" />
        </Link>
      </div>
    </div>
  );
}
