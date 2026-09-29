import { AbsoluteFill, Img, spring, staticFile, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { z } from "zod";

/**
 * CTA de la machine DRAMA — bandeau « like + abonnement » avec le VRAI logo de la chaîne.
 * Rendu SEUL sur fond transparent en séquence PNG : FFmpeg l'incruste ensuite aux bons instants.
 * (Remotion se fige s'il doit re-rendre une vidéo longue — il ne rend donc jamais que ce bloc.)
 *
 * Le logo Africa Drama TV est sur fond noir : on l'affiche dans une pastille ronde sombre,
 * ce qui l'assume au lieu de laisser un carré noir flotter sur l'image.
 */
export const FPS = 30;
export const DRAMA_CTA_SECONDS = 5;

export const dramaCtaSchema = z.object({
  channel: z.string(),
  label: z.string(),
  tagline: z.string(),
  logo: z.string(),
});

const Thumb: React.FC<{ size: number; fill: string }> = ({ size, fill }) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <path d="M2 10.5h3.4V21H2zM7.4 10.2 12.1 3c1.5 0 2.4 1 2.2 2.4l-.6 3.5h5.6c1.3 0 2.2 1.2 1.9 2.4l-1.8 7.3c-.2 1-1.1 1.7-2.1 1.7H7.4z" fill={fill} />
  </svg>
);

const Bell: React.FC<{ size: number; swing: number }> = ({ size, swing }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ transform: `rotate(${swing}deg)`, transformOrigin: "50% 15%" }}>
    <path d="M12 3a1.6 1.6 0 0 1 1.6 1.6v.6a5.6 5.6 0 0 1 4 5.35V15l1.5 2.2v1.05H4.9V17.2L6.4 15v-4.45a5.6 5.6 0 0 1 4-5.35v-.6A1.6 1.6 0 0 1 12 3Z" fill="#fff" />
    <path d="M9.8 19.9h4.4a2.2 2.2 0 0 1-4.4 0Z" fill="#fff" />
  </svg>
);

export const DramaCta: React.FC<z.infer<typeof dramaCtaSchema>> = ({ channel, label, tagline, logo }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 200, mass: 0.6 } });
  const exit = interpolate(frame, [durationInFrames - 14, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const x = interpolate(enter, [0, 1], [80, 0]);
  const opacity = enter * exit;

  // Le pouce se lève puis la cloche sonne : deux micro-animations décalées, sans surcharge.
  const thumbPop = spring({ frame: frame - fps * 0.9, fps, config: { damping: 12, mass: 0.5 } });
  const swing = Math.sin((frame - fps * 1.8) / 2.4) * (frame > fps * 1.8 && frame < fps * 3 ? 14 : 0);

  return (
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      <div
        style={{
          position: "absolute", top: 0, left: 0,
          transform: `translateX(${x}px)`, opacity,
          display: "flex", alignItems: "center", gap: 16,
          padding: "14px 26px 14px 14px",
          borderRadius: 999,
          background: "linear-gradient(135deg, rgba(14,11,6,.96), rgba(38,28,10,.96))",
          border: "2px solid #D4A22A",
          boxShadow: "0 10px 34px rgba(0,0,0,.55)",
          fontFamily: "Inter, Helvetica, Arial, sans-serif",
        }}
      >
        <div style={{ width: 74, height: 74, borderRadius: "50%", overflow: "hidden", flex: "none",
                      border: "2px solid #D4A22A", background: "#0b0b0b" }}>
          <Img src={staticFile(logo)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <div style={{ color: "#fff", fontSize: 25, fontWeight: 800, letterSpacing: -0.3, whiteSpace: "nowrap" }}>{channel}</div>
          <div style={{ color: "#E8C46A", fontSize: 17, fontWeight: 600, whiteSpace: "nowrap" }}>{tagline}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: 6 }}>
          <div style={{ transform: `scale(${0.9 + thumbPop * 0.35})`, display: "flex" }}>
            <Thumb size={34} fill="#E8C46A" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, background: "#C1121F",
                        padding: "11px 20px", borderRadius: 999 }}>
            <span style={{ color: "#fff", fontSize: 21, fontWeight: 900, letterSpacing: 0.4, whiteSpace: "nowrap" }}>{label}</span>
            <Bell size={23} swing={swing} />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
