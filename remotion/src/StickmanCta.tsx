import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { z } from "zod";

// CTA « s'abonner » de la machine Stickman — vrai bloc YouTube (avatar de chaîne, nom,
// bouton rouge SUBSCRIBE + cloche) avec un curseur qui vient cliquer : le bouton bascule
// alors en « SUBSCRIBED » gris et la cloche sonne.
// Rendu SEUL sur fond transparent en séquence PNG, puis incrusté par FFmpeg (même chaîne
// que CtaClip / CtaTopRight des autres machines).
export const FPS = 30;
const CTA_DURATION = 5; // secondes

export const stickmanCtaSchema = z.object({
  label: z.string(),
  labelDone: z.string(),
  channel: z.string(),
});

// Tête de stickman dessinée en SVG : sert d'avatar de chaîne, cohérent avec la vidéo.
const StickHead: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="46" fill="#F5F1E6" stroke="#141414" strokeWidth="7" />
    <circle cx="36" cy="44" r="5.5" fill="#141414" />
    <circle cx="64" cy="44" r="5.5" fill="#141414" />
    <rect x="38" y="66" width="24" height="4.5" rx="2.2" fill="#141414" />
  </svg>
);

const Bell: React.FC<{ size: number; swing: number; color: string }> = ({ size, swing, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ transform: `rotate(${swing}deg)`, transformOrigin: "50% 15%" }}>
    <path
      d="M12 3a1.6 1.6 0 0 1 1.6 1.6v.6a5.6 5.6 0 0 1 4 5.35V15l1.5 2.2v1.05H4.9V17.2L6.4 15v-4.45a5.6 5.6 0 0 1 4-5.35v-.6A1.6 1.6 0 0 1 12 3Z"
      fill={color}
    />
    <path d="M9.8 19.9h4.4a2.2 2.2 0 0 1-4.4 0Z" fill={color} />
  </svg>
);

// Curseur souris (flèche pleine + contour blanc), comme sur une capture d'écran.
const Cursor: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <path d="M4 2.5 4 19.2 8.1 15.4 10.9 21.5 13.9 20.1 11.1 14.1 16.6 13.9Z" fill="#111" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

const CtaBlock: React.FC<z.infer<typeof stickmanCtaSchema>> = ({ label, labelDone, channel }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const total = CTA_DURATION * fps;

  const pop = spring({ frame, fps, config: { damping: 12, stiffness: 150, mass: 0.7 } });
  const out = interpolate(frame, [total - 14, total], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Le curseur entre par le bas-droite, clique à 2 s, puis ressort.
  const CLICK = Math.round(2.0 * fps);
  const cx = interpolate(frame, [Math.round(0.55 * fps), CLICK], [230, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const cy = interpolate(frame, [Math.round(0.55 * fps), CLICK], [190, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const cursorOut = interpolate(frame, [CLICK + 16, CLICK + 34], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const clicked = frame >= CLICK;
  // Enfoncement du bouton sur 4 frames au moment du clic
  const press = frame >= CLICK - 2 && frame < CLICK + 4 ? 0.94 : 1;
  // Pulsation d'appel avant le clic uniquement
  const pulse = clicked ? 1 : 1 + 0.035 * Math.sin((frame / fps) * Math.PI * 3.4);
  // La cloche sonne juste après le clic
  const swing = clicked && frame < CLICK + 26 ? 16 * Math.sin((frame - CLICK) / 1.7) * (1 - (frame - CLICK) / 26) : 0;

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", pointerEvents: "none" }}>
      <div
        style={{
          marginBottom: 164,
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
        {/* Avatar de chaîne */}
        <div
          style={{
            width: 84, height: 84, borderRadius: "50%", background: "#6E86A8",
            display: "flex", alignItems: "center", justifyContent: "center",
            border: "3px solid rgba(255,255,255,.9)", flexShrink: 0, overflow: "hidden",
          }}
        >
          <StickHead size={70} />
        </div>

        {/* Nom de chaîne + accroche */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginRight: 6 }}>
          <div style={{ color: "#fff", fontSize: 34, fontWeight: 800, letterSpacing: 0.2, whiteSpace: "nowrap" }}>{channel}</div>
          <div style={{ color: "#A6A6AC", fontSize: 21, fontWeight: 500, whiteSpace: "nowrap" }}>
            {clicked ? "Thanks — see you next week" : "New video every week"}
          </div>
        </div>

        {/* Bouton d'abonnement */}
        <div
          style={{
            transform: `scale(${press * pulse})`,
            background: clicked ? "#2A2A2E" : "#FF0033",
            color: clicked ? "#C9C9CF" : "#fff",
            fontSize: 28,
            fontWeight: 900,
            letterSpacing: 1.1,
            padding: "17px 32px",
            borderRadius: 999,
            whiteSpace: "nowrap",
            boxShadow: clicked ? "none" : "0 0 34px rgba(255,0,51,.55)",
          }}
        >
          {clicked ? labelDone : label}
        </div>

        {/* Cloche de notification */}
        <div style={{ display: "flex", alignItems: "center", marginLeft: -6 }}>
          <Bell size={40} swing={swing} color={clicked ? "#fff" : "#8A8A90"} />
        </div>

        {/* Curseur : positionné sur le bouton, il arrive de l'extérieur du cadre */}
        <div style={{ position: "absolute", right: 92, bottom: 6, transform: `translate(${cx}px, ${cy}px)`, opacity: cursorOut }}>
          <Cursor size={46} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const StickmanCta: React.FC<z.infer<typeof stickmanCtaSchema>> = (p) => (
  <AbsoluteFill>{/* AUCUN background => alpha préservé dans la séquence PNG */}
    <CtaBlock {...p} />
  </AbsoluteFill>
);
