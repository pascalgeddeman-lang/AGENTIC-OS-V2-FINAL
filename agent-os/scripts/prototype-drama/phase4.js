const R="/Users/claudiobaldini/Documents/Agentic OS V2/agent-os/";
const fs=require("fs"), path=require("path");
const vault=require(R+"lib/vault.js"), google=require(R+"lib/google.js"), spend=require(R+"lib/spend.js");
const OUT=process.env.OUT;

const KEY=()=>{ const k=vault.get("kie"); if(!k) throw new Error("Cle Kie absente du coffre"); return k; };
async function kieCreate(model,input){
  const r=await fetch("https://api.kie.ai/api/v1/jobs/createTask",{method:"POST",
    headers:{Authorization:`Bearer ${KEY()}`,"Content-Type":"application/json"},
    body:JSON.stringify({model,input})}).then(x=>x.json());
  if(!r.data?.taskId) throw new Error(`Kie ${model} : ${r.msg||JSON.stringify(r).slice(0,200)}`);
  return r.data.taskId;
}
async function kiePoll(taskId,{timeoutMs=12*60*1000,intervalMs=12000}={}){
  const t0=Date.now();
  while(true){
    await new Promise(s=>setTimeout(s,intervalMs));
    if(Date.now()-t0>timeoutMs) throw new Error("Kie : delai depasse");
    const r=await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`,
      {headers:{Authorization:`Bearer ${KEY()}`}}).then(x=>x.json());
    const st=r.data?.state;
    if(st==="success") return JSON.parse(r.data.resultJson).resultUrls[0];
    if(st==="fail") throw new Error(`Kie : echec — ${r.data?.failMsg||"?"}`);
  }
}
async function dl(url,file){ const b=Buffer.from(await (await fetch(url)).arrayBuffer());
  // Kie renvoie du JPEG meme nomme .png -> nommer d apres les octets (lecon Bouddhisme)
  const ext=(b[0]===0xFF&&b[1]===0xD8)?".jpg":".png";
  const f=file.replace(/\.(png|jpg)$/,"")+ext; fs.writeFileSync(f,b); return f; }

// STYLE martele, identique partout — c est lui qui tient la coherence esthetique
const STYLE="Photorealistic cinematic film still, shot on ARRI Alexa with a 50mm anamorphic lens, "+
"natural realistic human skin with visible pores and fine texture, realistic subsurface scattering, "+
"true-to-life hair strands, subtle film grain, professional cinematic color grading, shallow depth of "+
"field with natural bokeh, volumetric lighting, 16:9 widescreen. Absolutely photorealistic live-action "+
"photography — NOT animation, NOT 3D render, NOT CGI, NOT illustration, NOT cartoon, NOT stylised. "+
"No brand names, no trademarks, no logos, no visible commercial branding of any kind.";

// La REFERENCE est le seul endroit ou l on decrit le physique.
const REF_PROMPT=
"Full body character reference photograph, single person centered, neutral standing pose, facing camera, "+
"plain light grey seamless studio backdrop, soft even three-point studio lighting, sharp focus on the face. "+
"A young West African woman, 26 years old, warm deep brown skin with natural texture, short natural black "+
"afro hair held by a thin dark red fabric headband, dark brown eyes, softly rounded cheeks, small nose, "+
"calm determined expression, slim build, average height. She wears a plain faded blue cleaning uniform "+
"tunic over dark navy trousers and worn white canvas sneakers. "+STYLE+
" No text, no logo, no watermark, no border.";

// Les 5 PLANS ne decrivent JAMAIS son physique — la reference est la seule source de verite.
const ANCRE="The character is EXACTLY the same woman as in the reference image: same face, same "+
"hair, same skin, same build. Do not alter her facial features, her hair or her body in any way. ";
const PLANS=[
 {i:1,titre:"Bureau la nuit",p:ANCRE+
  "She wears her faded blue cleaning uniform. She is alone at night mopping the marble floor of a "+
  "vast empty luxury corporate office in Paris, floor-to-ceiling windows behind her showing the lit "+
  "city skyline far below, chairs stacked on desks, a single row of ceiling lights on. Her shoulders "+
  "are low with exhaustion, her gaze down at the floor. Wide shot, camera slightly low, cool blue "+
  "night light from the windows mixed with warm ceiling light. Quiet, lonely, dignified mood. "+STYLE},
 {i:2,titre:"Les moqueries",p:ANCRE+
  "She wears her faded blue cleaning uniform and holds a folded cloth against her chest. She stands "+
  "in a bright corridor of a luxury fashion house while two elegantly dressed women in designer suits "+
  "walk past her laughing behind their hands, looking at her sideways with contempt. She lowers her "+
  "eyes and steps aside against the wall. Medium shot centred on her, the two women slightly out of "+
  "focus in the foreground. Bright cold daylight, glossy white walls. Humiliating, tense mood. "+STYLE},
 {i:3,titre:"Le talent cache",p:ANCRE+
  "She wears her faded blue cleaning uniform, sitting alone on a concrete service staircase, a small "+
  "worn sketchbook open on her knees. She is drawing an elegant evening gown that mixes modern "+
  "couture lines with African wax patterns, a pencil in her hand, completely absorbed, a faint proud "+
  "smile on her lips. Close shot from the side, the sketch clearly visible on the page. Warm golden "+
  "light falling from a small high window. Intimate, hopeful, secret mood. "+STYLE},
 {i:4,titre:"L humiliation",p:ANCRE+
  "She wears her faded blue cleaning uniform. Her sketchbook has been thrown on the polished floor of "+
  "an open plan office, its loose drawings scattered around her feet. She is on one knee gathering "+
  "the pages, her face lifted, eyes wet but jaw set with contained anger. Above her an older elegant "+
  "woman in a sharp cream suit looks down at her with cold disdain, arms crossed. Low angle shot from "+
  "the floor. Harsh overhead lighting, strong shadows. Cruel, pivotal, charged mood. "+STYLE},
 {i:5,titre:"Le renversement",p:ANCRE+
  "She now wears an elegant tailored deep emerald green dress with subtle African wax trim and small "+
  "gold earrings, standing tall and confident in her own bright fashion atelier. Behind her a mannequin "+
  "displays the finished evening gown from her sketch, rolls of colourful fabric line the walls, and "+
  "large windows show Paris rooftops. She looks directly at the camera with a calm proud smile, chin "+
  "up. Medium wide shot, camera slightly low to make her dominant. Warm triumphant golden hour light. "+
  "Successful, victorious, radiant mood. "+STYLE},
];

async function pool(items,worker,n=3){
  const out=[]; let i=0;
  await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{
    while(i<items.length){ const k=i++; try{ out[k]=await worker(items[k]); }catch(e){ out[k]={error:e.message,plan:items[k]}; } }
  }));
  return out;
}

(async()=>{
  console.log("PHASE 4 — variante HYPER-REALISTE : reference + 5 plans i2i (gpt-image-2)\n");

  console.log("[1/3] Generation de la REFERENCE 16:9 (gpt-image-2-text-to-image)…");
  const refTask=await kieCreate("gpt-image-2-text-to-image",{prompt:REF_PROMPT,aspect_ratio:"16:9",resolution:"1K"});
  const refUrl=await kiePoll(refTask);
  const refFile=await dl(refUrl,path.join(OUT,"reel-reference"));
  spend.record("Kie.ai","Prototype Drama",0.03,"USD","Reference personnage (reel)");
  console.log("      -> "+refFile);

  console.log("[2/3] Upload public sur Drive (necessaire pour l i2i)…");
  const up=await google.driveUpload("proto-drama-reel-ref"+path.extname(refFile),
    path.extname(refFile)===".jpg"?"image/jpeg":"image/png", fs.readFileSync(refFile));
  console.log("      -> "+up.directUrl);

  console.log("[3/3] 5 plans i2i ancres sur la reference (pool de 3)…");
  const res=await pool(PLANS, async(pl)=>{
    const t=await kieCreate("gpt-image-2-image-to-image",
      {prompt:pl.p, input_urls:[up.directUrl], aspect_ratio:"16:9", resolution:"1K"});
    const u=await kiePoll(t);
    const f=await dl(u,path.join(OUT,`reel-plan-${pl.i}`));
    spend.record("Kie.ai","Prototype Drama",0.03,"USD",`Plan reel ${pl.i} — ${pl.titre}`);
    console.log(`      plan ${pl.i} (${pl.titre}) -> ${path.basename(f)}`);
    return {i:pl.i,titre:pl.titre,file:f};
  },3);

  fs.writeFileSync(path.join(OUT,"phase4.json"),JSON.stringify({refFile,refUrl:up.directUrl,plans:res},null,1));
  const ok=res.filter(r=>!r.error).length;
  console.log(`\nTERMINE : ${ok}/5 plans generes. Cout ~${((1+ok)*0.03).toFixed(2)} $`);
  for(const r of res) if(r.error) console.log("  ECHEC plan",r.plan?.i,":",r.error);
})();
