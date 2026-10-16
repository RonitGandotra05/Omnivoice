import Link from "next/link";
import Icon from "@/components/ui/Icon";
export const dynamic = "force-dynamic";
export const metadata = { title: "Connect your agent" };
export default function Contact() {
  const email = process.env.CONTACT_EMAIL;
  return (
    <div className="page-shell contact">
      <div className="page-kicker">
        <span>CONNECTION / YOUR NEXT STEP</span>
        <span>FROM PREVIEW TO PHONE LINE ↗</span>
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">LET’S MAKE THE CONNECTION</p>
          <h1>
            A voice for
            <br />
            <em>your business.</em>
          </h1>
          <p>
            A few thoughtful steps between your first preview and your first
            real conversation.
          </p>
        </div>
        <Link href="/try-for-free" className="button dark">
          Keep exploring <Icon name="arrow" />
        </Link>
      </div>
      <div className="connection-guide">
        <section className="panel">
          <p className="eyebrow">01 / SET UP YOUR AGENT</p>
          <h2>
            Let your agent
            <br />
            do the heavy lifting.
          </h2>
          <ol>
            <li>
              <strong>Add your company details.</strong> Set a greeting, tone,
              and support inbox so the agent represents your business.
            </li>
            <li>
              <strong>Share your knowledge.</strong> Upload FAQs, product
              guides, opening hours, and policies.
            </li>
            <li>
              <strong>Choose the handoff.</strong> Tell the agent which team
              should receive billing questions, technical issues, and other
              requests.
            </li>
            <li>
              <strong>Test the experience.</strong> Ask real customer questions
              and review the answers and sources before connecting your phone
              line.
            </li>
          </ol>
          <Link href="/try-for-free" className="text-link">
            Open your company workspace <Icon name="arrow" />
          </Link>
        </section>
        <aside className="dark-panel">
          <Icon name="chat" />
          <p className="eyebrow">A MORE THOUGHTFUL SETUP</p>
          <h2>
            Start with
            <br />
            the right questions.
          </h2>
          <p>
            Which calls should your agent handle? What should it hand off? Where
            does a request become a confirmed action?
          </p>
          <p>
            Bring your business hours, services, policies, and a clear
            escalation route.
          </p>
          {email ? (
            <a
              className="button copper"
              href={`mailto:${email}?subject=OmniVoice%20workspace%20enquiry`}
            >
              Discuss your setup <Icon name="arrow" />
            </a>
          ) : (
            <Link href="/try-for-free" className="button copper">
              Open your workspace <Icon name="arrow" />
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}
