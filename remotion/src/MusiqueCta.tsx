import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { z } from "zod";

// CTA néon de la machine MUSIQUE — reproduit le style des vidéos cyberpunk de la formation :
// boîte sombre translucide, bordure néon rose/violet qui pulse, cloche, question + bouton rouge.
// Rendu SEUL (fond transparent) en séquence PNG, incrusté par FFmpeg en bas-droite.
export const FPS = 30;
const CTA_DURATION = 5; // secondes d'affichage

export const musiqueCtaSchema = z.object({ question: z.string(), button: z.string() });

const NeonBox: React.FC<{ question: string; button: string }> = ({ question, button }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 11, stiffness: 150, mass: 0.7 } });
  const glow = 0.55 + 0.45 * Math.sin((frame / fps) * Math.PI * 2.2); // pulsation néon
  const bell = Math.sin((frame / fps) * Math.PI * 6) * (frame < fps * 1.5 ? 14 : 3); // cloche qui sonne
  const out = interpolate(frame, [CTA_DURATION * fps - 14, CTA_DURATION * fps], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    // Boîte calée BAS-DROITE (au-dessus de la waveform), comme le SubscribeCTA de la leçon SynthwaveMix
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-end", pointerEvents: "none" }}>
      <div
        style={{
          marginRight: 70,
          marginBottom: 160,
          transform: `scale(${pop})`,
          transformOrigin: "bottom right",
          opacity: out,
          display: "flex",
          alignItems: "center",
          gap: 22,
          background: "rgba(8, 4, 26, 0.82)",
          borderRadius: 20,
          padding: "22px 32px",
          border: "2px solid #ff2bd6",
          boxShadow: `0 0 ${18 + 22 * glow}px rgba(255,43,214,${0.4 + 0.35 * glow}), 0 0 ${40 + 34 * glow}px rgba(0,229,255,${0.18 + 0.18 * glow})`,
        }}
      >
        <div style={{ fontSize: 44, transform: `rotate(${bell}deg)`, transformOrigin: "top center" }}>🔔</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              color: "#fff",
              fontFamily: "Arial Black, Arial, sans-serif",
              fontWeight: 900,
              fontSize: 26,
              letterSpacing: 3,
              textShadow: "0 0 14px #00e5ff",
              whiteSpace: "nowrap",
            }}
          >
            {question}
          </div>
          <div
            style={{
              alignSelf: "flex-start",
              background: "#ff0033",
              color: "#fff",
              fontFamily: "Arial Black, Arial, sans-serif",
              fontWeight: 900,
              fontSize: 24,
              letterSpacing: 3,
              padding: "10px 26px",
              borderRadius: 10,
              boxShadow: `0 0 ${10 + 14 * glow}px rgba(255,0,51,.8)`,
              whiteSpace: "nowrap",
            }}
          >
            {button}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const MusiqueCta: React.FC<z.infer<typeof musiqueCtaSchema>> = ({ question, button }) => (
  <AbsoluteFill>
    <NeonBox question={question} button={button} />
  </AbsoluteFill>
);
