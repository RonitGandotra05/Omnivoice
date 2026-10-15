import Link from "next/link";
import Icon from "@/components/ui/Icon";
export default function Testing() {
  return (
    <div className="page-shell">
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE / SAFE TESTING</p>
          <h1>
            Try the <em>flow.</em>
          </h1>
          <p>
            The new playground replaces the legacy recorder. Preview a
            conversation without placing a phone call.
          </p>
        </div>
      </div>
      <section className="panel">
        <h2>A test space with clear boundaries.</h2>
        <p className="section-description">
          Hours, booking requests, feedback, fallback, and business scope are
          available as offline scripted scenarios. Evaluate actual model
          behavior with the voice platform’s agent testing tools after
          configuration.
        </p>
        <Link className="button copper" href="/try-for-free">
          Open playground <Icon name="play" />
        </Link>
      </section>
    </div>
  );
}
