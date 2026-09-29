import React from "react";
import { AbsoluteFill, Sequence, staticFile } from "remotion";
import { Audio } from "@remotion/media";
import { Background } from "./Background";
import { Waveform } from "./Waveform";
import { SubscribeCTA } from "./SubscribeCTA";
import { TRACKS, TOTAL_DURATION } from "./tracks";

// CTA abonnement : toutes les 2 minutes (3600 frames à 30 fps), 8 s chacun.
const CTA_INTERVAL = 3600;
const CTA_DURATION = 240;
const CTA_FIRST = 1200;

const getCtaStarts = (): number[] => {
  const starts: number[] = [];
  for (
    let from = CTA_FIRST;
    from + CTA_DURATION < TOTAL_DURATION - 300;
    from += CTA_INTERVAL
  ) {
    starts.push(from);
  }
  return starts;
};

export const SynthwaveMix: React.FC = () => {
  let cursor = 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "#05030f" }}>
      <Sequence name="Background">
        <Background />
      </Sequence>

      {TRACKS.map((track) => {
        const from = cursor;
        cursor += track.durationInFrames;
        return (
          <Sequence
            key={track.file}
            name={`Track — ${track.title}`}
            from={from}
            durationInFrames={track.durationInFrames}
          >
            <Audio src={staticFile(track.file)} />
            <AbsoluteFill style={{ justifyContent: "flex-end" }}>
              {/* Waveform : ~15 % de la hauteur, toute la largeur */}
              <div style={{ height: "15%", width: "100%" }}>
                <Waveform file={track.file} />
              </div>
            </AbsoluteFill>
          </Sequence>
        );
      })}

      {getCtaStarts().map((from) => (
        <Sequence
          key={from}
          name="CTA Abonnement"
          from={from}
          durationInFrames={CTA_DURATION}
        >
          <SubscribeCTA />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
