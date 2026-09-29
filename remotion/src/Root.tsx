import "./index.css";
import { Composition } from "remotion";
import { HelloWorld, myCompSchema } from "./HelloWorld";
import { Logo, myCompSchema2 } from "./HelloWorld/Logo";
import { SynthwaveMix } from "./SynthwaveMix";
import { FPS, TOTAL_DURATION } from "./SynthwaveMix/tracks";
import { TimeTravelMontage, timeTravelSchema, CtaClip, ctaClipSchema, FPS as TT_FPS } from "./TimeTravelMontage";
import { CtaTopRight, ctaTopRightSchema, FPS as LG_FPS } from "./LinguistiqueCta";
import { MusiqueCta, musiqueCtaSchema, FPS as MU_FPS } from "./MusiqueCta";
import { MusiqueMontage, musiqueMontageSchema, FPS as MM_FPS } from "./MusiqueMontage";
import { StickmanCta, stickmanCtaSchema, FPS as SK_FPS } from "./StickmanCta";
import { BouddhismeCta, bouddhismeCtaSchema, FPS as BD_FPS } from "./BouddhismeCta";
import { DramaCta, dramaCtaSchema, DRAMA_CTA_SECONDS } from "./DramaCta";
import { ChannelIntro, channelIntroSchema, FPS as CI_FPS } from "./ChannelIntro";

// Each <Composition> is an entry in the sidebar!

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TimeTravelMontage"
        component={TimeTravelMontage}
        durationInFrames={TT_FPS * 10}
        fps={TT_FPS}
        width={1280}
        height={720}
        schema={timeTravelSchema}
        defaultProps={{ files: [] as string[], clipSeconds: 10 }}
        calculateMetadata={({ props }) => ({
          durationInFrames: Math.max(1, Math.round(props.files.length * props.clipSeconds * TT_FPS)),
        })}
      />
      <Composition
        id="CtaClip"
        component={CtaClip}
        durationInFrames={TT_FPS * 4}
        fps={TT_FPS}
        width={1280}
        height={720}
        schema={ctaClipSchema}
        defaultProps={{ label: "SUBSCRIBE" }}
      />
      <Composition
        id="CtaTopRight"
        component={CtaTopRight}
        durationInFrames={LG_FPS * 4}
        fps={LG_FPS}
        width={1280}
        height={720}
        schema={ctaTopRightSchema}
        defaultProps={{ label: "SUBSCRIBE" }}
      />
      <Composition
        id="BouddhismeCta"
        component={BouddhismeCta}
        durationInFrames={BD_FPS * 5}
        fps={BD_FPS}
        width={1920}
        height={1080}
        schema={bouddhismeCtaSchema}
        defaultProps={{
          label: "S'ABONNER",
          labelDone: "ABONNÉ",
          channel: "Zen Harmonie",
          tagline: "Nouvelle vidéo chaque semaine",
          taglineDone: "Merci — on se voit semaine prochaine",
          logo: "zen-harmonie-logo.png",
        }}
      />
      {/* La machine Crime réutilise EXACTEMENT le même bloc : tout y est déjà une prop
          (logo, nom de chaîne, textes). Un id distinct sert seulement à ne pas confondre
          les deux rendus dans les logs et les dossiers de sortie. */}
      {/* Générique de chaîne — 5 s, commun à TOUTES les machines. Les dimensions sont
          passées au rendu (--width/--height) : une seule composition sert le 720p et le 1080p. */}
      <Composition
        id="ChannelIntro"
        component={ChannelIntro}
        durationInFrames={CI_FPS * 5}
        fps={CI_FPS}
        width={1920}
        height={1080}
        schema={channelIntroSchema}
        defaultProps={{
          logo: "au-creux-de-la-nuit-logo.png",
          title: "Au Creux de la Nuit",
          subtitle: "",
          accent: "#c9a227",
          seconds: 5,
        }}
      />
      <Composition
        id="CrimeCta"
        component={BouddhismeCta}
        durationInFrames={BD_FPS * 5}
        fps={BD_FPS}
        width={1920}
        height={1080}
        schema={bouddhismeCtaSchema}
        defaultProps={{
          label: "S'ABONNER",
          labelDone: "ABONNÉ",
          channel: "Au Creux de la Nuit",
          tagline: "Une nouvelle affaire chaque semaine",
          taglineDone: "Merci — à la prochaine affaire",
          logo: "au-creux-de-la-nuit-logo.png",
        }}
      />
      <Composition
        id="StickmanCta"
        component={StickmanCta}
        durationInFrames={SK_FPS * 5}
        fps={SK_FPS}
        width={1920}
        height={1080}
        schema={stickmanCtaSchema}
        defaultProps={{ label: "SUBSCRIBE", labelDone: "SUBSCRIBED", channel: "Stickman Explains" }}
      />
      <Composition
        id="MusiqueCta"
        component={MusiqueCta}
        durationInFrames={MU_FPS * 5}
        fps={MU_FPS}
        width={1280}
        height={720}
        schema={musiqueCtaSchema}
        defaultProps={{ question: "ENJOYING THIS MIX?", button: "SUBSCRIBE ▶" }}
      />
      <Composition
        id="MusiqueMontage"
        component={MusiqueMontage}
        durationInFrames={MM_FPS * 60}
        fps={MM_FPS}
        width={1280}
        height={720}
        schema={musiqueMontageSchema}
        defaultProps={{
          dir: "mus-demo",
          image: "visual.png",
          audio: "full-audio.m4a",
          durationSec: 60,
          waveform: true,
          waveColor: "gradient",
          cta: { question: "ENJOYING THIS MIX?", button: "SUBSCRIBE ▶" },
          ctaEverySec: 300,
          effects: [] as string[],
        }}
        calculateMetadata={({ props }) => ({
          durationInFrames: Math.max(1, Math.round(props.durationSec * MM_FPS)),
        })}
      />
      <Composition
        id="SynthwaveMix"
        component={SynthwaveMix}
        durationInFrames={TOTAL_DURATION}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        // You can take the "id" to render a video:
        // npx remotion render HelloWorld
        id="HelloWorld"
        component={HelloWorld}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        // You can override these props for each render:
        // https://www.remotion.dev/docs/parametrized-rendering
        schema={myCompSchema}
        defaultProps={{
          titleText: "Welcome to Remotion",
          titleColor: "#000000",
          logoColor1: "#91EAE4",
          logoColor2: "#86A8E7",
        }}
      />

      {/* Mount any React component to make it show up in the sidebar and work on it individually! */}
      <Composition
        id="DramaCta"
        component={DramaCta}
        durationInFrames={DRAMA_CTA_SECONDS * 30}
        fps={30}
        width={720}
        height={140}
        schema={dramaCtaSchema}
        defaultProps={{
          channel: "Africa Drama TV",
          label: "ABONNE-TOI",
          tagline: "Like + Abonnement",
          logo: "africa-drama-logo.png",
        }}
      />
      <Composition
        id="OnlyLogo"
        component={Logo}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        schema={myCompSchema2}
        defaultProps={{
          logoColor1: "#91dAE2" as const,
          logoColor2: "#86A8E7" as const,
        }}
      />
    </>
  );
};
