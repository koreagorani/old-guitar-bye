const requests = [
  ["BUZZBEE_CORT", "https://www.buzzbee.co.kr/goods/goods_search.php?keyword=Cort"],
  ["BUZZBEE_CRAFTER", "https://www.buzzbee.co.kr/goods/goods_search.php?keyword=Crafter"],
  ["BUZZBEE_GOPHERWOOD", "https://www.buzzbee.co.kr/goods/goods_search.php?keyword=Gopherwood"],
  ["BUZZBEE_HEX", "https://www.buzzbee.co.kr/goods/goods_search.php?keyword=HEX"],
  ["MUSICFORCE_CORT", "https://www.musicforce.co.kr/product/search.html?banner_action=&keyword=Cort"],
];

function around(html, pattern, radius=1800) {
  const i=html.search(pattern);
  return i<0 ? null : html.slice(Math.max(0,i-radius), Math.min(html.length,i+radius));
}
for (const [name,url] of requests) {
  try {
    const response=await fetch(url,{headers:{Accept:"text/html,application/xhtml+xml","User-Agent":"old-guitar-bye/0.1 retail-source-poc"},redirect:"follow",signal:AbortSignal.timeout(15000)});
    const html=await response.text();
    console.log("RETAIL_BRAND_CAPTURE="+JSON.stringify({
      name,status:response.status,ok:response.ok,finalUrl:response.url,htmlLength:html.length,
      signals:{
        goodsView:(html.match(/goods_view\.php/gi)||[]).length,
        productDetail:(html.match(/product\/detail\.html/gi)||[]).length,
        salesPrice:(html.match(/판매가/g)||[]).length,
        soldOut:(html.match(/(?:품절|SOLD\s*OUT)/gi)||[]).length,
      },
      snippets:{
        earth100:around(html,/Earth\s*100/i),
        g110:around(html,/G110/i),
        f100:around(html,/F100/i),
        dx25:around(html,/DX[-\s]*25/i),
      }
    }));
  } catch(error) {
    console.log("RETAIL_BRAND_CAPTURE="+JSON.stringify({name,success:false,error:error?.message??String(error)}));
  }
}
