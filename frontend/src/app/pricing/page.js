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
      "Up to 10 minutes of voice demo daily",
      "Company documents and handoff setup",
      "Verified account required",
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
      "Phone connection planning",
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
          Explore for free. Plan your workspace. Estimate conversation costs.
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
            <span>Estimated conversation cost</span>
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
            "Can I try it before connecting a phone line?",
            "Yes. Try document answers and a browser voice demo before connecting a phone number.",
          ],
          [
            "Does the app replace my phone carrier?",
            "No. A connected phone service provides your number and handles telephone calls.",
          ],
          [
            "Will the agent complete bookings?",
            "A connected booking tool is required. The demo records requests without confirming appointments.",
          ],
          [
            "Can I purchase a plan here?",
            "Not yet. Paid plans are proposed; contact us to discuss your setup.",
          ],
        ].map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>
    </div>
  );
}
