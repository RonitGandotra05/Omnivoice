import MfaSettings from "@/components/MfaSettings";
import Link from "next/link";
export default function OperatorSecurity() {
  return (
    <div className="page-shell settings-page">
      <header className="settings-heading">
        <div>
          <p className="eyebrow">OPERATOR ACCOUNT</p>
          <h1>
            Protect your <em>workspace.</em>
          </h1>
        </div>
        <Link className="button outline" href="/admin/dashboard">
          Back to dashboard
        </Link>
      </header>
      <div className="security-panel-wrap">
        <MfaSettings operator />
      </div>
    </div>
  );
}
