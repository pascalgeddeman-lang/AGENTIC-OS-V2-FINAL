/**
 * PHASE 7 — la scène dans la GRAMMAIRE validée par la phase 6 :
 *   plan 1 : large à deux, MUET, sous voix off du conteur  (clip réutilisé)
 *   plan 2 : rapproché FRONTAL sur l'antagoniste, voix Charlotte + lipsync  (nouveau)
 *   plan 3 : contrechamp Aminata, lipsync déjà validé      (réutilisé)
 * Règle d'or : chaque plan dure le temps de SA phrase ; on n'ajuste que la vidéo.
 */
const R="/Users/claudiobaldini/Documents/Agentic OS V2/agent-os/";
const fs=require("fs"),path=require("path"),{execFileSync}=require("child_process");
const vault=require(R+"lib/vault.js"),google=require(R+"lib/google.js"),fal=require(R+"lib/fal.js"),spend=require(R+"lib/spend.js");
const voices=require(R+"lib/voices.js");
const OUT=process.env.OUT, DIR=path.join(OUT,"dialogue");
const P1=JSON.parse(fs.readFileSync(path.join(OUT,"phase1.json"),"utf8"));

const KEY=()=>vault.get("kie");
const FATAL=/must be|invalid|unauthorized|not found|bad request|required/i;
async function kieCreate(m,i){const r=await fetch("https://api.kie.ai/api/v1/jobs/createTask",{method:"POST",
 headers:{Authorization:`Bearer ${KEY()}`,"Content-Type":"application/json"},body:JSON.stringify({model:m,input:i})}).then(x=>x.json());
 if(!r.data?.taskId) throw new Error(`Kie ${m}: ${r.msg||JSON.stringify(r).slice(0,200)}`); return r.data.taskId;}
async function kiePoll(t,{timeoutMs=15*60*1000,intervalMs=12000}={}){const t0=Date.now();
 while(true){await new Promise(s=>setTimeout(s,intervalMs)); if(Date.now()-t0>timeoutMs) throw new Error("Kie: delai depasse");
  const r=await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${t}`,{headers:{Authorization:`Bearer ${KEY()}`}}).then(x=>x.json());
  if(r.data?.state==="success") return JSON.parse(r.data.resultJson).resultUrls[0];
  if(r.data?.state==="fail") throw new Error("Kie: "+(r.data?.failMsg||"?"));}}
async function kieRetry(model,input,tries=2){let last;
  for(let i=1;i<=tries;i++){ try{ return await kiePoll(await kieCreate(model,input)); }
    catch(e){ last=e; if(FATAL.test(e.message)){console.log("      erreur DETERMINISTE : "+e.message);throw e;}
      console.log(`      tentative ${i} echouee — relance`);}}
  throw last;}
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
async function pub(n,m,f,tries=3){let last;
  for(let i=1;i<=tries;i++){ try{ const u=await google.driveUpload(n,m,fs.readFileSync(f));
      await google.ensurePublic(u.id).catch(()=>{}); return `https://drive.google.com/uc?export=download&id=${u.id}`; }
    catch(e){ last=e; console.log(`      upload ${i}/${tries} echoue : ${e.message.slice(0,60)}`); if(i<tries) await new Promise(r=>setTimeout(r,4000*i)); } }
  throw new Error("Upload Drive impossible : "+last.message.slice(0,100));}

const STYLE="Modern 3D animated feature film style, Pixar and DreamWorks quality rendering, "+
"expressive character animation with large detailed eyes, soft cinematic subsurface skin shading, "+
"rich warm color grading, volumetric lighting, shallow depth of field, high production value, "+
"16:9 cinematic framing. No brand names, no trademarks, no logos.";
const NOSPEAK="ABSOLUTELY NO SPEECH, no talking, no lip movement, no dialogue, no voice. ";

