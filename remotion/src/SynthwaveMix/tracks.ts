// Ce fichier est régénéré automatiquement par le script d'assemblage
// (scratchpad/assemble_tracks.py) à partir des MP3 présents dans public/.
// Ne pas éditer à la main : durées mesurées via ffprobe.

export type Track = {
  file: string;
  title: string;
  durationInFrames: number;
};

export const FPS = 30;

export const COVER = "cover.png";

export const TRACKS: Track[] = [
  { file: "track1.mp3", title: "1994 NEON PROTOCOL", durationInFrames: 14382 },
  { file: "track2.mp3", title: "1994 NEON PROTOCOL", durationInFrames: 7165 },
  { file: "track3.mp3", title: "1988 MEMORY DRIFT", durationInFrames: 4742 },
  { file: "track4.mp3", title: "1988 MEMORY DRIFT", durationInFrames: 2417 },
  { file: "track5.mp3", title: "2077 GHOST SIGNAL", durationInFrames: 14382 },
  { file: "track6.mp3", title: "2077 GHOST SIGNAL", durationInFrames: 14382 },
];

export const TOTAL_DURATION = TRACKS.reduce(
  (sum, t) => sum + t.durationInFrames,
  0,
);
