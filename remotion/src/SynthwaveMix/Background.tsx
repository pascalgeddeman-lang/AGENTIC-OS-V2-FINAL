import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  random,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COVER } from "./tracks";

// Fenêtre de glitch : toutes les 5 s (150 frames), une rafale courte
// dont la présence et la durée sont décidées de façon déterministe.
const WINDOW = 150;

const getGlitchIntensity = (frame: number): number => {
  const windowIndex = Math.floor(frame / WINDOW);
  const frameInWindow = frame % WINDOW;
  // ~65 % des fenêtres contiennent une rafale
  if (random(`burst-${windowIndex}`) < 0.35) {
    return 0;
  }
  const burstLength = 8 + Math.floor(random(`len-${windowIndex}`) * 10);
  if (frameInWindow > burstLength) {
    return 0;
  }
  // attaque instantanée, retombée rapide
  return interpolate(frameInWindow, [0, 1, burstLength], [0.6, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
};

const SLICES = 5;

export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const src = staticFile(COVER);

  const intensity = getGlitchIntensity(frame);

  // Lent zoom permanent pour donner vie à l'image fixe
  const slowZoom = interpolate(frame, [0, durationInFrames], [1.02, 1.1]);

  const jitterX = (random(`jx-${frame}`) - 0.5) * 14 * intensity;
  const jitterY = (random(`jy-${frame}`) - 0.5) * 8 * intensity;

  return (
    <AbsoluteFill style={{ backgroundColor: "#05030f", overflow: "hidden" }}>
      {/* Image de base */}
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          scale: String(slowZoom),
          translate: `${jitterX}px ${jitterY}px`,
        }}
      />

      {/* Aberration chromatique pendant les rafales */}
      {intensity > 0 && (
        <>
          <Img
            src={src}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: 0.55 * intensity,
              mixBlendMode: "screen",
              filter: "hue-rotate(120deg) saturate(2.5)",
              scale: String(slowZoom),
              translate: `${10 * intensity}px 0px`,
            }}
          />
          <Img
            src={src}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: 0.55 * intensity,
              mixBlendMode: "screen",
              filter: "hue-rotate(-120deg) saturate(2.5)",
              scale: String(slowZoom),
              translate: `${-10 * intensity}px 0px`,
            }}
          />
        </>
      )}

      {/* Tranches horizontales décalées (glitch slices) */}
      {intensity > 0.1 &&
        Array.from({ length: SLICES }, (_, i) => {
          const seed = `${Math.floor(frame / 2)}-${i}`;
          const top = random(`top-${seed}`) * 90;
          const sliceHeight = 2 + random(`h-${seed}`) * 7;
          const shift = (random(`x-${seed}`) - 0.5) * 90 * intensity;
          return (
            <Img
              key={i}
              src={src}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                clipPath: `inset(${top}% 0 ${100 - top - sliceHeight}% 0)`,
                scale: String(slowZoom),
                translate: `${shift}px 0px`,
              }}
            />
          );
        })}

      {/* Scanlines rétro permanentes */}
      <AbsoluteFill
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.28) 0px, rgba(0,0,0,0.28) 2px, transparent 2px, transparent 5px)",
          opacity: 0.5,
        }}
      />

      {/* Vignette */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 55%, rgba(3,0,12,0.7) 100%)",
        }}
      />

      {/* Voile sombre en bas pour asseoir la waveform */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to top, rgba(3,0,12,0.85) 0%, transparent 22%)",
        }}
      />
    </AbsoluteFill>
  );
};