// ⚠ CADRAGE IMPOSÉ par la phase 6 : hors plan rapproché quasi frontal, le lipsync ne rend RIEN.
const P_ANTA_CU="The character is EXACTLY the same woman as in the reference image: same face, same "+
 "silver-grey bob, same pale skin, same pearl necklace, same cream tailored suit. Do not alter her "+
 "features in any way. MEDIUM CLOSE-UP on her head and shoulders, she faces the camera almost "+
 "frontally, only very slightly turned, her whole face and mouth clearly visible and well lit, "+
 "chin raised, eyes narrowed with cold contempt as she speaks down at someone just off camera. "+
 "Open plan office at dusk blurred behind her, harsh overhead light. Imperious, cutting, tense. "+STYLE;

const LIGNES=[
 {plan:1, clip:"clip-A.mp4",  qui:"Conteur",   lipsync:false,
  texte:"Ce soir-là, madame Delacroix crut que cette phrase ne lui coûterait rien."},
 {plan:2, clip:null,          qui:"Charlotte", lipsync:true,
  texte:"Vous nettoyez les bureaux. Vous ne dessinez pas. Chacun sa place."},
 {plan:3, clip:"__segB__",    qui:"Aminata",   lipsync:false, // seg-B est DÉJÀ lipsyncé
  texte:null},
];

