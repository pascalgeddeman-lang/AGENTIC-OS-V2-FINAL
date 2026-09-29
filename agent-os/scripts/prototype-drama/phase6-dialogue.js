/**
 * PHASE 6 — LE test qui reste : DEUX personnages, identités tenues, dialogue en champ-contrechamp.
 *   1. Référence de l'antagoniste (2e identité)
 *   2. Plan A : les DEUX personnages dans la même image (i2i à 2 références) ← le point dur
 *   3. Plan B : contrechamp sur Aminata (1 référence)
 *   4. Clips Grok muets, puis 2 voix ElevenLabs distinctes + veed/lipsync sur chacun
 *   5. Montage : la vidéo se cale sur la voix, jamais l'inverse
 */
const R="/Users/claudiobaldini/Documents/Agentic OS V2/agent-os/";
const fs=require("fs"),path=require("path"),{execFileSync}=require("child_process");
const vault=require(R+"lib/vault.js"),google=require(R+"lib/google.js"),fal=require(R+"lib/fal.js"),spend=require(R+"lib/spend.js");
const voices=require(R+"lib/voices.js");
const OUT=process.env.OUT, P1=JSON.parse(fs.readFileSync(path.join(OUT,"phase1.json"),"utf8"));
const DIR=path.join(OUT,"dialogue"); fs.mkdirSync(DIR,{recursive:true});
/** GARDE : une URL manquante produit `[undefined, "..."]` que Kie refuse. On vérifie AVANT de payer. */
function mustBeUrls(a){
  a.forEach((u,i)=>{ if(typeof u!=="string"||!/^https?:\/\//.test(u))
    throw new Error(`Référence ${i} invalide (${String(u).slice(0,40)}) — i2i annulé avant paiement`); });
  return a;
}

const KEY=()=>vault.get("kie");
async function kieCreate(m,i){const r=await fetch("https://api.kie.ai/api/v1/jobs/createTask",{method:"POST",
 headers:{Authorization:`Bearer ${KEY()}`,"Content-Type":"application/json"},body:JSON.stringify({model:m,input:i})}).then(x=>x.json());
 if(!r.data?.taskId) throw new Error(`Kie ${m}: ${r.msg||JSON.stringify(r).slice(0,200)}`); return r.data.taskId;}
async function kiePoll(t,{timeoutMs=15*60*1000,intervalMs=12000}={}){const t0=Date.now();
 while(true){await new Promise(s=>setTimeout(s,intervalMs)); if(Date.now()-t0>timeoutMs) throw new Error("Kie: delai depasse");
  const r=await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${t}`,{headers:{Authorization:`Bearer ${KEY()}`}}).then(x=>x.json());
  if(r.data?.state==="success") return JSON.parse(r.data.resultJson).resultUrls[0];
  if(r.data?.state==="fail") throw new Error("Kie: "+(r.data?.failMsg||"?"));}}
/** Relance plutôt qu'allonger le délai (leçon phase 4 : un job perdu ne finit jamais). */
const FATAL=/must be|invalid|unauthorized|not found|bad request|required/i; // erreurs de REQUÊTE : relancer ne sert à rien
async function kieRetry(model,input,tries=2){
  let last;
  for(let i=1;i<=tries;i++){
    try{ return await kiePoll(await kieCreate(model,input)); }
    catch(e){
      last=e;
      if(FATAL.test(e.message)){ console.log(`      erreur DETERMINISTE, pas de relance : ${e.message}`); throw e; }
      console.log(`      tentative ${i} echouee (${e.message}) — relance`);
    }
  }
  throw last;
}
/**
 * Téléchargement. Kie renvoie du JPEG même quand on nomme le fichier .png → on nomme d'après
 * les OCTETS (leçon Bouddhisme). ⚠ MAIS uniquement pour les IMAGES : appliqué à une vidéo, ce
 * reniflage produisait « clip-A.mp4.png » — un H264 déguisé en PNG, introuvable au run suivant.
 */
async function dl(u,f){
  const b=Buffer.from(await (await fetch(u)).arrayBuffer());
  if(/\.(mp4|mov|webm|mp3|m4a|wav)$/i.test(f)){ fs.writeFileSync(f,b); return f; }
  const ext=(b[0]===0xFF&&b[1]===0xD8)?".jpg":".png";
  const o=f.replace(/\.(png|jpe?g)$/i,"")+ext; fs.writeFileSync(o,b); return o;
}
const ff=(a)=>execFileSync("ffmpeg",["-y",...a],{stdio:["ignore","pipe","pipe"]});
const dur=(f)=>Number(execFileSync("ffprobe",["-v","error","-show_entries","format=duration","-of","csv=p=0",f]).toString().trim());
/**
 * Upload public RÉSILIENT. `google.driveUpload` fait `.json()` sur la réponse : quand Drive
 * throttle il renvoie une page HTML, et l'erreur remonte en « Unexpected token '<' », illisible.
 * On relance avec un palier croissant et on rend un message exploitable.
 */
async function pub(n,m,f,tries=3){
  let last;
  for(let i=1;i<=tries;i++){
    try{
      const u=await google.driveUpload(n,m,fs.readFileSync(f));
      await google.ensurePublic(u.id).catch(()=>{});
      return `https://drive.google.com/uc?export=download&id=${u.id}`;
    }catch(e){
      last=e;
      const html=/Unexpected token '<'|DOCTYPE/i.test(e.message);
      console.log(`      upload ${n} tentative ${i}/${tries} echouee${html?" (Drive a renvoye du HTML — throttle)":""} : ${e.message.slice(0,70)}`);
      if(i<tries) await new Promise(r=>setTimeout(r,4000*i));
    }
  }
  throw new Error(`Upload Drive impossible apres ${tries} tentatives : ${last.message.slice(0,120)}`);
}

