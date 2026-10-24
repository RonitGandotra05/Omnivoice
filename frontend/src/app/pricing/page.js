"use client";
import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/ui/Icon";
const linkedIn = "https://www.linkedin.com/in/ronitgandotra";
const browserRate = 0.25;
const plans = [
  {
    name: "Explore",
    price: 0,
    period: "free",
    desc: "Build your company agent and try it in your browser.",
    features: [
      "5 voice minutes per rolling 24 hours",
      "Company documents and handoff setup",
      "Verified account required",
      "Subject to shared demo capacity",
    ],
    cta: "Start exploring",
    href: "/try-for-free",
  },
  {
    name: "Developer",
    price: 10,
    period: "/ pack",
    desc: "40 browser voice minutes to test your agent.",
    features: [
      "40 minutes total per pack",
      "30-day validity from activation",
      "One account · no daily refill",
      "Browser testing · phone calls excluded",
    ],
    cta: "Request Developer",
    href: linkedIn,
  },
  {
    name: "Developer Plus",
    price: 20,
    period: "/ pack",
    desc: "80 browser voice minutes for more conversations.",
    features: [
      "80 minutes total per pack",
      "30-day validity from activation",
      "One account · no daily refill",
      "Browser testing · phone calls excluded",
    ],
    cta: "Request Developer Plus",
    href: linkedIn,
    featured: true,
  },
];
export default function Pricing() {
  const [minutes, setMinutes] = useState(500);
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
          Start with five free minutes. Choose a developer pack or plan a
          business setup.
        </p>
        <span className="pricing-disclosure">
          Proposed developer packs · Contact Ronit for availability
        </span>
      </div>
      <section className="plans" aria-label="Browser voice plans">
        {plans.map((plan) => (
          <article
            className={`plan panel ${plan.featured ? "featured" : ""}`}
            key={plan.name}
          >
            <div className="panel-heading">
              <span className="eyebrow">{plan.name.toUpperCase()}</span>
              {plan.featured && <span className="tag">MORE TESTING TIME</span>}
            </div>
            <div className="plan-price">
              {`$${plan.price}`} <small>{plan.period}</small>
            </div>
            <p>{plan.desc}</p>
            <Link
              href={plan.href}
              {...(plan.href === linkedIn
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
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
      <section
        className="pricing-business panel"
        aria-labelledby="business-heading"
      >
        <div>
          <p className="eyebrow">FOR YOUR BUSINESS</p>
          <h2 id="business-heading">
            A voice agent for <em>your company.</em>
          </h2>
          <p>
            Set up your business knowledge, caller details and human handoff
            flow. Discuss an Indian business number and phone integration for
            your team.
          </p>
          <p className="pricing-business-contact">
            Want to set it up for your business? Contact Ronit Gandotra on
            LinkedIn.
          </p>
          <a
            className="button copper"
            href={linkedIn}
            target="_blank"
            rel="noopener noreferrer"
          >
            Contact Ronit Gandotra on LinkedIn <Icon name="arrow" />
          </a>
        </div>
        <div className="pricing-business-budget">
          <span className="eyebrow">EXAMPLE MONTHLY BUDGET</span>
          <strong>
            $2,125–$2,500 <small>/ month</small>
          </strong>
          <p>7,500 shared call minutes · 125 hours</p>
          <p>Equivalent to 5 total call hours a day for 25 days a month.</p>
          <small>
            Indicative Indian phone setup budget. Final pricing depends on the
            carrier, model, simultaneous calls and implementation scope. Subject
            to provider availability and business verification. Taxes and
            one-time setup are additional; included services are confirmed in
            your quote.
          </small>
        </div>
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
            Browser voice minutes are planned at $0.25 per minute. Use the
            calculator to estimate your testing budget. Business phone calls and
            custom integrations are quoted separately.
          </p>
          <a
            href={linkedIn}
            className="text-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            Discuss your setup with Ronit <Icon name="arrow" />
          </a>
        </div>
        <div className="calculator panel">
          <label className="field" htmlFor="minutes">
            Browser testing minutes{" "}
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
          <p className="microcopy">Browser voice rate: $0.25 / minute · USD</p>
          <div className="estimate">
            <span>Estimated browser testing budget</span>
            <strong>
              $
              {(minutes * browserRate).toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
              <small> for {minutes.toLocaleString()} minutes</small>
            </strong>
          </div>
          <p className="microcopy">
            Planning estimate at the proposed browser rate. Developer packs are
            requested directly; this calculator does not purchase or activate
            minutes. Phone charges, custom setup and taxes are excluded.
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
            "Are developer minutes renewed daily?",
            "No. Developer includes 40 minutes and Developer Plus includes 80 minutes total per pack, valid for 30 days from activation. The free demo has a separate five-minute rolling 24-hour allowance, subject to capacity.",
          ],
          [
            "Are business minutes shared across the team?",
            "Yes. The example 7,500 minutes is a monthly company pool shared across users and agents. It is not 7,500 minutes for each employee. Simultaneous call capacity is agreed separately.",
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
            "Online checkout is not active. Contact Ronit Gandotra on LinkedIn to request a developer pack or a business quote. Pricing and activation are confirmed before payment.",
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
