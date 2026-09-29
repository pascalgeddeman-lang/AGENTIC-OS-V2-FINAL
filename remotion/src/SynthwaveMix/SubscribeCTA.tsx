import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

// Pop-up d'incitation à l'abonnement : pop-in avec rebond, cloche qui
// s'agite, fade-out en fin de séquence. Monté périodiquement via <Sequence>.
export const SubscribeCTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const bellWiggle =
    frame > 12 && frame < 70 ? Math.sin(frame * 0.55) * 14 : 0;

  return (
    <div
      style={{
        position: "absolute",
        right: 70,
        bottom: "19%",
        display: "flex",
        alignItems: "center",
        gap: 26,
        padding: "26px 40px",
        borderRadius: 20,
        backgroundColor: "rgba(8, 4, 26, 0.82)",
        border: "2px solid #ff2bd6",
        boxShadow: "0 0 28px rgba(255, 43, 214, 0.55), 0 0 60px rgba(0, 229, 255, 0.25)",
        fontFamily: "'Arial Black', 'Segoe UI', sans-serif",
        scale: String(
          interpolate(
            frame,
            [0, 18, durationInFrames - 20, durationInFrames],
            [0, 1, 1, 0.8],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.34, 1.56, 0.64, 1),
            },
          ),
        ),
        opacity: interpolate(
          frame,
          [0, 10, durationInFrames - 20, durationInFrames],
          [0, 1, 1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        ),
      }}
    >
      <div
        style={{
          fontSize: 54,
          rotate: `${bellWiggle}deg`,
        }}
      >
        🔔
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div
          style={{
            color: "#ffffff",
            fontSize: 34,
            letterSpacing: 2,
            textShadow: "0 0 14px #00e5ff",
          }}
        >
          TU AIMES CE MIX ?
        </div>
        <div
          style={{
            alignSelf: "flex-start",
            padding: "10px 26px",
            borderRadius: 10,
            backgroundColor: "#ff0033",
            color: "#ffffff",
            fontSize: 30,
            letterSpacing: 3,
            boxShadow: "0 0 18px rgba(255, 0, 51, 0.8)",
          }}
        >
          ABONNE-TOI ▶
        </div>
      </div>
    </div>
  );
};
