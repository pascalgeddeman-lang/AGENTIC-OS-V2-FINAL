import React from "react";
import { useWindowedAudioData, visualizeAudio } from "@remotion/media-utils";
import { interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

// 64 barres fines réparties sur toute la largeur, comme sur la référence :
// vert/teal à gauche -> bleu -> violet -> rose/rouge à droite.
const BAR_COUNT = 64;

const barColor = (i: number): string => {
  const hue = interpolate(
    i,
    [0, BAR_COUNT * 0.33, BAR_COUNT * 0.66, BAR_COUNT - 1],
    [150, 200, 265, 325],
  );
  return `hsl(${hue}, 95%, 62%)`;
};

// Échelle logarithmique : sans elle, les basses écrasent tout le spectre.
const MIN_DB = -80;
const MAX_DB = -18;

export const Waveform: React.FC<{ file: string }> = ({ file }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const { audioData, dataOffsetInSeconds } = useWindowedAudioData({
    src: staticFile(file),
    frame,
    fps,
    windowInSeconds: 30,
  });

  if (!audioData) {
    return null;
  }

  const frequencies = visualizeAudio({
    fps,
    frame,
    audioData,
    numberOfSamples: BAR_COUNT,
    optimizeFor: "speed",
    dataOffsetInSeconds,
  });

  const amplitudes = frequencies.map((value) => {
    const db = 20 * Math.log10(Math.max(value, 1e-10));
    return Math.min(1, Math.max(0, (db - MIN_DB) / (MAX_DB - MIN_DB)));
  });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "flex-end",
        gap: 14,
        padding: "0 30px 14px 30px",
        boxSizing: "border-box",
      }}
    >
      {amplitudes.map((amplitude, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: `${5 + amplitude * 95}%`,
            backgroundColor: barColor(i),
            borderRadius: 3,
            boxShadow: `0 0 12px ${barColor(i)}`,
          }}
        />
      ))}
    </div>
  );
};
