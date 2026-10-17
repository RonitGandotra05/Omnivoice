"use client";
import { useEffect, useRef } from "react";

export default function VoiceOrb({ conversation, state, children }) {
  const surface = useRef(null);
  const controls = useRef(conversation);
  useEffect(() => {
    controls.current = conversation;
  }, [conversation]);
  useEffect(() => {
    if (state !== "speaking" && state !== "listening") return;
    const element = surface.current;
    let frame,
      smoothed = 0,
      previous = 0;
    const animate = (time) => {
      if (time - previous >= 32) {
        previous = time;
        let level = 0;
        try {
          level =
            state === "speaking"
              ? controls.current.getOutputVolume()
              : controls.current.getInputVolume();
        } catch {
          /* Media may disconnect between frames. */
        }
        smoothed +=
          (Math.min(1, Math.max(0, Number(level) || 0)) - smoothed) * 0.3;
        element?.style.setProperty("--voice-energy", String(smoothed));
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame);
      element?.style.setProperty("--voice-energy", "0");
    };
  }, [state]);
  return (
    <div className="voice-orb" data-state={state} ref={surface}>
      <div className="voice-orb-fluid" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="voice-orb-control">{children}</div>
    </div>
  );
}
