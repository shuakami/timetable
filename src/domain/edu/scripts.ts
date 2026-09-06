/**
 * 注入到学校页面里执行的脚本。每段都是一个 async 函数体，返回值经 TtBridge.post 回传。
 * 只在用户点「导入」（以及进入课表页后探测课程数）时执行；不读表单、不读 Cookie。
 */

export interface ProbeResult {
  url: string
  title: string
  /** 页面上有像课表的表格（表头带星期） */
  table: boolean
  /** 正方新版课表页的学年/学期下拉 */
  zf: { xnm: string[]; xqm: string[]; sel: { xnm: string; xqm: string } } | null
}

export const PROBE_JS = `
var r = { url: location.href, title: document.title, table: false, zf: null };
var ts = document.getElementsByTagName('table');
for (var i = 0; i < ts.length; i++) {
  if (/星期|周一|Monday|Mon\\b/i.test(ts[i].innerText || '')) { r.table = true; break; }
}
var xn = document.getElementById('xnm'), xq = document.getElementById('xqm');
if (xn && xq && xn.tagName === 'SELECT' && xq.tagName === 'SELECT') {
  var opt = function (sel) {
    return Array.prototype.map.call(sel.options, function (o) { return String(o.value || '').trim(); })
      .filter(function (v) { return v !== ''; });
  };
  r.zf = { xnm: opt(xn), xqm: opt(xq), sel: { xnm: String(xn.value || ''), xqm: String(xq.value || '') } };
}
return r;
`

/** 正方新版：POST 个人课表接口，只回传排课字段 */
export function zfFetchJs(xnm: string, xqm: string): string {
  const body = `xnm=${encodeURIComponent(xnm)}&xqm=${encodeURIComponent(xqm)}`
  return `
var p = location.pathname, i = p.indexOf('/jwglxt/');
var base = i >= 0 ? p.slice(0, i) : '';
var res = await fetch(base + '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N253508', {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
  body: ${JSON.stringify(body)}
});
if (!res.ok) throw new Error('HTTP ' + res.status);
var j = await res.json();
var list = (j && j.kbList) || [];
return list.map(function (c) { return { kcmc: c.kcmc, xm: c.xm, cdmc: c.cdmc, xqj: c.xqj, jcs: c.jcs, zcd: c.zcd }; });
`
}

/** 当前页面 HTML，给通用表格解析 */
export const PAGE_HTML_JS = `return document.documentElement.outerHTML;`

/** 当前页面可见文字，给「让 AI 转换」 */
export const PAGE_TEXT_JS = `return (document.body && document.body.innerText) || '';`

/**
 * 把函数体包成一次性调用：结果经 TtBridge.post 回传 { id, ok, r | e }。
 * 同步异常和 Promise 拒绝都收进 e。
 */
export function wrapRun(id: string, body: string): string {
  return `(function(){var __id=${JSON.stringify(id)};function __post(o){try{TtBridge.post(JSON.stringify(o))}catch(e){}}
try{Promise.resolve((async function(){${body}\n})()).then(function(r){__post({id:__id,ok:true,r:r===undefined?null:r})},function(e){__post({id:__id,ok:false,e:String((e&&e.message)||e)})})}
catch(e){__post({id:__id,ok:false,e:String((e&&e.message)||e)})}})();`
}

/** 正方课表页下拉 → 可选学期：当前学年与上一学年，最新的排前 */
export function zfTermOptions(zf: NonNullable<ProbeResult['zf']>): { xnm: string; xqm: string }[] {
  const years = zf.xnm.map(Number).filter((y) => Number.isFinite(y)).sort((a, b) => b - a)
  const cur = Number(zf.sel.xnm)
  const pick = Number.isFinite(cur) && years.includes(cur) ? years.filter((y) => y === cur || y === cur - 1) : years.slice(0, 2)
  const order = ['3', '12', '16']
  const xqms = [...zf.xqm].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  const out: { xnm: string; xqm: string }[] = []
  for (const y of pick) for (const q of xqms) out.push({ xnm: String(y), xqm: q })
  return out
}
