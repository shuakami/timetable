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
  /** 强智课表表（#kbtable / .kbcontent）在主文档或同源框架里的位置；没有为 null */
  qz: { url: string; title: string } | null
}

export const PROBE_JS = `
var r = { url: location.href, title: document.title, table: false, zf: null, qz: null };
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
/* 强智教务：课表常在 xsMain.jsp 的同源框架里，主文档地址不变，只能探框架 */
var qzHit = function (d) {
  if (!d || !d.querySelector) return false;
  if (d.querySelector('table#kbtable')) return true;
  var qts = d.getElementsByTagName('table');
  for (var j = 0; j < qts.length; j++) {
    if (qts[j].querySelector('.kbcontent') || qts[j].querySelector('.kbcontent1')) return true;
  }
  return false;
};
if (qzHit(document)) r.qz = { url: location.href, title: document.title };
else {
  var qfs = document.querySelectorAll('iframe,frame');
  for (var k = 0; k < qfs.length; k++) {
    try {
      var qd = qfs[k].contentDocument;
      if (qd && qzHit(qd)) { r.qz = { url: qd.location.href, title: qd.title || '' }; break; }
    } catch (e) {}
  }
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

/**
 * 强智教务课表提取：在主文档和同源框架里找 `table#kbtable`（退回含 .kbcontent 的表），
 * 框架可能还在加载，轮询到上限；周次下拉不是「全部」时按表单同款参数重取一遍未筛选课表。
 * 只读课表结构与下拉值；不读表单输入、不读 Cookie。
 */
export interface QzTableResult {
  /** table#kbtable 的 outerHTML；没找到为 null */
  html: string | null
  /** 课表所在框架地址 */
  url: string
  title: string
  /** 学年学期下拉当前选中项文本，如 "2026-2027-1" */
  term: string
  /** 页面像登录页（有密码框） */
  login: boolean
  /** 周次下拉被筛选过 */
  filtered: boolean
  /** 已用未筛选参数重取成功 */
  refetched: boolean
}

export const QZ_TABLE_JS = `
var docs = function () {
  var out = [document];
  var fs = document.querySelectorAll('iframe,frame');
  for (var i = 0; i < fs.length; i++) {
    try { var d = fs[i].contentDocument; if (d && d.location) out.push(d); } catch (e) {}
  }
  return out;
};
var findTable = function (d) {
  var t = d.querySelector('table#kbtable');
  if (t) return t;
  var ts = d.getElementsByTagName('table');
  for (var i = 0; i < ts.length; i++) {
    if (ts[i].querySelector('.kbcontent') || ts[i].querySelector('.kbcontent1')) return ts[i];
  }
  return null;
};
var doc = null, tb = null;
var deadline = Date.now() + 12000;
for (;;) {
  var ds = docs();
  for (var i = 0; i < ds.length; i++) { tb = findTable(ds[i]); if (tb) { doc = ds[i]; break; } }
  if (tb || Date.now() >= deadline) break;
  await new Promise(function (r) { setTimeout(r, 400); });
}
var out = { html: null, url: location.href, title: document.title, term: '', login: false, filtered: false, refetched: false };
if (!doc || !tb) {
  var ls = docs();
  for (var i = 0; i < ls.length; i++) {
    try { if (ls[i].querySelector('input[type="password"]')) out.login = true; } catch (e) {}
  }
  return out;
}
var sel = doc.getElementById ? doc.getElementById('xnxq01id') : null;
if (sel && sel.options && sel.selectedIndex >= 0) out.term = String(sel.options[sel.selectedIndex].text || '').trim();
var zc = doc.getElementById ? doc.getElementById('zc') : null;
out.filtered = !!(zc && zc.value);
if (out.filtered) {
  try {
    var kbj = doc.getElementById('kbjcmsid');
    var qs = 'zc=&demo=&xnxq01id=' + encodeURIComponent(sel ? sel.value : '') +
      '&kbjcmsid=' + encodeURIComponent(kbj ? kbj.value : '');
    var url = doc.location.href;
    var res = await fetch(url, { method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs + '&sfFD=1' });
    if (!res.ok) res = await fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + qs, { credentials: 'include' });
    if (res.ok) {
      var nd = new DOMParser().parseFromString(await res.text(), 'text/html');
      var nt = findTable(nd);
      if (nt) { tb = nt; out.refetched = true; }
    }
  } catch (e) {}
}
out.html = tb.outerHTML;
out.url = doc.location.href;
out.title = doc.title || '';
return out;
`

/** 页面调试包用：主文档与同源子框架的 HTML、编码、文档类型 */
export interface PageCapture {
  url: string
  title: string
  charset: string
  contentType: string
  readyState: string
  userAgent: string
  html: string
  frames: { src: string; name: string; url: string; charset: string; html: string | null; error: string }[]
}

export const PAGE_CAPTURE_JS = `
var out = {
  url: location.href, title: document.title, charset: document.characterSet || '', contentType: document.contentType || '',
  readyState: document.readyState, userAgent: navigator.userAgent,
  html: document.documentElement ? document.documentElement.outerHTML : '', frames: []
};
var fs = document.querySelectorAll('iframe,frame');
for (var i = 0; i < fs.length; i++) {
  var f = fs[i];
  var item = { src: f.getAttribute('src') || '', name: f.getAttribute('name') || f.id || '', url: '', charset: '', html: null, error: '' };
  try {
    var d = f.contentDocument;
    if (d) {
      item.url = d.location.href; item.charset = d.characterSet || '';
      item.html = d.documentElement ? d.documentElement.outerHTML : '';
    } else item.error = 'no document';
  } catch (e) { item.error = String((e && e.message) || e); }
  out.frames.push(item);
}
return out;
`

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
