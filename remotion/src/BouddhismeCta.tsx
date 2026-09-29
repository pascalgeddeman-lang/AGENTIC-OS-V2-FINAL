import { AbsoluteFill, Img, spring, staticFile, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { z } from "zod";

// CTA « s'abonner » de la machine Bouddhisme — même bloc YouTube que les autres machines
// (avatar de chaîne, nom, bouton rouge + cloche, curseur qui vient cliquer), mais :
//   - l'avatar est le VRAI logo de la chaîne (fichier de remotion/public/)
//   - tous les textes sont des PROPS, donc traduisibles : la niche exige un CTA dans la
//     langue de la vidéo (ceux de StickmanCta étaient codés en dur en anglais).
// Rendu SEUL sur fond transparent en séquence PNG, incrusté ensuite par FFmpeg.
export const FPS = 30;
const CTA_DURATION = 5;

export const bouddhismeCtaSchema = z.object({
  label: z.string(),
  labelDone: z.string(),
  channel: z.string(),
  tagline: z.string(),
  taglineDone: z.string(),
  logo: z.string(),
});

const Bell: React.FC<{ size: number; swing: number; color: string }> = ({ size, swing, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ transform: `rotate(${swing}deg)`, transformOrigin: "50% 15%" }}>
    <path
      d="M12 3a1.6 1.6 0 0 1 1.6 1.6v.6a5.6 5.6 0 0 1 4 5.35V15l1.5 2.2v1.05H4.9V17.2L6.4 15v-4.45a5.6 5.6 0 0 1 4-5.35v-.6A1.6 1.6 0 0 1 12 3Z"
      fill={color}
    />
    <path d="M9.8 19.9h4.4a2.2 2.2 0 0 1-4.4 0Z" fill={color} />
  </svg>
);

const Cursor: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <path d="M4 2.5 4 19.2 8.1 15.4 10.9 21.5 13.9 20.1 11.1 14.1 16.6 13.9Z" fill="#111" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

const CtaBlock: React.FC<z.infer<typeof bouddhismeCtaSchema>> = ({ label, labelDone, channel, tagline, taglineDone, logo }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const total = CTA_DURATION * fps;

  const pop = spring({ frame, fps, config: { damping: 12, stiffness: 150, mass: 0.7 } });
  const out = interpolate(frame, [total - 14, total], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const CLICK = Math.round(2.0 * fps);
  const cx = interpolate(frame, [Math.round(0.55 * fps), CLICK], [230, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const cy = interpolate(frame, [Math.round(0.55 * fps), CLICK], [190, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const cursorOut = interpolate(frame, [CLICK + 16, CLICK + 34], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const clicked = frame >= CLICK;
  const press = frame >= CLICK - 2 && frame < CLICK + 4 ? 0.94 : 1;
  const pulse = clicked ? 1 : 1 + 0.035 * Math.sin((frame / fps) * Math.PI * 3.4);
  const swing = clicked && frame < CLICK + 26 ? 16 * Math.sin((frame - CLICK) / 1.7) * (1 - (frame - CLICK) / 26) : 0;

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", pointerEvents: "none" }}>
      <div
        style={{
          marginBottom: 196,
          transform: `scale(${pop})`,
          opacity: out,
          display: "flex",
          alignItems: "center",
          gap: 26,
          background: "rgba(16,16,18,.88)",
          border: "2px solid rgba(255,255,255,.14)",
          borderRadius: 26,
          padding: "22px 30px",
          boxShadow: "0 18px 60px rgba(0,0,0,.55)",
          fontFamily: "Arial, Helvetica, sans-serif",
          position: "relative",
        }}
      >
        <div
          style={{
            width: 84, height: 84, borderRadius: "50%",
            border: "3px solid rgba(255,255,255,.9)", flexShrink: 0, overflow: "hidden",
            display: "flex", alignItems: "center", justifyContent: "center", background: "#000",
          }}
        >
          <Img src={staticFile(logo)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginRight: 6 }}>
          <div style={{ color: "#fff", fontSize: 34, fontWeight: 800, letterSpacing: 0.2, whiteSpace: "nowrap" }}>{channel}</div>
          <div style={{ color: "#A6A6AC", fontSize: 21, fontWeight: 500, whiteSpace: "nowrap" }}>
            {clicked ? taglineDone : tagline}
          </div>
        </div>

        <div
          style={{
            transform: `scale(${press * pulse})`,
            background: clicked ? "#2A2A2E" : "#FF0033",
            color: clicked ? "#C9C9CF" : "#fff",
            fontSize: 28, fontWeight: 900, letterSpacing: 1.1,
            padding: "17px 32px", borderRadius: 999, whiteSpace: "nowrap",
            boxShadow: clicked ? "none" : "0 0 34px rgba(255,0,51,.55)",
          }}
        >
          {clicked ? labelDone : label}
        </div>

        <div style={{ display: "flex", alignItems: "center", marginLeft: -6 }}>
          <Bell size={40} swing={swing} color={clicked ? "#fff" : "#8A8A90"} />
        </div>

        <div style={{ position: "absolute", right: 92, bottom: 6, transform: `translate(${cx}px, ${cy}px)`, opacity: cursorOut }}>
          <Cursor size={46} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const BouddhismeCta: React.FC<z.infer<typeof bouddhismeCtaSchema>> = (p) => (
  <AbsoluteFill>{/* aucun background => alpha préservé */}
    <CtaBlock {...p} />
  </AbsoluteFill>
);
