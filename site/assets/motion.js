/* 嘎嘎课程表 · 首页动效
   纸上的字和截图是印好的，页面打开就在那里，不浮、不淡、不落。
   唯一会动的是那支笔：引线、圆圈、汇入线、尺子，按阅读顺序画出来。
   外加一次吉祥物探头。 */

(function () {
  "use strict";

  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Lenis ---------- */
  var lenis = new Lenis({ duration: 1.1, smoothWheel: true });
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    var href = a.getAttribute("href");
    if (href.length < 2) return;
    var target = document.querySelector(href);
    if (!target) return;
    a.addEventListener("click", function (e) {
      e.preventDefault();
      lenis.scrollTo(target, { offset: -12 });
    });
  });

  if (reduce || typeof gsap === "undefined") {
    (function raf(t) {
      lenis.raf(t);
      requestAnimationFrame(raf);
    })(0);
    return;
  }

  gsap.registerPlugin(ScrollTrigger, CustomEase);
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add(function (t) {
    lenis.raf(t * 1000);
  });
  gsap.ticker.lagSmoothing(0);

  /* ---------- 曲线 ----------
     pen ：笔画起落（quart in‑out），起笔慢、收笔慢。
     tip ：箭头尖、刻度这种短促一笔（quart out）。
     peek：吉祥物探头，只允许 2% 过冲。 */
  CustomEase.create("pen", "0.77, 0, 0.175, 1");
  CustomEase.create("tip", "0.165, 0.84, 0.44, 1");
  CustomEase.create("peek", "M0,0 C0.2,0.8 0.32,1.04 0.55,1.02 C0.68,1.01 0.8,1 1,1");

  var SVG_NS = "http://www.w3.org/2000/svg";
  var uid = 0;

  function visible(el) {
    return el.getClientRects().length > 0;
  }

  /* 把一条（虚线）路径变成可"画出来"的：
     用同形状的实线蒙版遮住原路径，动蒙版的 dashoffset，虚线就从起点逐段显现。 */
  function penPath(path) {
    if (!path) return null;
    var svg = path.ownerSVGElement;
    if (!svg || !visible(svg)) return null;
    var len = path.getTotalLength();
    if (!len) return null;

    var vb = svg.viewBox.baseVal;
    var id = "pen-" + ++uid;
    var mask = document.createElementNS(SVG_NS, "mask");
    mask.setAttribute("id", id);
    mask.setAttribute("maskUnits", "userSpaceOnUse");
    mask.setAttribute("x", vb.x - 40);
    mask.setAttribute("y", vb.y - 40);
    mask.setAttribute("width", vb.width + 80);
    mask.setAttribute("height", vb.height + 80);

    var cover = document.createElementNS(SVG_NS, "path");
    cover.setAttribute("d", path.getAttribute("d"));
    var sw = parseFloat(getComputedStyle(path).strokeWidth) || 2;
    cover.setAttribute("fill", "none");
    cover.setAttribute("stroke", "#fff");
    cover.setAttribute("stroke-width", sw * 3);
    cover.setAttribute("stroke-linecap", "round");
    cover.setAttribute("stroke-linejoin", "round");
    cover.setAttribute("stroke-dasharray", len + 2);
    cover.setAttribute("stroke-dashoffset", len + 2);
    mask.appendChild(cover);

    var defs = svg.querySelector("defs");
    if (!defs) {
      defs = document.createElementNS(SVG_NS, "defs");
      svg.insertBefore(defs, svg.firstChild);
    }
    defs.appendChild(mask);
    path.setAttribute("mask", "url(#" + id + ")");
    return cover;
  }

  /* 在时间轴上画一笔 */
  function stroke(tl, cover, at, dur, ease) {
    if (!cover) return tl;
    return tl.to(cover, { strokeDashoffset: 0, duration: dur || 0.7, ease: ease || "pen" }, at);
  }

  /* 进入视口时播一次；刷新时已在下方的也直接补齐 */
  function once(trigger, start, build) {
    var done = false;
    function fire(self) {
      if (done) return;
      done = true;
      build();
      self && self.kill();
    }
    ScrollTrigger.create({
      trigger: trigger,
      start: start || "top 82%",
      onEnter: fire,
      onRefresh: function (self) {
        if (self.progress > 0) fire(self);
      }
    });
  }

  /* ---------- 首屏：四条引线 + 探头 ---------- */
  (function hero() {
    var leaders = gsap.utils.toArray(".hero-proof .ld");
    var notes = [".note-a", ".note-b", ".note-c", ".note-d"].map(function (s) {
      return document.querySelector(s);
    });
    var mascot = document.querySelector(".mascot-peek");
    if (!visible(mascot)) mascot = null;

    var covers = leaders.map(penPath);
    var notesShown = notes.some(visible);
    if (notesShown) gsap.set(notes, { opacity: 0 });
    if (mascot) gsap.set(mascot, { y: 44, rotation: -2 });

    var tl = gsap.timeline({ paused: true });
    if (notesShown) {
      /* 引线画到头，批注字即刻在那里：只做 opacity，不位移 */
      notes.forEach(function (n, i) {
        var at = 0.35 + i * 0.22;
        stroke(tl, covers[i], at, 0.6);
        tl.to(n, { opacity: 1, duration: 0.25, ease: "none" }, at + 0.45);
      });
    }
    if (mascot) tl.to(mascot, { y: 0, rotation: -12, duration: 0.95, ease: "peek" }, 0.9);

    /* 等字体与首屏截图就位再动笔，避免中途重排 */
    var img = document.querySelector(".hero-proof img");
    var ready = [document.fonts ? document.fonts.ready : Promise.resolve()];
    if (img && !img.complete) {
      ready.push(
        new Promise(function (r) {
          img.addEventListener("load", r, { once: true });
          img.addEventListener("error", r, { once: true });
        })
      );
    }
    var timeout = new Promise(function (r) {
      setTimeout(r, 900);
    });
    Promise.race([Promise.all(ready), timeout]).then(function () {
      requestAnimationFrame(function () {
        tl.play();
      });
    });
  })();

  /* ---------- 一天：时间圈 + 站与站之间的连线 ---------- */
  gsap.utils.toArray(".stop").forEach(function (stop) {
    var cover = penPath(stop.querySelector(".ring path"));
    if (!cover) return;
    once(stop.querySelector(".time"), "top 72%", function () {
      gsap.to(cover, { strokeDashoffset: 0, duration: 0.75, ease: "pen" });
    });
  });

  gsap.utils.toArray(".connector svg").forEach(function (svg) {
    var cover = penPath(svg.querySelector(".thread"));
    if (!cover) return;
    /* 连线跟着滚动走：从上一站画到下一站 */
    gsap.to(cover, {
      strokeDashoffset: 0,
      ease: "none",
      scrollTrigger: {
        trigger: svg,
        start: "top 82%",
        end: "bottom 50%",
        scrub: 0.3
      }
    });
  });

  /* ---------- 导入：汇入线 → 箭头 ---------- */
  (function funnel() {
    var root = document.querySelector(".funnel");
    if (!root) return;
    var lineCovers = gsap.utils.toArray(".funnel-lines .thread.thin").map(penPath);
    var arrowCover = penPath(root.querySelector(".thread.grad:not(.solid)"));
    var headCover = penPath(root.querySelector(".thread.grad.solid"));
    if (!lineCovers.some(Boolean) && !arrowCover) return;

    once(root, "top 70%", function () {
      var tl = gsap.timeline();
      lineCovers.forEach(function (c, i) {
        stroke(tl, c, i * 0.07, 0.8);
      });
      stroke(tl, arrowCover, 0.95, 0.5);
      stroke(tl, headCover, 1.32, 0.22, "tip");
    });
  })();

  /* ---------- 学期：尺子 ---------- */
  (function ruler() {
    var root = document.querySelector(".ruler");
    if (!root) return;
    var svg = root.querySelector(".ruler-line");
    var ticks = gsap.utils.toArray(svg.querySelectorAll(".ticks path"));
    var labels = gsap.utils.toArray(svg.querySelectorAll(".tick-labels text"));
    var drops = gsap.utils.toArray(svg.querySelectorAll(".thread.drop"));

    var W = 1120;
    var LINE_D = 1.3;
    var penEase = gsap.parseEase("pen");
    /* 线走到横坐标 x 的时刻（反解 in‑out 曲线） */
    function when(x) {
      var target = gsap.utils.clamp(0, 1, x / W);
      var lo = 0,
        hi = 1;
      for (var i = 0; i < 24; i++) {
        var mid = (lo + hi) / 2;
        if (penEase(mid) < target) lo = mid;
        else hi = mid;
      }
      return ((lo + hi) / 2) * LINE_D;
    }
    function xOf(path) {
      var m = /M\s*([\d.]+)/.exec(path.getAttribute("d"));
      return m ? parseFloat(m[1]) : 0;
    }

    var lineCover = penPath(svg.querySelector(".thread.ink"));
    if (!lineCover) return;
    var dropCovers = drops.map(penPath);
    gsap.set(ticks, { scaleY: 0, transformOrigin: "50% 100%" });
    gsap.set(labels, { opacity: 0 });

    once(root, "top 74%", function () {
      var tl = gsap.timeline();
      stroke(tl, lineCover, 0, LINE_D);
      ticks.forEach(function (t) {
        tl.to(t, { scaleY: 1, duration: 0.35, ease: "tip" }, when(xOf(t)));
      });
      labels.forEach(function (t) {
        tl.to(t, { opacity: 1, duration: 0.25, ease: "none" }, when(parseFloat(t.getAttribute("x"))) + 0.05);
      });
      dropCovers.forEach(function (c, i) {
        stroke(tl, c, when(xOf(drops[i])) + 0.1, 0.5);
      });
    });
  })();

  /* ---------- 开始：引导图微视差 ---------- */
  (function start() {
    var root = document.querySelector(".start");
    if (!root) return;

    /* 三张引导图本就错落，滚动时让后面的追上前面的：极轻的视差 */
    if (matchMedia("(min-width: 721px)").matches) {
      gsap.utils.toArray(".onboard li").forEach(function (li, i) {
        if (!i) return;
        gsap.fromTo(
          li,
          { y: 18 * i },
          {
            y: -18 * i,
            ease: "none",
            scrollTrigger: { trigger: root, start: "top bottom", end: "bottom top", scrub: true }
          }
        );
      });
    }
  })();

  /* 图片解码、字体加载会改变高度，刷新触发位置 */
  window.addEventListener("load", function () {
    ScrollTrigger.refresh();
  });
})();
