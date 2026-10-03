const url="https://www.gopherwood.co.kr/product/search.html?keyword=G110";
const res=await fetch(url,{headers:{Accept:"text/html,application/xhtml+xml","User-Agent":"old-guitar-bye/0.1 gopherwood-parser-poc"},redirect:"follow",signal:AbortSignal.timeout(15000)});
const html=await res.text();
function snippets(pattern,count=4,radius=2200){
  const out=[]; let start=0;
  while(out.length<count){const m=pattern.exec(html.slice(start)); if(!m) break; const idx=start+m.index; out.push(html.slice(Math.max(0,idx-radius),Math.min(html.length,idx+radius))); start=idx+m[0].length;}
  return out;
}
console.log("GOPHERWOOD_STRUCTURE="+JSON.stringify({
 status:res.status,htmlLength:html.length,
 signals:{
  anchorBox:(html.match(/anchorBoxId_/g)||[]).length,
  prdName:(html.match(/class=["'][^"']*name[^"']*["']/g)||[]).length,
  productHref:(html.match(/href=["'][^"']*\/product\//g)||[]).length,
  salePrice:(html.match(/판매가/g)||[]).length,
 },
 g110:snippets(/Gopherwood\s+G110/gi,6),
 anchor:snippets(/anchorBoxId_/gi,3)
}));
