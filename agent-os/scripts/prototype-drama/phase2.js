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

// INTERDICTION DE PAROLE absolue, repetee debut ET fin (on ajoute notre propre bande-son).
const NOSPEAK="ABSOLUTELY NO SPEECH, no talking, no lip movement, no dialogue, no singing, no voice of any kind. ";
const CLIPS=[
 {src:1,p:NOSPEAK+"Cinematic 3D animated shot. The young woman continues mopping the marble floor of the empty "+
  "night office, her body moving slowly and wearily with the mop, shoulders low. Very slow smooth dolly push-in "+
  "toward her, subtle parallax on the city skyline through the windows behind, the distant city lights twinkling "+
  "faintly, a soft reflection sliding across the wet marble floor. Her breathing is visible in her posture. "+
  "Cool blue night light, warm ceiling spots. Melancholic, quiet, dignified. Keep the character exactly identical "+
  "to the source image at all times. "+NOSPEAK},
 {src:5,p:NOSPEAK+"Cinematic 3D animated shot. The young woman in the emerald dress stands proudly in her atelier "+
  "and slowly lifts her chin, a calm confident smile growing on her face, her hand resting on her hip. Very slow "+
  "smooth dolly push-in with a slight orbit to the right, warm golden hour light shifting gently across the room, "+
  "the fabric of her dress catching the light, sheer curtains drifting slightly near the window. Triumphant, warm, "+
  "radiant. Keep the character exactly identical to the source image at all times. "+NOSPEAK},
];
const VO="Il est deux heures du matin. Aminata nettoie les bureaux d'une maison de couture "+
 "dont elle ne franchira jamais la porte d'entrée. Trois ans plus tard, cette porte porterait son nom.";

(async()=>{
  console.log("PHASE 2 — clips Grok + voix off francaise (Alain)\n");
  const clips=[];
  for(const c of CLIPS){
    const src=P1.plans.find(p=>p.i===c.src);
    console.log(`[clip ${c.src}] upload public…`);
    const up=await google.driveUpload(`proto-plan-${c.src}${path.extname(src.file)}`,
      path.extname(src.file)===".jpg"?"image/jpeg":"image/png",fs.readFileSync(src.file));
    console.log(`[clip ${c.src}] Grok 6 s…`);
    const t=await kieCreate("grok-imagine-video-1-5-preview",
      {prompt:c.p,image_urls:[up.directUrl+"&r="+Date.now().toString(36)],duration:6,resolution:"720p",aspect_ratio:"16:9"});
    const u=await kiePoll(t);
    const f=await dl(u,path.join(OUT,`clip-${c.src}.mp4`));
    spend.record("Kie.ai","Prototype Drama",6*0.015,"USD",`Clip Grok plan ${c.src} (6 s)`);
    console.log(`      -> ${path.basename(f)} (${dur(f).toFixed(2)} s)`);
    clips.push(f);
  }

  console.log("\n[voix] Inworld TTS francais (Alain)…");
  const a=await fal.run("fal-ai/inworld-tts",{text:VO,voice:"Alain",sample_rate_hertz:48000});
  const voFile=path.join(OUT,"vo.mp3");
  await fal.download(a.audio.url,voFile);
  spend.record("FAL.ai","Prototype Drama",VO.length/1000*0.005,"USD",`Voix off (${VO.length} car.)`);
  const dVO=dur(voFile); console.log(`      -> vo.mp3 (${dVO.toFixed(2)} s)`);

  // Concat des clips (normalises), puis on cale la video sur la VOIX (regle d or : jamais couper l audio)
  console.log("\n[montage] concat + mux (aucun sous-titre)…");
  const norm=[];
  clips.forEach((f,k)=>{const o=path.join(OUT,`n-${k}.mp4`);
    ff(["-i",f,"-r","30","-vf","scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:-1:-1,setsar=1",
        "-an","-c:v","libx264","-preset","medium","-crf","20",o]); norm.push(o);});
  fs.writeFileSync(path.join(OUT,"list.txt"),norm.map(f=>`file '${f}'`).join("\n"));
  const cat=path.join(OUT,"concat.mp4");
  ff(["-f","concat","-safe","0","-i",path.join(OUT,"list.txt"),"-c","copy",cat]);
  const dV=dur(cat); console.log(`      video ${dV.toFixed(2)} s | voix ${dVO.toFixed(2)} s`);

  const final=path.join(OUT,"prototype.mp4");
  if(dVO>dV){ // gel de la derniere image plutot que couper la voix
    ff(["-i",cat,"-i",voFile,"-vf",`tpad=stop_mode=clone:stop_duration=${(dVO-dV+0.4).toFixed(2)}`,
        "-map","0:v","-map","1:a","-c:v","libx264","-crf","20","-c:a","aac","-ar","48000","-ac","2",final]);
  } else {
    ff(["-i",cat,"-i",voFile,"-map","0:v","-map","1:a","-c:v","copy","-c:a","aac","-ar","48000","-ac","2",final]);
  }
  console.log(`\nTERMINE -> ${final} (${dur(final).toFixed(2)} s)`);
  console.log("Cout phase 2 ~"+(2*6*0.015+VO.length/1000*0.005).toFixed(2)+" $");
})();
