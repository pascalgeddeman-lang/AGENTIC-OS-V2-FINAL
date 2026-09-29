#!/usr/bin/env node
/**
 * PHASE 3 — sequence « TOUT ANIME » : les 5 plans en clips Grok + voix off segmentee.
 * Les clips 1 et 5 existent deja (phase 2), on ne genere que 2, 3 et 4.
 *
 * Principe de montage (celui que la machine devra suivre) :
 *   1. La VOIX est synthetisee PAR PLAN.
 *   2. La duree de chaque plan est calee sur SA phrase (+ une respiration).
 *   3. On n ajuste la VIDEO, jamais l audio — regle d or du journal des machines.
 */
const R="/Users/claudiobaldini/Documents/Agentic OS V2/agent-os/";
const fs=require("fs"),path=require("path"),{execFileSync}=require("child_process");
const vault=require(R+"lib/vault.js"),google=require(R+"lib/google.js"),fal=require(R+"lib/fal.js"),spend=require(R+"lib/spend.js");
const OUT=process.env.OUT, P1=JSON.parse(fs.readFileSync(path.join(OUT,"phase1.json"),"utf8"));

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

const NOSPEAK="ABSOLUTELY NO SPEECH, no talking, no lip movement, no dialogue, no singing, no voice of any kind. ";
const MANQUANTS=[
 {src:2,p:NOSPEAK+"Cinematic 3D animated shot. The two elegant women in designer suits walk slowly past in the "+
  "foreground still laughing behind their hands, while the young woman in the blue cleaning uniform in the "+
  "background lowers her eyes and presses herself back against the wall, clutching her folded cloth tighter to "+
  "her chest. Very slow smooth dolly push-in past the two women toward her, shallow depth of field, the "+
  "foreground figures drifting out of frame. Bright cold daylight on glossy white walls. Humiliating, tense, "+
  "quietly painful. Keep the character exactly identical to the source image at all times. "+NOSPEAK},
 {src:3,p:NOSPEAK+"Cinematic 3D animated shot. The young woman keeps drawing in her sketchbook on the concrete "+
  "staircase, her pencil moving in small confident strokes across the page, her eyes following the line, a faint "+
  "proud smile deepening. Very slow smooth dolly push-in toward the sketchbook, warm golden dust motes drifting "+
  "slowly in the shaft of light from the high window, soft shadows shifting. Intimate, hopeful, secret. "+
  "Keep the character exactly identical to the source image at all times. "+NOSPEAK},
 {src:4,p:NOSPEAK+"Cinematic 3D animated shot. The young woman on one knee slowly gathers the scattered drawings "+
  "from the polished floor, her hand closing on a page, her face lifting toward the older woman in the cream "+
  "suit who stands above her with arms crossed and turns her head away in cold disdain. Very slow low-angle "+
  "dolly push-in from floor level, harsh overhead light, hard shadows stretching across the floor. Cruel, "+
  "pivotal, charged. Keep the character exactly identical to the source image at all times. "+NOSPEAK},
];

// Une phrase par plan, ~15-17 mots : le rythme de conteur releve chez Temple des Recits.
const VO=[
 {i:1,t:"Il est deux heures du matin. Aminata nettoie des bureaux qu'elle ne verra jamais en plein jour."},
 {i:2,t:"Chaque matin, les mêmes rires derrière les mains. Chaque matin, elle s'efface contre le mur."},
 {i:3,t:"Ce qu'elles ignorent : entre deux étages, dans la cage d'escalier, Aminata dessine des robes."},
 {i:4,t:"Le jour où son carnet est tombé, personne n'a ramassé une seule page."},
 {i:5,t:"Trois ans plus tard, cette porte porterait son nom. Atelier Lumière, Paris."},
];
const ATEMPO=0.88;   // Inworld sort a ~178 mots/min ; la niche en demande ~160 (lecon Bouddhisme)
const PAUSE=0.45;    // respiration entre plans