const STYLE="Modern 3D animated feature film style, Pixar and DreamWorks quality rendering, "+
"expressive character animation with large detailed eyes, soft cinematic subsurface skin shading, "+
"rich warm color grading, volumetric lighting, shallow depth of field, detailed environment textures, "+
"high production value, 16:9 cinematic framing. No brand names, no trademarks, no logos.";

const REF_ANTA=
"Full character reference sheet, single character centered, neutral standing pose, facing camera, "+
"neutral clean light grey studio background, even soft lighting, full body visible. "+
"A French woman in her late fifties, pale fair skin, sharp angular face, high cheekbones, thin lips, "+
"cold pale blue eyes, silver-grey hair in a short precise bob, a single strand of pearls at her neck. "+
"She wears an immaculate cream tailored trouser suit and beige high heels, posture rigid and imperious. "+
STYLE+" No text, no logo, no watermark, plain background.";

const NOSPEAK="ABSOLUTELY NO SPEECH from any character, no talking, no lip movement, no dialogue, no voice. ";

// Deux repliques, deux voix — le coeur du test.
const D1={qui:"Antagoniste", texte:"Vous nettoyez les bureaux. Vous ne dessinez pas. Chacun sa place."};
const D2={qui:"Aminata",     texte:"Ma place, madame, ce n'est pas vous qui la décidez."};

