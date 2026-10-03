const requests = [
  ["BUZZBEE_GCL80", "https://www.buzzbee.co.kr/goods/goods_search.php?keyword=Crafter%20GCL-80"],
  ["BUZZBEE_OMEGA", "https://www.buzzbee.co.kr/goods/goods_search.php?keyword=Crafter%20OMEGA%20CSP%20PLUS"],
  ["BUZZBEE_VC01", "https://www.buzzbee.co.kr/goods/goods_search.php?keyword=Segovia%20VC01"],
  ["GOPHERWOOD_G110", "https://www.gopherwood.co.kr/product/search.html?keyword=G110"],
];

function around(html, pattern, radius=1400) {
  const i=html.search(pattern);
  return i<0 ? null : html.slice(Math.max(0,i-radius), Math.min(html.length,i+radius));
}

for (const [name,url] of requests) {
  try {
    const response=await fetch(url,{
      headers:{
        Accept:"text/html,application/xhtml+xml",
        "User-Agent":"old-guitar-bye/0.1 retail-source-poc",
      },
      redirect:"follow",
      signal:AbortSignal.timeout(15000),
    });
    const html=await response.text();
    console.log("RETAIL_SOURCE_CAPTURE="+JSON.stringify({
      name,
      status:response.status,
      ok:response.ok,
      finalUrl:response.url,
      htmlLength:html.length,
      productSignals:{
        goodsNo:(html.match(/goodsNo=/g)||[]).length,
        productNo:(html.match(/product_no=/g)||[]).length,
        price:(html.match(/(?:판매가|판매가격)/g)||[]).length,
        soldOut:(html.match(/(?:품절|SOLD\s*OUT)/gi)||[]).length,
      },
      snippets:{
        gcl:around(html,/GCL[-\s]*80/i),
        omega:around(html,/OMEGA\s*CSP\s*PLUS/i),
        vc01:around(html,/VC[-\s]*01/i),
        g110:around(html,/G110/i),
      },
    }));
  } catch(error) {
    console.log("RETAIL_SOURCE_CAPTURE="+JSON.stringify({
      name, success:false, name2:error?.name, message:error?.message
    }));
  }
}