(async()=>{
  console.log("PHASE 7 — scene en 3 plans, grammaire champ-contrechamp\n");
  const lib=voices.list();
  const vOf=(n)=>{ const v=lib.find(x=>x.name===n)||lib.find(x=>x.name.startsWith(n));
    if(!v) throw new Error("Voix introuvable : "+n); return v; };

  // --- plan 2 : nouvelle image rapprochee frontale ---
  console.log("[1/4] Plan 2 — antagoniste en plan rapproche FRONTAL…");
  let img=path.join(DIR,"plan-C-anta-frontal.png");
  if(fs.existsSync(img)) console.log("      deja genere, reutilise");
  else{
    const antaUrl=await pub("proto-ref-anta2.png","image/png",path.join(DIR,"ref-antagoniste.png"));
    img=await dl(await kieRetry("gpt-image-2-image-to-image",
      {prompt:P_ANTA_CU,input_urls:[antaUrl],aspect_ratio:"16:9",resolution:"1K"}), path.join(DIR,"plan-C-anta-frontal"));
    spend.record("Kie.ai","Prototype Drama",0.03,"USD","Plan C (antagoniste frontal)");
  }
  console.log("      -> "+path.basename(img));

  console.log("[2/4] Clip Grok muet du plan 2…");
  let clipC=path.join(DIR,"clip-C.mp4");  // .mp4 desormais respecte par dl()
  if(fs.existsSync(clipC)) console.log("      deja present, reutilise");
  else{
    const u=await pub("proto-planC"+path.extname(img), path.extname(img)===".jpg"?"image/jpeg":"image/png", img);
    clipC=await dl(await kieRetry("grok-imagine-video-1-5-preview",
      {prompt:NOSPEAK+"Cinematic 3D animated shot. Very slow dolly push-in on her face, she remains still and "+
       "imperious, only a slight narrowing of the eyes and a faint lift of the chin. Harsh office light. "+
       "Keep the character exactly identical to the source image at all times. "+NOSPEAK,
       image_urls:[u+"&r="+Date.now().toString(36)],duration:6,resolution:"720p",aspect_ratio:"16:9"}), clipC);
    spend.record("Kie.ai","Prototype Drama",6*0.015,"USD","Clip C (antagoniste frontal)");
  }
  console.log(`      -> ${dur(clipC).toFixed(2)} s`);

  console.log("[3/4] Voix + lipsync…");
  const segs=[];
  for(const L of LIGNES){
    if(L.plan===3){ segs.push(path.join(DIR,"seg-B.mp4")); console.log("      plan 3 : seg-B reutilise (lipsync deja valide)"); continue; }
    const v=vOf(L.qui);
    const r=await fal.run("fal-ai/elevenlabs/tts/eleven-v3",{text:L.texte,voice:v.ref});
    if(!r.audio?.url) throw new Error("TTS "+L.qui);
    const aud=path.join(DIR,`p7-voix-${L.plan}.mp3`); await fal.download(r.audio.url,aud);
    spend.record("FAL.ai","Prototype Drama",L.texte.length/1000*0.10,"USD",`Voix plan ${L.plan} (${L.qui})`);
    const dA=dur(aud), src=L.plan===1?path.join(DIR,L.clip):clipC, dV=dur(src);
    const mots=L.texte.split(/\s+/).length;
    console.log(`      plan ${L.plan} ${L.qui.padEnd(10)} ${mots} mots, ${dA.toFixed(2)} s (${Math.round(mots/(dA/60))} mpm) | clip ${dV.toFixed(2)} s`);

    const base=path.join(DIR,`p7-base-${L.plan}.mp4`);
    if(dA>dV) ff(["-i",src,"-vf",`setpts=${(dA/dV).toFixed(4)}*PTS`,"-an","-c:v","libx264","-crf","20",base]);
    else      ff(["-i",src,"-t",dA.toFixed(3),"-an","-c:v","libx264","-crf","20",base]);

    const out=path.join(DIR,`p7-seg-${L.plan}.mp4`);
    if(L.lipsync){
      const vUrl=await pub(`p7-base-${L.plan}.mp4`,"video/mp4",base);
      const aUrl=await pub(`p7-aud-${L.plan}.mp3`,"audio/mpeg",aud);
      const res=await fal.run("veed/lipsync",{video_url:vUrl,audio_url:aUrl},{timeoutMs:12*60*1000});
      const lu=res?.video?.url||res?.video_url; if(!lu) throw new Error("Lipsync plan "+L.plan);
      const tmp=path.join(DIR,`p7-lip-${L.plan}.mp4`); await fal.download(lu,tmp);
      ff(["-i",tmp,"-i",aud,"-map","0:v:0","-map","1:a:0","-c:v","libx264","-crf","20","-r","30",
          "-vf","scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:-1:-1,setsar=1","-c:a","aac","-b:a","192k",out]);
      fs.unlinkSync(tmp);
      spend.record("FAL.ai","Prototype Drama",(dA/60)*0.40,"USD",`Lipsync plan ${L.plan}`);
      console.log(`      plan ${L.plan} lipsync OK`);
    } else {
      ff(["-i",base,"-i",aud,"-map","0:v:0","-map","1:a:0","-c:v","libx264","-crf","20","-r","30",
          "-vf","scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:-1:-1,setsar=1","-c:a","aac","-b:a","192k",out]);
      console.log(`      plan ${L.plan} voix off (pas de lipsync : personne ne parle a l image)`);
    }
    segs.push(out);
  }
  segs.sort((a,b)=>a.localeCompare(b));
  const ordered=[path.join(DIR,"p7-seg-1.mp4"),path.join(DIR,"p7-seg-2.mp4"),path.join(DIR,"seg-B.mp4")];

  console.log("[4/4] Montage…");
  const norm=ordered.map((f,i)=>{const o=path.join(DIR,`p7-n${i}.mp4`);
    ff(["-i",f,"-r","30","-vf","scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:-1:-1,setsar=1",
        "-c:v","libx264","-crf","20","-c:a","aac","-b:a","192k","-ar","48000","-ac","2",o]); return o;});
  fs.writeFileSync(path.join(DIR,"p7-list.txt"),norm.map(f=>`file '${f}'`).join("\n"));
  const final=path.join(DIR,"scene-3-plans.mp4");
  ff(["-f","concat","-safe","0","-i",path.join(DIR,"p7-list.txt"),"-c","copy",final]);
  console.log(`\nTERMINE -> ${final} (${dur(final).toFixed(2)} s)`);
  ordered.forEach((f,i)=>console.log(`   plan ${i+1} : ${path.basename(f).padEnd(16)} ${dur(f).toFixed(2)} s`));
})();
