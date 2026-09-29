---
name: clip-montage-cta
description: "Montage rapide et fiable de N clips vidéo déjà rendus en une vidéo finale, avec bouton Call-To-Action (s'abonner) animé incrusté à intervalles. Approche hybride Remotion (bouton animé) + FFmpeg (concaténation + incrustation). Inclut la régénération de miniature YouTube avec observations et l'écran de packaging (titre/description/tags copiables). À utiliser dès qu'on assemble des clips en une vidéo longue avec CTA visuels."
---

# Clip Montage + CTA (Remotion × FFmpeg)

## Quand l'utiliser

Assembler N clips vidéo **déjà rendus** (ex. sorties d'un modèle i2v comme Grok/Seedance) en UNE vidéo finale, avec un **bouton d'abonnement animé** incrusté au début puis à intervalle régulier. Convient aux vidéos longues (dizaines de clips, plusieurs minutes) là où un rendu 100 % Remotion échouerait.

## Le principe (et POURQUOI)

**Ne JAMAIS re-rendre une vidéo longue frame par frame avec Remotion.** Remotion compose chaque frame dans un Chromium headless ; avec `OffthreadVideo` sur de nombreuses sources vidéo (ex. 60 clips = 18000 frames), le rendu **se fige** sur Windows (0 % CPU, jamais terminé). Vérifié en production.

**Approche hybride qui marche :**
1. **FFmpeg** concatène les clips déjà rendus → base (rapide : ~1,5 min pour 600 s de vidéo, fiable). C'est son métier.
2. **Remotion** rend UNIQUEMENT le bouton CTA animé, en clip court transparent — **aucune vidéo source** → rendu en quelques secondes, jamais figé.
3. **FFmpeg** incruste le CTA aux bons instants (overlay + fondu, la vidéo reste visible autour du bouton).

## Piège critique n°1 : Remotion écrase l'alpha à l'encodage vidéo

Rendre le CTA transparent en **vidéo** (`--codec=prores --prores-profile=4444`, ou `vp8`/`vp9 --pixel-format=yuva420p`) NE PRÉSERVE PAS l'alpha : la sortie ressort en `yuv420p`/`yuv422p12le` (fond opaque noir), même avec `--image-format=png`. Résultat : le bouton recouvre la vidéo d'un rectangle noir.

**Solution : rendre une SÉQUENCE DE PNG** (`--sequence --image-format=png`). Chaque PNG conserve son canal alpha (`rgba`). FFmpeg lit la séquence et l'incruste avec vraie transparence.

```bash
# Diagnostic alpha : une frame doit être rgba (transparent), pas rgb/yuv (opaque)
ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of default=nk=1:nw=1 frame.png
```

## Piège critique n°2 : chemins avec espaces sous Windows

`npx remotion render` casse le parsing de `--props` si le chemin contient des espaces (« VS CODE FORMATION »). **Solution :** lancer avec `cwd = <dossier remotion>` et passer des chemins **RELATIFS** sans espaces (`--props=cta.json`, sortie `cta/`). Écrire le JSON de props avec `fs.writeFileSync` (utf8 sans BOM ; un BOM fait échouer `JSON.parse`).

## Composition Remotion du bouton CTA

`CtaClip` = fond transparent (aucun background), 4 s (120 frames @30fps), un seul prop `label`. Le bouton : pastille rouge (#ff0033), texte blanc gras centré en bas, bordure blanche, halo, animation spring (pop) + pulse + fondu de sortie.

```tsx
export const ctaClipSchema = z.object({ label: z.string() });
export const CtaClip: React.FC<z.infer<typeof ctaClipSchema>> = ({ label }) => (
  <AbsoluteFill>{/* AUCUN background => transparent */}
    <CtaButton label={label} />
  </AbsoluteFill>
);
// <Composition id="CtaClip" component={CtaClip} durationInFrames={120} fps={30} width={1280} height={720} schema={ctaClipSchema} defaultProps={{label:"Subscribe ▶"}} />
```

Labels par langue (le rendu navigateur gère emoji/scripts non-latins, contrairement à `drawtext`) :
`English:"Subscribe ▶"`, `Français:"Abonne-toi ▶"`, `Español:"¡Suscríbete! ▶"`, `Deutsch:"Abonnieren ▶"`, `日本語:"チャンネル登録 ▶"`, `العربية:"اشترك ▶"`, etc.

## Étape 1 — rendre le CTA en séquence PNG (Node)

```js
const rel = `cta-${id}`;
fs.writeFileSync(path.join(REMOTION_DIR, rel + ".json"), JSON.stringify({ label }));
spawn("npx", ["remotion","render","CtaClip", rel, "--sequence","--image-format=png", `--props=${rel}.json`],
      { cwd: REMOTION_DIR, shell: true, windowsHide: true });
// Sortie : <REMOTION_DIR>/cta-<id>/element-000.png … element-119.png  (tous rgba)
```

## Étape 2 — concaténer + incruster (FFmpeg, un seul passage)

Construire un `filter_complex` programmatiquement. Normaliser chaque clip (taille/fps/sar) AVANT `concat` (les clips peuvent varier, ex. 1264×720@24fps) :

```js
// Entrées : les N clips, puis la séquence PNG en dernière entrée (index N)
inputs = clips.flatMap(f => ["-i", f]);
inputs.push("-framerate","30","-start_number","0","-i", path.join(ctaSeqDir, "element-%03d.png"));

// Normalisation + concat
const vparts = clips.map((_,i)=>`[${i}:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:-1:-1:color=black,setsar=1,fps=30[v${i}]`);
const aparts = clips.map((_,i)=>`[${i}:a]aresample=48000[a${i}]`);
const concatIns = clips.map((_,i)=>`[v${i}][a${i}]`).join("");
let filter = `${vparts.join(";")};${aparts.join(";")};${concatIns}concat=n=${N}:v=1:a=1[base][ca]`;

// CTA à t=1s puis toutes les `every` secondes (fenêtres de 4s). `format=rgba` + split + setpts + overlay enable.
const starts = []; for (let t=1; t < total-4; t += every) starts.push(t);
filter += `;[${N}:v]format=rgba,split=${starts.length}${starts.map((_,k)=>`[k${k}]`).join("")}`;
starts.forEach((S,k)=> filter += `;[k${k}]setpts=PTS+${S}/TB[c${k}]`);
let cur = "[base]";
starts.forEach((S,k)=>{ const nl = k===starts.length-1 ? "[vout]" : `[o${k}]`;
  filter += `;${cur}[c${k}]overlay=0:0:eof_action=pass:enable='between(t,${S},${S+4})'${nl}`; cur = nl; });
// enable='between(t,S,S+4)' : les virgules sont protégées par les quotes du filtergraph. Pas de shell => pas d'échappement supplémentaire.

const args = ["-y", ...inputs, "-filter_complex", filter, "-map", starts.length?"[vout]":"[base]", "-map","[ca]",
  "-c:v","libx264","-preset","veryfast","-crf","20","-pix_fmt","yuv420p","-c:a","aac","-b:a","192k","-movflags","+faststart", out];
spawn("ffmpeg", args, { windowsHide: true }); // PAS de shell:true (spawn passe les args littéralement)
```

Le CTA est **best-effort** : si son rendu Remotion échoue, faire le montage sans overlay plutôt que d'échouer. Ne monter que les clips réellement présents (un clip manquant n'interrompt pas). Nettoyer le dossier PNG + le JSON après.

## Vérifier le résultat

```bash
ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 out.mp4   # durée attendue = N × clipSeconds
ffmpeg -y -ss <t_pendant_un_CTA> -i out.mp4 -frames:v 1 check.png             # le bouton doit être PAR-DESSUS la vidéo (pas de fond noir)
```

## Écran de packaging (final) — bonnes pratiques

- **Titre** : viser 85-100 caractères (max 100 YouTube), jamais < 70 — exploiter la longueur.
- **Tags** : viser 480-500 caractères une fois joints par des virgules (max 500) — en mettre beaucoup (langue + anglais + longue traîne).
- **Description** : accroche 2 lignes + résumé + 3-5 hashtags.
- **Boutons « 📋 Copier »** à côté de chaque champ (titre/description/tags), avec compteur de caractères (`x/100`, `x/500`).
- **Miniature** : i2i **ancré sur la RÉFÉRENCE du personnage** (visage/cheveux garantis), jamais sur une image de scène recadrée (un prompt « gros plan » régénère le visage → autre personne). Toujours ajouter au prompt : « use ONLY the same person's face and hair from the reference image; no text in the image ».
- **Régénérer la miniature avec observation** : champ texte libre + bouton ; l'observation est injectée dans un prompt (via LLM) qui garde l'identité. Anti-cache navigateur : suffixer l'URL de l'image par `?t=<timestamp>` mis à jour à chaque régénération.

## Récapitulatif des règles d'or

1. FFmpeg concatène, Remotion ne fait QUE le bouton CTA (jamais la vidéo longue).
2. CTA transparent = **séquence PNG** (`--sequence --image-format=png`), jamais une vidéo (alpha perdu).
3. Chemins Remotion **relatifs** + `cwd` (espaces Windows) ; props en JSON sans BOM.
4. Normaliser (scale/pad/fps/sar) avant `concat` ; `format=rgba` avant l'overlay PNG.
5. Overlay répété via `split` + `setpts=PTS+S/TB` + `enable='between(t,S,S+4)'`.
6. CTA et clips manquants = best-effort (livrer quand même).
7. Miniature ancrée sur la référence d'identité + régénérable avec observation.

## ⚠ Piège n°1 de TOUT rendu spawné : consommer stdout

`spawn("npx remotion render …")` sans lecteur sur **stdout** = gel garanti : Remotion y écrit sa progression, le tampon du pipe (64 Ko) se remplit (~frame 900) et le process se fige en écriture. Trois gels identiques au même octet avant diagnostic. Toujours `child.stdout.on("data", …)` — et parser `Rendered X/Y` pour la progression de la tâche.

## Montage « image + audio long » (machine Musique) — le pattern qui marche

- Compo Remotion complète (`MusiqueMontage`) : image de fond + waveform + CTA `<Sequence>` + effets, rendue en MP4 direct. **Aucune vidéo décodée** (image fixe + audio) → pas de gel OffthreadVideo, ~25 min de rendu pour 39 min de vidéo.
- **Waveform PRÉCALCULÉE côté Node** (FFT offline 64 bandes → JSON base64, lu par `fetch(staticFile())` + `delayRender`) : `useWindowedAudioData` n'est PAS fiable sur un long fichier (et exige du WAV). Couleur paramétrable : "gradient" (hue 150→325, la référence cyberpunk) ou hex uni.
- Audio final : `<Audio>` **cœur de remotion** (pas `@remotion/media`) sur le WAV concaténé par FFmpeg.
- CTA néon (`MusiqueCta`) : boîte translucide, bordure rose pulsante, cloche animée, question + bouton — premier passage DÈS le début (1 s), puis à intervalle.
- Assets copiés dans `remotion/public/<rel>/`, props JSON sans BOM, sortie déplacée puis nettoyage (public + WAV ~400 Mo).

## Acquis des machines 2-3 (Linguistique, Musique — juillet 2026)

- **Durée audio→vidéo (règle d'or absolue)** : audio TEL QUEL (jamais de trim — un `silenceremove` mange la dernière syllabe), `ffprobe` → vidéo générée à `-t <durée exacte>`. **JAMAIS `-shortest` avec `-loop 1`** (le muxer déborde de 1-2 s). Lipsync : ré-injecter l'audio original (`-map 0:v -map 1:a -c:v copy`).
- **Sous-titres = montage 2 passes** : passe 1 concat + CTA → `assembled.mp4` ; UNE passe Whisper sur la vidéo assemblée (timestamps déjà finaux, zéro offset) ; passe 2 gravure `subtitles=` avec **`-c:a copy`**. Couleur : hex UI → ASS `&H00BBGGRR&`.
- **Vidéo musicale (image fixe + N audios)** : concat demuxer des mp3 → durée totale → `-loop 1 -t <durée>` + `showwaves=…:colors=0x<hex>` (fond noir → `colorkey=black` avant overlay), titre `drawtext=textfile=` (zéro échappement), glitch `rgbashift=…:enable='lt(mod(t,12),0.28)'`. La compo Remotion `CtaTopRight` est PARTAGÉE entre machines (seule la prop `label` change).
