/**
 * PHASE 5 — faire PARLER le personnage. Deux voies comparees sur le meme plan (le 5).
 *   A. Grok genere la parole lui-meme (dialogue decrit dans le prompt video).
 *      -> 1 appel, pas de controle du timbre, la voix change potentiellement d un plan a l autre.
 *   B. Clip Grok MUET + voix ElevenLabs choisie + lipsync veed/lipsync.
 *      -> 3 etapes, mais LA MEME voix sur toute la serie (identite de personnage).
 */
const R="/Users/claudiobaldini/Documents/Agentic OS V2/agent-os/";
const fs=require("fs"),path=require("path"),{execFileSync}=require("child_process");
const vault=require(R+"lib/vault.js"),google=require(R+"lib/google.js"),fal=require(R+"lib/fal.js"),spend=require(R+"lib/spend.js");
const OUT=process.env.OUT;
const KEY=()=>vault.get("kie");
async function kieCreate(m,i){const r=await fetch("https://api.kie.ai/api/v1/jobs/createTask",{method:"POST",
 headers:{Authorization:`Bearer ${KEY()}`,"Content-Type":"application/json"},body:JSON.stringify({model:m,input:i})}).then(x=>x.json());
 if(!r.data?.taskId) throw new Error(`Kie ${m}: ${r.msg||JSON.stringify(r).slice(0,200)}`); return r.data.taskId;}
