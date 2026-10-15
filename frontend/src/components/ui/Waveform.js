export default function Waveform({ active = false }) {
  return (
    <div className={`waveform ${active ? "playing" : ""}`} aria-hidden="true">
      {Array.from({ length: 32 }, (_, i) => (
        <i
          key={i}
          style={{
            height: `${12 + Math.abs(Math.sin(i * 1.9)) * 30 + Math.sin(i * 0.3) ** 2 * 24}px`,
            animationDelay: `${i * 35}ms`,
          }}
        />
      ))}
    </div>
  );
}
