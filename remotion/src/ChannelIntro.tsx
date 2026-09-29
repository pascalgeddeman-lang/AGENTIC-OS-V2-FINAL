import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";

/**
 * GÉNÉRIQUE DE CHAÎNE — 5 s, commun à TOUTES les machines.
 * Tout est prop : logo, nom, sous-titre, couleur d'accent. Une seule composition sert donc
 * Crime, Drama, Bouddhisme, Linguistique et les suivantes.
 *
 * Structure reprise du générique de référence analysé par l'Œil :
 *   0,0 → 2,0 s  le logo naît, des particules se rassemblent autour de lui
 *   2,0 → 4,3 s  le logo est stable, les particules se dissipent
 *   4,3 → 5,0 s  fondu au noir
 * Le fond est OPAQUE (contrairement au CTA) : c'est un plan à part entière, pas une incrustation.
 */
export const FPS = 30;

export const channelIntroSchema = z.object({
  logo: z.string(),
  title: z.string(),
  subtitle: z.string(),
  accent: z.string(),
  seconds: z.number(),
});

const N = 46;
/** Positions déterministes : pas de Math.random(), sinon chaque image rendue diffère. */
const PARTICLES = Array.from({ length: N }, (_, i) => {
  const a = (i * 137.508 * Math.PI) / 180;          // angle d'or → répartition régulière
  const r = 130 + ((i * 47) % 260);
  return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.62, s: 1.4 + ((i * 13) % 5) * 0.7, d: (i % 17) / 17 };
});

export const ChannelIntro: React.FC<z.infer<typeof channelIntroSchema>> = ({ logo, title, subtitle, accent, seconds }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const total = Math.round(seconds * fps);
  const t = frame / fps;

  const pop = spring({ frame, fps, config: { damping: 14, stiffness: 90, mass: 1.1 } });
  const logoScale = 0.82 + pop * 0.18;
  const logoOp = interpolate(t, [0, 0.7], [0, 1], { extrapolateRight: "clamp" });
  const halo = interpolate(t, [0, 1.6, 3.2], [0, 1, 0.55], { extrapolateRight: "clamp" });
  const textOp = interpolate(t, [0.9, 1.7], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const blackout = interpolate(frame, [total - Math.round(0.7 * fps), total], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const logoPx = Math.round(Math.min(width, height) * 0.40);

  return (
    <AbsoluteFill style={{ background: "#05060a", overflow: "hidden", fontFamily: "Georgia, 'Times New Roman', serif" }}>
      {/* nébuleuse : deux voiles lents, sans image externe */}
      <AbsoluteFill style={{
        background: `radial-gradient(60% 55% at 50% 46%, ${accent}22 0%, transparent 62%),
                     radial-gradient(75% 60% at ${30 + t * 3}% ${62 - t * 2}%, #16213e88 0%, transparent 70%),
                     radial-gradient(70% 55% at ${72 - t * 2}% ${34 + t * 2}%, #0e1a33aa 0%, transparent 68%)`,
        filter: "blur(2px)",
      }} />

      {/* particules : elles convergent vers le logo puis se dissipent */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        {PARTICLES.map((p, i) => {
          const conv = interpolate(t, [0, 1.9], [1, 0.06], { extrapolateRight: "clamp" });
          const fade = interpolate(t, [0.1 + p.d * 0.5, 1.2, 3.4, 4.3], [0, 1, 0.7, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const tw = 0.55 + 0.45 * Math.sin(t * 5 + i);
          return (
            <div key={i} style={{
              position: "absolute",
              width: p.s * 3, height: p.s * 3, borderRadius: "50%",
              background: accent, opacity: fade * tw * 0.9,
              transform: `translate(${p.x * conv}px, ${p.y * conv}px)`,
              boxShadow: `0 0 ${p.s * 7}px ${accent}`,
            }} />
          );
        })}
      </AbsoluteFill>

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        {/* ⚠ Beaucoup de logos de chaîne sont SOMBRES ; sur un générique sombre ils se noient.
            On pose donc derrière eux un disque lumineux et un anneau fin, qui les détachent du
            fond sans rien masquer. Un PNG à fond réellement transparent en profite encore plus. */}
        <div style={{ position: "relative", transform: `scale(${logoScale})`, opacity: logoOp }}>
          <div style={{
            position: "absolute", inset: -logoPx * 0.13, borderRadius: "50%",
            background: `radial-gradient(circle, ${accent}55 0%, ${accent}22 45%, transparent 72%)`,
            filter: `blur(${logoPx * 0.05}px)`, opacity: 0.55 + 0.45 * halo,
          }} />
          <div style={{
            width: logoPx, height: logoPx, borderRadius: "50%",
            border: `2px solid ${accent}bb`,
            boxShadow: `0 0 ${70 * halo}px ${22 * halo}px ${accent}55, inset 0 0 ${logoPx * 0.12}px ${accent}33`,
            display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
            position: "relative",
          }}>
            <Img src={staticFile(logo)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
        </div>

        {title ? (
          <div style={{
            marginTop: Math.round(height * 0.035), opacity: textOp, textAlign: "center",
            color: "#fff", fontSize: Math.round(height * 0.062), fontWeight: 700, letterSpacing: 2,
            textShadow: `0 0 22px ${accent}aa`,
          }}>{title}</div>
        ) : null}
        {subtitle ? (
          <div style={{
            marginTop: Math.round(height * 0.012), opacity: textOp * 0.85, textAlign: "center",
            color: "#c9cfdd", fontSize: Math.round(height * 0.026), letterSpacing: 5,
            textTransform: "uppercase", fontFamily: "Arial, Helvetica, sans-serif",
          }}>{subtitle}</div>
        ) : null}
      </AbsoluteFill>

      <AbsoluteFill style={{ background: "#000", opacity: blackout }} />
    </AbsoluteFill>
  );
};
