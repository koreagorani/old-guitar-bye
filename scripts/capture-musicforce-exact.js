const queries=[
  ["MUSICFORCE_GCL80","Crafter GCL-80"],
  ["MUSICFORCE_OMEGA","Crafter OMEGA CSP PLUS"],
  ["MUSICFORCE_VC01","Segovia VC01"],
];
function around(html,p,r=1600){const i=html.search(p);return i<0?null:html.slice(Math.max(0,i-r),Math.min(html.length,i+r));}
for(const [name,q] of queries){
 const url=new URL("https://www.musicforce.co.kr/product/search.html");
 url.searchParams.set("keyword",q);
 try{
  const res=await fetch(url,{headers:{Accept:"text/html,application/xhtml+xml","User-Agent":"old-guitar-bye/0.1 retail-source-poc"},redirect:"follow",signal:AbortSignal.timeout(15000)});
  const html=await res.text();
  console.log("MUSICFORCE_EXACT="+JSON.stringify({name,status:res.status,htmlLength:html.length,signals:{productDetail:(html.match(/product\/detail\.html/gi)||[]).length,salePrice:(html.match(/판매가/g)||[]).length,soldOut:(html.match(/(?:품절|SOLD\s*OUT)/gi)||[]).length},snippets:{gcl:around(html,/GCL[-\s]*80/i),omega:around(html,/OMEGA\s*CSP\s*PLUS/i),vc01:around(html,/VC[-\s]*01/i)}}));
 }catch(e){console.log("MUSICFORCE_EXACT="+JSON.stringify({name,success:false,error:e?.message??String(e)}));}
}
