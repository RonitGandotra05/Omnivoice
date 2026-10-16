import Icon from "@/components/ui/Icon";
import Waveform from "@/components/ui/Waveform";

/** An illustrative voice console, built entirely with HTML and CSS. */
export default function VoiceInstrument() {
  return (
    <div
      className="voice-visual"
      role="img"
      aria-label="Illustration of company knowledge flowing through a voice agent to a human handoff"
    >
      <div className="voice-visual-heading">
        <span>YOUR SUPPORT AGENT</span>
        <span>EXAMPLE</span>
      </div>
      <div className="voice-console" aria-hidden="true">
        <div className="voice-console-top">
          <span className="console-brand">
            <Icon name="phone" /> OMNIVOICE
          </span>
          <span>SUPPORT</span>
          <span className="console-screw" />
        </div>
        <div className="voice-console-screen">
          <div className="console-screen-label">
            <span>
              <i /> VOICE PREVIEW
            </span>
            <span>DEMO</span>
          </div>
          <div className="console-signal">
            <span className="signal-axis" />
            <Waveform active />
          </div>
          <div className="console-dialogue">
            <span>CALLER</span>
            <p>“Can you help with a return?”</p>
            <span>YOUR AGENT</span>
            <p>
              “Of course. Let’s check
              <br />
              your options.”
            </p>
          </div>
          <div className="console-source">
            <Icon name="document" />
            <span>GROUNDED IN YOUR DOCUMENTS</span>
            <Icon name="check" />
          </div>
        </div>
        <div className="voice-console-controls">
          <div className="console-vents">
            {Array.from({ length: 10 }, (_, i) => (
              <i key={i} />
            ))}
          </div>
          <span>LISTEN. UNDERSTAND. HELP.</span>
          <span className="console-dial">
            <i />
          </span>
        </div>
      </div>
      <div className="voice-signal-path" aria-hidden="true">
        {[
          ["document", "Knowledge"],
          ["phone", "Conversation"],
          ["chat", "Human handoff"],
        ].map(([icon, label]) => (
          <div key={label}>
            <Icon name={icon} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
