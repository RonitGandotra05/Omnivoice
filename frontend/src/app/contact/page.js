import Link from "next/link";
import Icon from "@/components/ui/Icon";
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
              Create a dedicated agent for your business in your workspace. Set
              its voice, language, business prompt, and fallback rules.
            </li>
            <li>
              Add business documents to that agent’s knowledge base. Keep
              different companies on separate agents.
            </li>
            <li>
              Connect booking, CRM, or human handoff tools if the agent needs to
              take action.
            </li>
            <li>
              Import a Twilio number in your workspace and assign your agent for
              inbound calls.
            </li>
            <li>
              Before enabling outbound calls in this app, configure server
              credentials and operator access. Live calls are off by default.
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
            <div className="contact-note">
              Contact messaging is not configured yet. You can preview and
              export your agent brief in the playground.
            </div>
          )}
          <small>
            Operators: set CONTACT_EMAIL on the frontend server to enable
            enquiries.
          </small>
        </aside>
      </div>
    </div>
  );
}
