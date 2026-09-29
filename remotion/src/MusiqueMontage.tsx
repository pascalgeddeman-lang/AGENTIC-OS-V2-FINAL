import React, { useEffect, useState } from "react";
// Audio CLASSIQUE de remotion (pas @remotion/media) : sur un WAV de 39 min, le décodage navigateur
// par fenêtres de @remotion/media gelait le rendu vers 30 s ; l'Audio cœur mixe côté encodeur.
import { AbsoluteFill, Audio, Img, Sequence, continueRender, delayRender, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { MusiqueCta } from "./MusiqueCta";

// MONTAGE COMPLET de la machine Musique — même recette que la leçon SynthwaveMix :
// image de fond + waveform audio-réactive (64 barres) + CTA néon périodique + effets.
// Rendu directement en MP4 par Remotion (une image fixe + audio : pas d'OffthreadVideo, pas de gel).
// Les fichiers (visual.png, full-audio.m4a) sont copiés dans remotion/public/<dir>/ par la machine.
export const FPS = 30;

export const musiqueMontageSchema = z.object({
  dir: z.string(),
  image: z.string(),
  audio: z.string(),
  waveData: z.string().optional(), // JSON précalculé {fps, bars, frames, data(base64)}
  durationSec: z.number(),
  waveform: z.boolean(),
  waveColor: z.string(), // "gradient" ou une couleur hex (#RRGGBB)
  cta: z.object({ question: z.string(), button: z.string() }).nullable(),
  ctaEverySec: z.number(),
  effects: z.array(z.string()),
});
type Props = z.infer<typeof musiqueMontageSchema>;

// ---- Waveform (look de la leçon, données PRÉCALCULÉES côté Node) ----
// useWindowedAudioData bloquait le rendu au changement de fenêtre → les 64 bandes par frame sont
// calculées offline (FFT) et lues ici depuis un JSON statique. Zéro décodage audio dans Chrome.
const BAR_COUNT = 64;

const barColor = (i: number, waveColor: string): string => {
  if (waveColor && waveColor !== "gradient") return waveColor;
  const hue = interpolate(i, [0, BAR_COUNT * 0.33, BAR_COUNT * 0.66, BAR_COUNT - 1], [150, 200, 265, 325]);
  return `hsl(${hue}, 95%, 62%)`;
};

type WaveData = { bars: number; frames: number; bytes: Uint8Array };

const WaveformBars: React.FC<{ dataFile: string; waveColor: string }> = ({ dataFile, waveColor }) => {
  const frame = useCurrentFrame();
  const [handle] = useState(() => delayRender("waveform-data"));
  const [wf, setWf] = useState<WaveData | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(staticFile(dataFile))
      .then((r) => r.json())
      .then((j) => {
        const bin = atob(j.data as string);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        if (alive) setWf({ bars: j.bars, frames: j.frames, bytes });
        continueRender(handle);
      })
      .catch(() => continueRender(handle));
    return () => {
      alive = false;
    };
  }, [dataFile, handle]);
  if (!wf) return null;
  const idx = Math.max(0, Math.min(wf.frames - 1, frame));
  const amplitudes = Array.from({ length: BAR_COUNT }, (_, i) => (wf.bytes[idx * wf.bars + (i % wf.bars)] || 0) / 255);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "flex-end",
        gap: 10,
        padding: "0 24px 12px 24px",
        boxSizing: "border-box",
      }}
    >
      {amplitudes.map((amplitude, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: `${5 + amplitude * 95}%`,
            backgroundColor: barColor(i, waveColor),
            borderRadius: 3,
            boxShadow: `0 0 12px ${barColor(i, waveColor)}`,
          }}
        />
      ))}
    </div>
  );
};

// ---- Fond : image tenue + zoom lent optionnel + glitch optionnel ----
const BackgroundImage: React.FC<{ src: string; kenburns: boolean; glitch: boolean }> = ({ src, kenburns, glitch }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const scale = kenburns ? interpolate(frame, [0, durationInFrames], [1, 1.15]) : 1;
  // Glitch « bug » : toutes les ~12 s, 0,3 s de secousse déterministe (translate + teinte)
  const t = frame / fps;
  const inGlitch = glitch && t % 12 < 0.3;
  const j = inGlitch ? Math.sin(frame * 12.9898) * 10 : 0;
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#05030f" }}>
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale}) translateX(${j}px)`,
          filter: inGlitch ? `hue-rotate(${j * 9}deg) saturate(1.6)` : undefined,
        }}
      />
      {inGlitch ? (
        <AbsoluteFill style={{ background: "rgba(255,0,80,0.06)", mixBlendMode: "screen" }} />
      ) : null}
    </AbsoluteFill>
  );
};

export const MusiqueMontage: React.FC<Props> = ({ dir, image, audio, waveData, durationSec, waveform, waveColor, cta, ctaEverySec, effects }) => {
  const totalFrames = Math.max(1, Math.round(durationSec * FPS));
  const audioFile = `${dir}/${audio}`;
  // Premier CTA DÈS LE DÉBUT (1 s, le temps du pop-in), puis toutes les ctaEverySec.
  const ctaStarts: number[] = [];
  if (cta) {
    for (let from = 1 * FPS; from + 5 * FPS < totalFrames - 5 * FPS; from += Math.max(60, ctaEverySec) * FPS) ctaStarts.push(from);
  }
  return (
    <AbsoluteFill style={{ backgroundColor: "#05030f" }}>
      <BackgroundImage
        src={staticFile(`${dir}/${image}`)}
        kenburns={effects.includes("kenburns")}
        glitch={effects.includes("glitch")}
      />
      <Audio src={staticFile(audioFile)} />
      {waveform && waveData ? (
        <AbsoluteFill style={{ justifyContent: "flex-end" }}>
          <div style={{ height: "15%", width: "100%" }}>
            <WaveformBars dataFile={`${dir}/${waveData}`} waveColor={waveColor} />
          </div>
        </AbsoluteFill>
      ) : null}
      {cta
        ? ctaStarts.map((from) => (
            <Sequence key={from} name="CTA néon" from={from} durationInFrames={5 * FPS}>
              <MusiqueCta question={cta.question} button={cta.button} />
            </Sequence>
          ))
        : null}
    </AbsoluteFill>
  );
};
