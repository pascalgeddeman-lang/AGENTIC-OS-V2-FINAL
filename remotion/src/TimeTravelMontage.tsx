import { AbsoluteFill, Sequence, Series, OffthreadVideo, staticFile, spring, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { z } from "zod";

// Montage de la machine « Time Travel » d'Agent OS : clips Grok concaténés
// + CTA VISUEL (bouton s'abonner animé) au début puis à intervalle régulier.
export const timeTravelSchema = z.object({
  files: z.array(z.string()),
  clipSeconds: z.number().default(10),
  cta: z.object({ label: z.string(), everySeconds: z.number() }).optional(),
});

export const FPS = 30;
const CTA_DURATION = 4; // secondes d'affichage du bouton

const CtaButton: React.FC<{ label: string }> = ({ label }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 10, stiffness: 160, mass: 0.6 } });
  const pulse = 1 + 0.04 * Math.sin((frame / fps) * Math.PI * 3);
  const out = interpolate(frame, [CTA_DURATION * fps - 12, CTA_DURATION * fps], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", pointerEvents: "none" }}>
      <div
        style={{
          marginBottom: 54,
          transform: `scale(${pop * pulse})`,
          opacity: out,
          background: "#ff0033",
          color: "#fff",
          fontFamily: "Arial Black, Arial, sans-serif",
          fontSize: 34,
          fontWeight: 900,
          letterSpacing: 0.5,
          padding: "16px 38px",
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

// Clip CTA SEUL (fond transparent) : rendu à part par Remotion en ProRes 4444 (avec alpha),
// puis incrusté par FFmpeg aux bons instants. Aucune vidéo source → rendu rapide, jamais figé.
export const ctaClipSchema = z.object({ label: z.string() });
export const CtaClip: React.FC<z.infer<typeof ctaClipSchema>> = ({ label }) => (
  <AbsoluteFill>
    <CtaButton label={label} />
  </AbsoluteFill>
);

export const TimeTravelMontage: React.FC<z.infer<typeof timeTravelSchema>> = ({ files, clipSeconds, cta }) => {
  const total = files.length * clipSeconds;
  // CTA à t=1s puis toutes les everySeconds (jamais dans les 4 dernières secondes)
  const ctaStarts: number[] = [];
  if (cta) {
    for (let t = 1; t < total - CTA_DURATION; t += cta.everySeconds) ctaStarts.push(t);
  }
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Series>
        {files.map((f) => (
          <Series.Sequence key={f} durationInFrames={Math.round(clipSeconds * FPS)}>
            <OffthreadVideo
              src={f.startsWith("http") ? f : staticFile(f)}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </Series.Sequence>
        ))}
      </Series>
      {cta &&
        ctaStarts.map((t) => (
          <Sequence key={t} from={Math.round(t * FPS)} durationInFrames={CTA_DURATION * FPS}>
            <CtaButton label={cta.label} />
          </Sequence>
        ))}
    </AbsoluteFill>
  );
};