async function kiePoll(t,{timeoutMs=20*60*1000,intervalMs=15000}={}){const t0=Date.now();
 while(true){await new Promise(s=>setTimeout(s,intervalMs)); if(Date.now()-t0>timeoutMs) throw new Error("Kie: delai depasse");
  const r=await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${t}`,{headers:{Authorization:`Bearer ${KEY()}`}}).then(x=>x.json());
  if(r.data?.state==="success") return JSON.parse(r.data.resultJson).resultUrls[0];
  if(r.data?.state==="fail") throw new Error("Kie: "+(r.data?.failMsg||"?"));}}
async function dl(u,f){fs.writeFileSync(f,Buffer.from(await (await fetch(u)).arrayBuffer()));return f;}
const ff=(a)=>execFileSync("ffmpeg",["-y",...a],{stdio:["ignore","pipe","pipe"]});
const dur=(f)=>Number(execFileSync("ffprobe",["-v","error","-show_entries","format=duration","-of","csv=p=0",f]).toString().trim());
const pub=async(n,m,f)=>{const u=await google.driveUpload(n,m,fs.readFileSync(f)); await google.ensurePublic(u.id).catch(()=>{});
  return `https://drive.google.com/uc?export=download&id=${u.id}`;};

const REPLIQUE="Il y a trois ans, je nettoyais ces bureaux. Aujourd'hui, c'est mon nom sur la porte.";
// Voix DECRITE A L IDENTIQUE — regle Time Travel : sans ca le timbre derive d un plan a l autre.
const VOIX="Her voice is warm, calm and low-pitched, a young West African woman speaking clear "+
  "natural French with quiet controlled pride, unhurried, never shouting.";

(async()=>{
  const dir=path.join(OUT,"parole"); fs.mkdirSync(dir,{recursive:true});
  console.log(`Replique testee (${REPLIQUE.split(/\s+/).length} mots) :\n  « ${REPLIQUE} »\n`);

  // ---------- VOIE A : Grok parle ----------
  console.log("[A] Grok genere la parole (dialogue dans le prompt video)…");
  try{
    const srcImg=path.join(OUT,"plan-5.png");
    const url=await pub("parole-plan5.png","image/png",srcImg);
    const p="Cinematic 3D animated shot. The young woman in the emerald dress looks directly at the camera "+
      "and SPEAKS this line out loud in French, with clear natural lip movement synchronised to her words: "+
      `"${REPLIQUE}" `+VOIX+" She lifts her chin slightly and smiles with calm pride as she finishes. "+
      "Very slow smooth dolly push-in, warm golden hour light in her atelier. "+
      "Keep the character exactly identical to the source image at all times. "+
      `She must speak EXACTLY this French sentence and nothing else: "${REPLIQUE}"`;
    const t=await kieCreate("grok-imagine-video-1-5-preview",
      {prompt:p,image_urls:[url+"&r="+Date.now().toString(36)],duration:6,resolution:"720p",aspect_ratio:"16:9"});
    const f=await dl(await kiePoll(t),path.join(dir,"A-grok-parle.mp4"));
    spend.record("Kie.ai","Prototype Drama",6*0.015,"USD","Voie A — Grok parle");
    const a=execFileSync("ffprobe",["-v","error","-select_streams","a","-show_entries","stream=codec_name","-of","csv=p=0",f]).toString().trim();
    console.log(`    -> A-grok-parle.mp4 ${dur(f).toFixed(2)} s | piste audio : ${a||"AUCUNE"}`);
  }catch(e){ console.log("    ECHEC voie A :",e.message); }

  // ---------- VOIE B : clip muet + ElevenLabs + lipsync ----------
  console.log("\n[B] Clip muet existant + voix ElevenLabs + veed/lipsync…");
  try{
    const clip=path.join(OUT,"clip-5.mp4");
    console.log("    1. voix ElevenLabs (Charlotte, 159 mots/min — la plus proche de la niche)…");
    const r=await fal.run("fal-ai/elevenlabs/tts/eleven-v3",{text:REPLIQUE,voice:"Charlotte"});
    const aUrlSrc=r.audio?.url; if(!aUrlSrc) throw new Error("ElevenLabs : aucun audio");
    const aud=path.join(dir,"B-voix.mp3"); await fal.download(aUrlSrc,aud);
    spend.record("FAL.ai","Prototype Drama",REPLIQUE.length/1000*0.10,"USD","Voie B — voix ElevenLabs");
    const dA=dur(aud); console.log(`       voix ${dA.toFixed(2)} s`);

    // Regle d or : la VIDEO se cale sur la voix, jamais l inverse.
    const base=path.join(dir,"B-base.mp4"); const dV=dur(clip);
    if(dA>dV) ff(["-i",clip,"-vf",`setpts=${(dA/dV).toFixed(4)}*PTS`,"-an","-c:v","libx264","-crf","20",base]);
    else      ff(["-i",clip,"-t",dA.toFixed(3),"-an","-c:v","libx264","-crf","20",base]);
    console.log(`       clip cale a ${dur(base).toFixed(2)} s`);

    console.log("    2. lipsync veed/lipsync…");
    const vUrl=await pub("parole-B-base.mp4","video/mp4",base);
    const aUrl=await pub("parole-B-voix.mp3","audio/mpeg",aud);
    const res=await fal.run("veed/lipsync",{video_url:vUrl,audio_url:aUrl},{timeoutMs:12*60*1000});
    const lipUrl=res?.video?.url||res?.video_url;
    if(!lipUrl) throw new Error("Lipsync : pas de video — "+JSON.stringify(res).slice(0,200));
    const tmp=path.join(dir,"B-lip-tmp.mp4"); await fal.download(lipUrl,tmp);
    // Le lipsync reencode et ecourte parfois le son -> on remet l audio ORIGINAL integral.
    const out=path.join(dir,"B-lipsync.mp4");
    ff(["-i",tmp,"-i",aud,"-map","0:v:0","-map","1:a:0","-c:v","copy","-c:a","aac","-b:a","192k","-movflags","+faststart",out]);
    fs.unlinkSync(tmp);
    const cost=(dA/60)*0.40;
    spend.record("FAL.ai","Prototype Drama",cost,"USD","Voie B — lipsync veed");
    console.log(`    -> B-lipsync.mp4 ${dur(out).toFixed(2)} s | lipsync ${cost.toFixed(3)} $`);
  }catch(e){ console.log("    ECHEC voie B :",e.message); }

  console.log(`\n-> ${dir}`);
})();
