import Link from "next/link";
import Icon from "@/components/ui/Icon";
export const metadata = {
  title: "Your first agent",
  description:
    "Build a sample customer support agent with a short, practical OmniVoice tutorial.",
};
export default function Tutorial() {
  return (
    <div className="page-shell guide-page tutorial-page">
      <header className="guide-heading">
        <p className="eyebrow">FOLLOW ALONG</p>
        <h1>
          Your first agent. <em>Step by step.</em>
        </h1>
        <p>
          Sign in with a verified account, then follow this fictional repair
          business. Replace the examples with your own.
        </p>
        <Link href="/try-for-free" className="button copper">
          Open the studio <Icon name="arrow" />
        </Link>
      </header>
      <ol className="tutorial-steps">
        <li className="panel">
          <span className="tutorial-number" aria-hidden="true">
            01
          </span>
          <div>
            <h2>Introduce your company.</h2>
            <p>
              In <strong>Company brief</strong>, enter “Northstar Repairs,”
              choose a friendly tone, and set Monday–Friday, 9 am–5 pm in your
              timezone.
            </p>
            <div className="guide-example">
              <span>Example greeting</span>
              <blockquote>
                Hi, you’ve reached Northstar Repairs. How can I help today?
              </blockquote>
            </div>
          </div>
        </li>
        <li className="panel">
          <span className="tutorial-number" aria-hidden="true">
            02
          </span>
          <div>
            <h2>Add a small FAQ.</h2>
            <p>
              Save these example answers as a TXT file and upload it in{" "}
              <strong>Knowledge</strong>. Review the extracted text.
            </p>
            <pre className="guide-example">{`What do you repair?\nWe repair laptops and desktop computers.\n\nWhat are your hours?\nMonday to Friday, 9 am to 5 pm.\n\nCan I get a repair quote?\nA technician must inspect the device before confirming a price.`}</pre>
            <p className="guide-caption">
              Use fictional details for testing. Replace them before publishing
              a real company agent.
            </p>
          </div>
        </li>
        <li className="panel">
          <span className="tutorial-number" aria-hidden="true">
            03
          </span>
          <div>
            <h2>Choose the human handoff.</h2>
            <p>
              In <strong>Escalations</strong>, add a Repairs team with keywords
              “quote, repair, technician.” Use your team’s real inbox when
              setting up your business.
            </p>
            <div className="guide-example">
              <span>Try asking</span>
              <blockquote>
                I’d like to speak to a technician about a repair quote.
              </blockquote>
            </div>
            <p>
              The demo should record a human-support request. It does not send
              email or transfer a phone call by itself.
            </p>
          </div>
        </li>
        <li className="panel">
          <span className="tutorial-number" aria-hidden="true">
            04
          </span>
          <div>
            <h2>Check the answers.</h2>
            <p>
              Open <strong>Test conversation</strong>. Ask about repairs and
              hours, then check the source shown with each answer.
            </p>
            <div className="guide-example">
              <span>Also try</span>
              <blockquote>How much will my repair cost?</blockquote>
            </div>
            <p>
              Your agent should offer a handoff rather than invent a price. Try
              an after-hours question in the caller journey, too.
            </p>
          </div>
        </li>
        <li className="panel">
          <span className="tutorial-number" aria-hidden="true">
            05
          </span>
          <div>
            <h2>Have a conversation.</h2>
            <p>
              Save your workspace. In <strong>Setup & activity</strong>, publish
              the reviewed knowledge. Return to{" "}
              <strong>Test conversation → Test with voice</strong> and start
              your demo.
            </p>
            <p>
              Allow microphone access and try the same questions aloud. Review
              any captured caller details and handoff requests afterward.
            </p>
            <Link href="/docs#voice-demo" className="text-link">
              Demo limits and details <Icon name="right" />
            </Link>
          </div>
        </li>
      </ol>
      <div className="guide-next">
        <p>Make it your company’s voice.</p>
        <Link className="button copper" href="/try-for-free">
          Build your agent <Icon name="arrow" />
        </Link>
        <Link className="text-link" href="/docs">
          Read the guide <Icon name="right" />
        </Link>
      </div>
    </div>
  );
}