(async()=>{
  console.log("PHASE 3 — sequence TOUT ANIME (5 plans)\n");

  console.log("[1/3] Clips Grok manquants (2, 3, 4)…");
  for(const c of MANQUANTS){
    const f=path.join(OUT,`clip-${c.src}.mp4`);
    if(fs.existsSync(f)){ console.log(`      clip ${c.src} deja present, saute`); continue; }
    const src=P1.plans.find(p=>p.i===c.src);
    const up=await google.driveUpload(`proto-plan-${c.src}${path.extname(src.file)}`,
      path.extname(src.file)===".jpg"?"image/jpeg":"image/png",fs.readFileSync(src.file));
    const t=await kieCreate("grok-imagine-video-1-5-preview",
      {prompt:c.p,image_urls:[up.directUrl+"&r="+Date.now().toString(36)],duration:6,resolution:"720p",aspect_ratio:"16:9"});
    await dl(await kiePoll(t),f);
    spend.record("Kie.ai","Prototype Drama",6*0.015,"USD",`Clip Grok plan ${c.src} (6 s)`);
    console.log(`      clip ${c.src} -> ${dur(f).toFixed(2)} s`);
  }

  console.log("\n[2/3] Voix off segmentee (Alain (fr), atempo "+ATEMPO+")…");
  const segs=[];
  for(const v of VO){
    const raw=path.join(OUT,`vo-raw-${v.i}.mp3`), slow=path.join(OUT,`vo-${v.i}.mp3`);
    const r=await fal.run("fal-ai/inworld-tts",{text:v.t,voice:"Alain (fr)",sample_rate_hertz:48000});
    if(!r.audio?.url) throw new Error("Inworld : aucun audio (plan "+v.i+")");
    await fal.download(r.audio.url,raw);
    ff(["-i",raw,"-filter:a",`atempo=${ATEMPO}`,"-ar","48000","-ac","2",slow]);
    spend.record("FAL.ai","Prototype Drama",v.t.length/1000*0.005,"USD",`Voix plan ${v.i}`);
    const d=dur(slow), mots=v.t.split(/\s+/).length;
    segs.push({i:v.i,file:slow,d,cible:d+PAUSE});
    console.log(`      plan ${v.i} : ${d.toFixed(2)} s (${mots} mots, ${Math.round(mots/(d/60))} mots/min) -> plan cale a ${(d+PAUSE).toFixed(2)} s`);
  }

  console.log("\n[3/3] Montage — chaque plan cale sur SA phrase (on n ajuste que la video)…");
  const parts=[];
  for(const s of segs){
    const src=path.join(OUT,`clip-${s.i}.mp4`), out=path.join(OUT,`seq-${s.i}.mp4`);
    const D=dur(src), T=s.cible;
    const base=["-i",src,"-r","30","-an"];
    let vf="scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:-1:-1,setsar=1";
    if(T<=D){ // plus court : on coupe la fin du mouvement
      ff([...base,"-t",T.toFixed(3),"-vf",vf,"-c:v","libx264","-preset","medium","-crf","20",out]);
      console.log(`      plan ${s.i} : clip ${D.toFixed(2)} s -> coupe a ${T.toFixed(2)} s`);
    } else if(T/D<=1.35){ // un peu plus long : ralenti imperceptible
      const f=(T/D).toFixed(4);
      ff([...base,"-vf",`${vf},setpts=${f}*PTS`,"-c:v","libx264","-preset","medium","-crf","20",out]);
      console.log(`      plan ${s.i} : clip ${D.toFixed(2)} s -> ralenti x${f} = ${T.toFixed(2)} s`);
    } else { // trop long : gel de la derniere image
      ff([...base,"-vf",`${vf},tpad=stop_mode=clone:stop_duration=${(T-D).toFixed(2)}`,"-c:v","libx264","-preset","medium","-crf","20",out]);
      console.log(`      plan ${s.i} : clip ${D.toFixed(2)} s -> gel +${(T-D).toFixed(2)} s`);
    }
    parts.push(out);
  }
  // audio : segments + respirations, dans le meme ordre -> les deux timelines coincident par construction
  const alist=[];
  segs.forEach((s,k)=>{ alist.push(s.file);
    const sil=path.join(OUT,`sil-${k}.mp3`);
    ff(["-f","lavfi","-i","anullsrc=r=48000:cl=stereo","-t",PAUSE.toFixed(3),sil]); alist.push(sil); });
  fs.writeFileSync(path.join(OUT,"alist.txt"),alist.map(f=>`file '${f}'`).join("\n"));
  const audio=path.join(OUT,"vo-full.m4a");
  ff(["-f","concat","-safe","0","-i",path.join(OUT,"alist.txt"),"-c:a","aac","-ar","48000","-ac","2",audio]);
  fs.writeFileSync(path.join(OUT,"vlist.txt"),parts.map(f=>`file '${f}'`).join("\n"));
  const video=path.join(OUT,"seq-video.mp4");
  ff(["-f","concat","-safe","0","-i",path.join(OUT,"vlist.txt"),"-c","copy",video]);

  const final=path.join(OUT,"tout-anime.mp4");
  ff(["-i",video,"-i",audio,"-map","0:v","-map","1:a","-c:v","copy","-c:a","aac","-ar","48000","-ac","2","-shortest",final]);
  console.log(`\nvideo ${dur(video).toFixed(2)} s | audio ${dur(audio).toFixed(2)} s | FINAL ${dur(final).toFixed(2)} s`);
  console.log(`-> ${final}`);
  console.log(`Cout phase 3 ~${(3*6*0.015+VO.reduce((s,v)=>s+v.t.length,0)/1000*0.005).toFixed(2)} $`);
})();
