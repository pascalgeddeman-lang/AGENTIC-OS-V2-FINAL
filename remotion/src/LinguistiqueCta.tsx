import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { z } from "zod";

// CTA « s'abonner » de la machine Linguistique — bouton animé positionné EN HAUT À DROITE.
// Rendu SEUL (fond transparent) en séquence PNG par Remotion, puis incrusté par FFmpeg
// (comme le CtaClip de Time Travel, mais coin haut-droit au lieu du bas-centre).
export const FPS = 30;
const CTA_DURATION = 4; // secondes d'affichage

export const ctaTopRightSchema = z.object({ label: z.string() });

const CtaButtonTR: React.FC<{ label: string }> = ({ label }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 10, stiffness: 160, mass: 0.6 } });
  const pulse = 1 + 0.04 * Math.sin((frame / fps) * Math.PI * 3);
  const out = interpolate(frame, [CTA_DURATION * fps - 12, CTA_DURATION * fps], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "flex-end", pointerEvents: "none" }}>
      <div
        style={{
          marginTop: 40,
          marginRight: 48,
          transform: `scale(${pop * pulse})`,
          transformOrigin: "top right",
          opacity: out,
          background: "#ff0033",
          color: "#fff",
          fontFamily: "Arial Black, Arial, sans-serif",
          fontSize: 32,
          fontWeight: 900,
          letterSpacing: 0.5,
          padding: "14px 34px",
          borderRadius: 999,
          boxShadow: "0 8px 40px rgba(255,0,51,.55), 0 2px 8px rgba(0,0,0,.5)",
          border: "3px solid rgba(255,255,255,.9)",
        }}
      >
        {label}
      </div>
    </AbsoluteFill>
  );
};

export const CtaTopRight: React.FC<z.infer<typeof ctaTopRightSchema>> = ({ label }) => (
  <AbsoluteFill>
    <CtaButtonTR label={label} />
  </AbsoluteFill>
);
