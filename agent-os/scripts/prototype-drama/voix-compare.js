/** Comparatif de voix francaises : les 3 autres Inworld + 4 ElevenLabs v3. */
const R="/Users/claudiobaldini/Documents/Agentic OS V2/agent-os/";
const fs=require("fs"),path=require("path"),{execFileSync}=require("child_process");
const fal=require(R+"lib/fal.js"),spend=require(R+"lib/spend.js");
const OUT=process.env.OUT;
const dur=(f)=>Number(execFileSync("ffprobe",["-v","error","-show_entries","format=duration","-of","csv=p=0",f]).toString().trim());

const TXT="Il est deux heures du matin. Aminata nettoie des bureaux qu'elle ne verra jamais en plein jour. "+
          "Ce qu'elles ignorent, c'est que dans la cage d'escalier, Aminata dessine des robes.";

const INWORLD=["Hélène (fr)","Mathieu (fr)","Étienne (fr)"];      // Alain deja entendu
const ELEVEN =["George","Brian","Charlotte","Daniel"];             // v3 est multilingue

(async()=>{
  const dir=path.join(OUT,"voix"); fs.mkdirSync(dir,{recursive:true});
  console.log(`Phrase de test (${TXT.length} car.) :\n  « ${TXT} »\n`);

  console.log("--- INWORLD (0,01 $/1000 car.) ---");
  for(const v of INWORLD){
    try{
      const r=await fal.run("fal-ai/inworld-tts",{text:TXT,voice:v,sample_rate_hertz:48000});
      if(!r.audio?.url){ console.log(`  ${v} : aucun audio`); continue; }
      const f=path.join(dir,`inworld-${v.split(" ")[0].replace(/[^\w]/g,"")}.mp3`);
      await fal.download(r.audio.url,f);
      spend.record("FAL.ai","Prototype Drama",TXT.length/1000*0.01,"USD",`Test voix ${v}`);
      const d=dur(f), mots=TXT.split(/\s+/).length;
      console.log(`  ${v.padEnd(16)} -> ${path.basename(f).padEnd(22)} ${d.toFixed(2)} s (${Math.round(mots/(d/60))} mots/min)`);
    }catch(e){ console.log(`  ${v} : ECHEC ${e.message}`); }
  }

  console.log("\n--- ELEVENLABS v3 (0,10 $/1000 car. — 10x plus cher, catalogue immense) ---");
  for(const v of ELEVEN){
    try{
      const r=await fal.run("fal-ai/elevenlabs/tts/eleven-v3",{text:TXT,voice:v});
      const url=r.audio?.url;
      if(!url){ console.log(`  ${v} : aucun audio — ${JSON.stringify(r).slice(0,180)}`); continue; }
      const f=path.join(dir,`eleven-${v}.mp3`);
      await fal.download(url,f);
      spend.record("FAL.ai","Prototype Drama",TXT.length/1000*0.10,"USD",`Test voix ElevenLabs ${v}`);
      const d=dur(f), mots=TXT.split(/\s+/).length;
      console.log(`  ${v.padEnd(16)} -> ${path.basename(f).padEnd(22)} ${d.toFixed(2)} s (${Math.round(mots/(d/60))} mots/min)`);
    }catch(e){ console.log(`  ${v} : ECHEC ${e.message}`); }
  }
  console.log(`\n-> ${dir}`);
})();
