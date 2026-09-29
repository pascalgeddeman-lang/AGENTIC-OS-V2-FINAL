const R="/Users/claudiobaldini/Documents/Agentic OS V2/agent-os/";
const fs=require("fs"),path=require("path"),{execFileSync}=require("child_process");
const fal=require(R+"lib/fal.js"),spend=require(R+"lib/spend.js");
const OUT=process.env.OUT;
const ff=(a)=>execFileSync("ffmpeg",["-y",...a],{stdio:["ignore","pipe","pipe"]});
const dur=(f)=>Number(execFileSync("ffprobe",["-v","error","-show_entries","format=duration","-of","csv=p=0",f]).toString().trim());

const VO="Il est deux heures du matin. Aminata nettoie les bureaux d'une maison de couture "+
 "dont elle ne franchira jamais la porte d'entrée. Trois ans plus tard, cette porte porterait son nom.";

(async()=>{
  console.log("PHASE 2b — voix off + montage (clips Grok reutilises, non repayes)\n");
  console.log("[voix] Inworld TTS — voice « Alain (fr) » (suffixe de langue OBLIGATOIRE)…");
  const r=await fal.run("fal-ai/inworld-tts",{text:VO,voice:"Alain (fr)",sample_rate_hertz:48000});
  if(!r.audio?.url){ console.log("REPONSE FAL BRUTE:",JSON.stringify(r).slice(0,500)); throw new Error("Inworld TTS : aucun audio renvoye"); }
  const voFile=path.join(OUT,"vo.mp3");
  await fal.download(r.audio.url,voFile);
  spend.record("FAL.ai","Prototype Drama",VO.length/1000*0.005,"USD",`Voix off (${VO.length} car.)`);
  const dVO=dur(voFile); console.log(`      -> vo.mp3 ${dVO.toFixed(2)} s (${VO.length} car., ~${Math.round(VO.split(/\s+/).length/(dVO/60))} mots/min)`);

  console.log("\n[montage] normalisation + concat + mux, AUCUN sous-titre…");
  const clips=[path.join(OUT,"clip-1.mp4"),path.join(OUT,"clip-5.mp4")];
  const norm=[];
  clips.forEach((f,k)=>{const o=path.join(OUT,`n-${k}.mp4`);
    ff(["-i",f,"-r","30","-vf","scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:-1:-1,setsar=1",
        "-an","-c:v","libx264","-preset","medium","-crf","20",o]); norm.push(o);
    console.log(`      ${path.basename(f)} -> ${path.basename(o)} (${dur(o).toFixed(2)} s)`);});
  fs.writeFileSync(path.join(OUT,"list.txt"),norm.map(f=>`file '${f}'`).join("\n"));
  const cat=path.join(OUT,"concat.mp4");
  ff(["-f","concat","-safe","0","-i",path.join(OUT,"list.txt"),"-c","copy",cat]);
  const dV=dur(cat);
  console.log(`      video concatenee ${dV.toFixed(2)} s | voix ${dVO.toFixed(2)} s`);

  const final=path.join(OUT,"prototype.mp4");
  if(dVO>dV){
    const pad=(dVO-dV+0.4).toFixed(2);
    console.log(`      voix plus longue -> gel de la derniere image ${pad} s (on ne coupe JAMAIS l audio)`);
    ff(["-i",cat,"-i",voFile,"-vf",`tpad=stop_mode=clone:stop_duration=${pad}`,
        "-map","0:v","-map","1:a","-c:v","libx264","-crf","20","-pix_fmt","yuv420p","-c:a","aac","-ar","48000","-ac","2",final]);
  } else {
    ff(["-i",cat,"-i",voFile,"-map","0:v","-map","1:a","-c:v","copy","-c:a","aac","-ar","48000","-ac","2",final]);
  }
  console.log(`\nTERMINE -> ${final}`);
  console.log(`duree finale ${dur(final).toFixed(2)} s | cout phase 2b ${(VO.length/1000*0.005).toFixed(4)} $`);
})();
