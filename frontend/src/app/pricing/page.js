"use client";
import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/ui/Icon";
const plans = [
  {
    name: "Explore",
    price: 0,
    desc: "Find your voice before connecting a line.",
    features: [
      "Unlimited local flow previews",
      "Four agent roles",
      "Draft saving & prompt export",
      "No provider credentials required",
    ],
    cta: "Start exploring",
    href: "/try-for-free",
  },
  {
    name: "Studio",
    price: 49,
    desc: "A proposed workspace plan for one business.",
    features: [
      "Dedicated company voice agent setup",
      "Business knowledge configuration",
      "Native Twilio connection workflow",
      "Provider usage billed separately",
    ],
    cta: "Discuss Studio",
    href: "/contact",
    featured: true,
  },
  {
    name: "Custom",
    price: null,
    desc: "Plan a setup around your business.",
    features: [
      "Multiple isolated business agents",
      "Custom action & handoff design",
      "Volume and retention planning",
      "Implementation scoped individually",
    ],
    cta: "Plan your workspace",
    href: "/contact",
  },
];
export default function Pricing() {
  const [minutes, setMinutes] = useState(500),
    [rate, setRate] = useState(0.12);
  return (
    <div className="page-shell pricing">
      <div className="page-kicker">
        <span>PRICING / ROOM TO GROW</span>
        <span>START SMALL. MAKE IT YOURS.</span>
      </div>
      <div className="center-heading">
        <p className="eyebrow">A CLEARER COST OF CONNECTION</p>
        <h1>
          Good conversations.
          <br />
          <em>Clear expectations.</em>
        </h1>
        <p>
          Explore for free. Plan your workspace. Keep provider usage in view.
        </p>
        <span className="pricing-disclosure">
          Proposed app plans · Paid billing is not active
        </span>
      </div>
      <section className="plans" aria-label="Proposed plans">
        {plans.map((plan) => (
          <article
            className={`plan panel ${plan.featured ? "featured" : ""}`}
            key={plan.name}
          >
            <div className="panel-heading">
              <span className="eyebrow">{plan.name.toUpperCase()}</span>
              {plan.featured && <span className="tag">FOR SMALL TEAMS</span>}
            </div>
            <div className="plan-price">
              {plan.price === null ? "Let’s talk" : `$${plan.price}`}{" "}
              {plan.price !== null && <small>/ month</small>}
            </div>
            <p>{plan.desc}</p>
            <Link
              href={plan.href}
              className={`button full ${plan.featured ? "copper" : "outline"}`}
            >
              {plan.cta}
              <Icon name="arrow" />
            </Link>
            <ul>
              {plan.features.map((f) => (
                <li key={f}>
                  <Icon name="check" />
                  {f}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
      <section className="cost-section">
        <div>
          <p className="eyebrow">THE WHOLE PICTURE</p>
          <h2>
            Plan your minutes.
            <br />
            <em>Know your budget.</em>
          </h2>
          <p className="section-description">
            Voice, model usage, and phone carrier charges depend on your setup.
            Enter your own blended rate for a planning estimate.
          </p>
          <Link href="/contact" className="text-link">
            Discuss your setup <Icon name="arrow" />
          </Link>
        </div>
        <div className="calculator panel">
          <label className="field" htmlFor="minutes">
            Monthly conversation minutes{" "}
            <strong>{minutes.toLocaleString()}</strong>
            <input
              id="minutes"
              type="range"
              min="0"
              max="10000"
              step="100"
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </label>
          <label className="field" htmlFor="rate">
            Your assumed all-in rate ($ / minute)
            <input
              id="rate"
              type="number"
              min="0"
              max="10"
              step="0.01"
              value={rate}
              onChange={(e) =>
                setRate(Math.max(0, Math.min(10, Number(e.target.value))))
              }
            />
          </label>
          <div className="estimate">
            <span>Estimated provider usage</span>
            <strong>
              $
              {(minutes * rate).toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
              <small>/ month</small>
            </strong>
          </div>
          <p className="microcopy">
            Illustrative estimate, not a quote. Default $0.12/min is a planning
            assumption, not a published provider price. App fees are separate.
          </p>
        </div>
      </section>
      <section className="faq">
        <p className="eyebrow">A FEW THINGS TO KNOW</p>
        {[
          [
            "Can I try it without an API key?",
            "Yes. The studio previews answers from your company documents without a microphone, phone number, or provider account. Live voice requires a connected workspace.",
          ],
          [
            "Does the app replace my phone carrier?",
            "OmniVoice runs your support conversations. A carrier such as Twilio provides the phone number and network. Import and assign your number through the voice platform’s native integration.",
          ],
          [
            "Will the agent complete bookings?",
            "Only after you connect a booking tool that returns a successful result. The demo shows request collection and never claims a reservation is confirmed.",
          ],
          [
            "Can I purchase a plan here?",
            "Paid billing and checkout are not connected. Studio and Custom are proposed offerings for planning. Discuss the setup before committing to provider costs.",
          ],
        ].map(([q, a]) => (
          <details key={q}>
            <summary>
              {q}
              <span>+</span>
            </summary>
            <p>{a}</p>
          </details>
        ))}
      </section>
    </div>
  );
}