(async()=>{
  console.log("PHASE 6 — deux personnages, dialogue en champ-contrechamp\n");

  console.log("[1/5] Reference de l'antagoniste…");
  let antaFile=path.join(DIR,"ref-antagoniste.png");
  if(fs.existsSync(antaFile)){ console.log("      deja generee, reutilisee (non repayee)"); }
  else {
    antaFile=await dl(await kieRetry("gpt-image-2-text-to-image",
      {prompt:REF_ANTA,aspect_ratio:"16:9",resolution:"1K"}), path.join(DIR,"ref-antagoniste"));
    spend.record("Kie.ai","Prototype Drama",0.03,"USD","Reference antagoniste");
  }
  const antaUrl=await pub("proto-ref-anta"+path.extname(antaFile),
    path.extname(antaFile)===".jpg"?"image/jpeg":"image/png",antaFile);
  console.log("      -> "+path.basename(antaFile));

  let aminataUrl=P1.refUrl;
  if(typeof aminataUrl!=="string"||!/^https?:\/\//.test(aminataUrl)){
    console.log("      refUrl absente de phase1.json — re-upload de la reference Aminata…");
    aminataUrl=await pub("proto-ref-aminata.png","image/png",path.join(OUT,"reference.png"));
    P1.refUrl=aminataUrl; fs.writeFileSync(path.join(OUT,"phase1.json"),JSON.stringify(P1,null,1));
    console.log("      -> "+aminataUrl);
  }

  console.log("[2/5] Plan A — LES DEUX dans la meme image (2 references) ← le point dur…");
  const pA="The two characters are EXACTLY the people in the two reference images: the young woman in the "+
   "blue cleaning uniform is the FIRST reference, the older woman in the cream suit is the SECOND reference. "+
   "Do not alter their faces, hair, skin or build in any way, and do not blend them together. "+
   "In an open plan office at dusk, the older woman in the cream suit stands rigid on the left, chin high, "+
   "speaking down at the young woman in the blue uniform who stands on the right holding a sketchbook against "+
   "her chest, jaw set, holding her gaze instead of looking away. Medium wide two-shot, both faces clearly "+
   "visible and equally lit, camera at eye level. Harsh overhead office light, long shadows. Confrontation, "+
   "tense, charged. "+STYLE;
  let planA=path.join(DIR,"plan-A-duo.png");
  if(fs.existsSync(planA)){ console.log("      deja genere, reutilise (non repaye)"); }
  else{
    planA=await dl(await kieRetry("gpt-image-2-image-to-image",
      {prompt:pA,input_urls:mustBeUrls([aminataUrl,antaUrl]),aspect_ratio:"16:9",resolution:"1K"}), path.join(DIR,"plan-A-duo"));
    spend.record("Kie.ai","Prototype Drama",0.03,"USD","Plan A (duo)");
  }
  console.log("      -> "+path.basename(planA));

  console.log("[3/5] Plan B — contrechamp sur Aminata (1 reference)…");
  const pB="The character is EXACTLY the same woman as in the reference image: same face, same hair, same skin. "+
   "Do not alter her facial features in any way. She wears her faded blue cleaning uniform and holds her "+
   "sketchbook against her chest. Reverse angle, medium close shot on her face and shoulders, she looks slightly "+
   "off camera to the left, straight at the person facing her, her chin lifting, eyes steady and unafraid. "+
   "The blurred cream shoulder of the other woman is visible at the very edge of frame. Open plan office at dusk, "+
   "harsh overhead light. Defiant, quiet, resolute. "+STYLE;
  let planB=path.join(DIR,"plan-B-contrechamp.png");
  if(fs.existsSync(planB)){ console.log("      deja genere, reutilise (non repaye)"); }
  else{
    planB=await dl(await kieRetry("gpt-image-2-image-to-image",
      {prompt:pB,input_urls:mustBeUrls([aminataUrl]),aspect_ratio:"16:9",resolution:"1K"}), path.join(DIR,"plan-B-contrechamp"));
    spend.record("Kie.ai","Prototype Drama",0.03,"USD","Plan B (contrechamp)");
  }
  console.log("      -> "+path.basename(planB));

  console.log("[4/5] Clips Grok muets…");
  const clips={};
  for(const [k,img,mv] of [["A",planA,"Very slow dolly push-in between the two women, both remaining perfectly still and tense"],
                           ["B",planB,"Very slow dolly push-in on her face, her chin lifting slightly"]]){
    const url=await pub(`proto-dlg-${k}`+path.extname(img), path.extname(img)===".jpg"?"image/jpeg":"image/png", img);
    const already=path.join(DIR,`clip-${k}.mp4`);
    if(fs.existsSync(already)){ clips[k]=already; console.log(`      clip ${k} deja present (${dur(already).toFixed(2)} s), reutilise`); continue; }
    const f=await dl(await kieRetry("grok-imagine-video-1-5-preview",
      {prompt:NOSPEAK+`Cinematic 3D animated shot. ${mv}. Harsh office light, subtle dust in the air. `+
       "Keep both characters exactly identical to the source image at all times. "+NOSPEAK,
       image_urls:[url+"&r="+Date.now().toString(36)],duration:6,resolution:"720p",aspect_ratio:"16:9"}),
      path.join(DIR,`clip-${k}.mp4`));
    spend.record("Kie.ai","Prototype Drama",6*0.015,"USD",`Clip dialogue ${k}`);
    clips[k]=f; console.log(`      clip ${k} -> ${dur(f).toFixed(2)} s`);
  }

  console.log("[5/5] Voix distinctes + lipsync + montage…");
  const lib=voices.list();
  const parts=[];
  for(const [k,d] of [["A",D1],["B",D2]]){
    const v=lib.find(x=>x.name.startsWith(d.qui));
    if(!v) throw new Error("Voix introuvable dans la bibliotheque : "+d.qui);
    const r=await fal.run("fal-ai/elevenlabs/tts/eleven-v3",{text:d.texte,voice:v.ref});
    if(!r.audio?.url) throw new Error("TTS "+d.qui);
    const aud=path.join(DIR,`voix-${k}.mp3`); await fal.download(r.audio.url,aud);
    spend.record("FAL.ai","Prototype Drama",d.texte.length/1000*0.10,"USD",`Voix ${d.qui}`);
    const dA=dur(aud), dV=dur(clips[k]);
    console.log(`      ${d.qui.padEnd(12)} (${v.ref.slice(0,12)}…) voix ${dA.toFixed(2)} s | clip ${dV.toFixed(2)} s`);

    const base=path.join(DIR,`base-${k}.mp4`);
    if(dA>dV) ff(["-i",clips[k],"-vf",`setpts=${(dA/dV).toFixed(4)}*PTS`,"-an","-c:v","libx264","-crf","20",base]);
    else      ff(["-i",clips[k],"-t",dA.toFixed(3),"-an","-c:v","libx264","-crf","20",base]);

    const vUrl=await pub(`proto-dlg-base-${k}.mp4`,"video/mp4",base);
    const aUrl=await pub(`proto-dlg-aud-${k}.mp3`,"audio/mpeg",aud);
    const res=await fal.run("veed/lipsync",{video_url:vUrl,audio_url:aUrl},{timeoutMs:12*60*1000});
    const lipUrl=res?.video?.url||res?.video_url;
    if(!lipUrl) throw new Error("Lipsync "+k+" : "+JSON.stringify(res).slice(0,160));
    const tmp=path.join(DIR,`lip-${k}-tmp.mp4`); await fal.download(lipUrl,tmp);
    const out=path.join(DIR,`seg-${k}.mp4`);
    ff(["-i",tmp,"-i",aud,"-map","0:v:0","-map","1:a:0","-c:v","libx264","-crf","20","-r","30",
        "-vf","scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:-1:-1,setsar=1",
        "-c:a","aac","-b:a","192k",out]);
    fs.unlinkSync(tmp);
    spend.record("FAL.ai","Prototype Drama",(dA/60)*0.40,"USD",`Lipsync ${k}`);
    parts.push(out); console.log(`      seg-${k}.mp4 ${dur(out).toFixed(2)} s`);
  }

  fs.writeFileSync(path.join(DIR,"list.txt"),parts.map(f=>`file '${f}'`).join("\n"));
  const final=path.join(DIR,"dialogue.mp4");
  ff(["-f","concat","-safe","0","-i",path.join(DIR,"list.txt"),"-c","copy",final]);
  console.log(`\nTERMINE -> ${final} (${dur(final).toFixed(2)} s)`);
})();
