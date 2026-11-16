(function () {
  "use strict";
  var CATS = [
    ["all", "הכל"], ["security", "ביטחון"], ["economy", "כלכלה"],
    ["health", "בריאות"], ["world", "עולם"], ["science", "מדע"]
  ];
  var app = document.getElementById("app");
  var data = null;
  var speaking = { state: "idle", index: -1, stop: false };

  function el(tag, props, children) {
    var n = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      if (k === "text") n.textContent = props[k];
      else if (k === "class") n.className = props[k];
      else if (k.indexOf("on") === 0) n.addEventListener(k.slice(2), props[k]);
      else n.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function timeAgo(iso) {
    var min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (min < 2) return "ממש עכשיו";
    if (min < 60) return "לפני " + min + " דקות";
    var h = Math.round(min / 60);
    if (h === 1) return "לפני שעה";
    if (h === 2) return "לפני שעתיים";
    if (h < 24) return "לפני " + h + " שעות";
    var d = Math.round(h / 24);
    if (d === 1) return "אתמול";
    if (d === 2) return "לפני יומיים";
    return "לפני " + d + " ימים";
  }

  function load(force) {
    return fetch("data/articles.json" + (force ? "?t=" + Date.now() : ""), { cache: force ? "reload" : "default" })
      .then(function (r) { if (!r.ok) throw new Error("bad"); return r.json(); })
      .then(function (j) { data = j; return j; });
  }

  function route() {
    stopSpeech();
    window.scrollTo(0, 0);
    var h = location.hash || "#/";
    var m = h.match(/^#\/a\/([\w-]+)/);
    if (m) return showArticle(m[1]);
    var c = (h.match(/[?&]c=(\w+)/) || [])[1] || "all";
    showHome(c);
  }

  function showHome(cat) {
    app.textContent = "";
    var chips = el("nav", { class: "chips", "aria-label": "נושאים" });
    CATS.forEach(function (c) {
      chips.appendChild(el("a", {
        class: "chip" + (c[0] === cat ? " active" : ""), href: c[0] === "all" ? "#/" : "#/?c=" + c[0],
        text: c[1], "aria-current": c[0] === cat ? "page" : "false"
      }));
    });
    var label = (CATS.filter(function (c) { return c[0] === cat; })[0] || CATS[0]);
    var refresh = el("button", { class: "btn", type: "button", text: "↻ רענון" });
    refresh.addEventListener("click", function () {
      refresh.textContent = "מרענן…"; refresh.disabled = true;
      load(true).then(function () { showHome(cat); }).catch(function () { refresh.textContent = "↻ רענון"; refresh.disabled = false; });
    });
    app.appendChild(chips);
    app.appendChild(el("div", { class: "toolbar" }, [
      el("h1", { class: "page", text: cat === "all" ? "החדשות האחרונות" : "חדשות " + label[1] }), refresh
    ]));

    if (!data) {
      app.appendChild(el("p", { class: "box", role: "status", text: "רגע, טוען את החדשות…" }));
      load().then(function () { showHome(cat); }).catch(function () {
        app.textContent = "";
        app.appendChild(el("div", { class: "box" }, [
          el("p", { text: "לא הצלחנו לטעון את החדשות. אפשר לנסות שוב בעוד רגע." }),
          el("button", { class: "btn primary", type: "button", text: "לנסות שוב", onclick: function () { route(); } })
        ]));
      });
      return;
    }
    var list = data.articles.filter(function (a) { return cat === "all" || a.category === cat; });
    if (!list.length) {
      app.appendChild(el("div", { class: "box" }, [
        el("p", { text: "אין כרגע כתבות בנושא הזה." }),
        el("p", { text: "כדאי לנסות שוב מאוחר יותר, או לבחור \"הכל\"." })
      ]));
      return;
    }
    var ul = el("ul", { class: "cards" });
    list.forEach(function (a) {
      ul.appendChild(el("li", {}, [
        el("a", { class: "card", href: "#/a/" + a.id }, [
          el("h2", { text: a.simple_title }),
          el("p", { text: a.summary }),
          el("p", { class: "meta" }, [document.createTextNode(timeAgo(a.published_at) + " · "), el("u", { text: "לקריאה" })])
        ])
      ]));
    });
    app.appendChild(ul);
  }

  function showArticle(id) {
    function render() {
      var a = (data.articles || []).filter(function (x) { return x.id === id; })[0];
      app.textContent = "";
      var back = el("a", { class: "back", href: "#/", text: "→ חזרה לכל החדשות" });
      app.appendChild(el("div", { style: "margin-top:1.2rem" }, [back]));
      if (!a) {
        app.appendChild(el("div", { class: "box" }, [el("p", { text: "הכתבה לא נמצאה. אולי היא כבר הוסרה." })]));
        return;
      }
      var cat = (CATS.filter(function (c) { return c[0] === a.category; })[0] || [])[1];
      var title = el("h1", { text: a.simple_title, id: "p0" });
      var art = el("article", { class: "article" }, [
        el("p", { class: "meta", text: (cat ? cat + " · " : "") + timeAgo(a.published_at) }),
        title
      ]);
      var parts = [a.simple_title];
      var ids = ["p0"];
      var chunks = el("div", { class: "chunks" });
      a.chunks.forEach(function (c, i) {
        parts.push((c.heading ? c.heading + ". " : "") + c.text);
        ids.push("p" + (i + 1));
        chunks.appendChild(el("section", { class: "chunk", id: "p" + (i + 1) }, [
          c.heading ? el("h2", { text: c.heading }) : null, el("p", { text: c.text })
        ]));
      });
      art.appendChild(readerBox(parts, ids));
      art.appendChild(chunks);
      if (a.glossary && a.glossary.length) {
        var dl = el("dl");
        a.glossary.forEach(function (g) {
          dl.appendChild(el("dt", { text: g.term }));
          dl.appendChild(el("dd", { text: g.plain_explanation }));
        });
        art.appendChild(el("section", { class: "glossary" }, [el("h2", { text: "הסבר מילים" }), dl]));
      }
      art.appendChild(el("section", { class: "source" }, [
        el("p", { text: "מקור: ynet" }),
        el("a", { class: "primary-link", href: a.source_url, target: "_blank", rel: "noopener noreferrer", text: "לקריאת הכתבה המקורית" })
      ]));
      app.appendChild(art);
      document.title = a.simple_title + " | חדשות בקלות";
    }
    if (data) render(); else load().then(render).catch(function () { location.hash = "#/"; });
  }

  // ---- read aloud ----
  function stopSpeech() {
    speaking.stop = true;
    speaking.state = "idle";
    clearHl();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }
  function clearHl() {
    var n = document.querySelectorAll(".hl");
    for (var i = 0; i < n.length; i++) n[i].classList.remove("hl");
  }
  function hlIndex(ids, i) {
    clearHl();
    var n = document.getElementById(ids[i]);
    if (n) { n.classList.add("hl"); n.scrollIntoView({ block: "center", behavior: "smooth" }); }
  }
  function hebrewVoice() {
    var v = speechSynthesis.getVoices();
    for (var i = 0; i < v.length; i++) if (v[i].lang.toLowerCase().indexOf("he") === 0) return v[i];
    return null;
  }
  function readerBox(parts, ids) {
    var playBtn = el("button", { class: "btn primary", type: "button", text: "▶ הקראה" });
    var stopBtn = el("button", { class: "btn", type: "button", text: "■ עצירה", style: "display:none" });
    var note = el("p", { class: "note", role: "status" });
    function setUi() {
      playBtn.textContent = speaking.state === "playing" ? "❚❚ השהיה" : speaking.state === "paused" ? "▶ המשך הקראה" : "▶ הקראה";
      stopBtn.style.display = speaking.state === "idle" ? "none" : "";
    }
    function speakFrom(i) {
      if (speaking.stop || i >= parts.length) { speaking.state = "idle"; clearHl(); setUi(); return; }
      hlIndex(ids, i);
      var u = new SpeechSynthesisUtterance(parts[i]);
      u.lang = "he-IL"; u.rate = 0.9;
      var v = hebrewVoice(); if (v) u.voice = v;
      u.onend = function () { speakFrom(i + 1); };
      u.onerror = function (e) {
        if (e.error !== "interrupted" && e.error !== "canceled") { note.textContent = "ההקראה הופסקה. אפשר לנסות שוב."; speaking.state = "idle"; setUi(); }
      };
      speechSynthesis.speak(u);
    }
    playBtn.addEventListener("click", function () {
      note.textContent = "";
      if (!("speechSynthesis" in window)) { note.textContent = "הדפדפן הזה לא יודע להקריא. אפשר לנסות דפדפן אחר, כמו כרום."; return; }
      if (speaking.state === "playing") { speechSynthesis.pause(); speaking.state = "paused"; setUi(); return; }
      if (speaking.state === "paused") { speechSynthesis.resume(); speaking.state = "playing"; setUi(); return; }
      var voices = speechSynthesis.getVoices();
      if (voices.length && !hebrewVoice()) note.textContent = "לא מצאנו קול בעברית במכשיר הזה, ולכן ההקראה עלולה להישמע לא טוב. אפשר להוסיף קול עברי בהגדרות המכשיר.";
      speechSynthesis.cancel();
      speaking.stop = false; speaking.state = "playing"; setUi();
      speakFrom(0);
    });
    stopBtn.addEventListener("click", function () { stopSpeech(); setUi(); });
    return el("div", { class: "reader" }, [el("div", { class: "row" }, [playBtn, stopBtn]), note]);
  }

  // ---- prefs ----
  var sizeBtns = document.querySelectorAll(".size");
  function applySize(s) {
    document.documentElement.style.setProperty("--reader-size", s + "px");
    for (var i = 0; i < sizeBtns.length; i++) sizeBtns[i].setAttribute("aria-pressed", String(sizeBtns[i].dataset.size === String(s)));
  }
  var saved = 22;
  try { saved = Number(localStorage.getItem("easy-news-font")) || 22; } catch (e) {}
  applySize(saved);
  for (var i = 0; i < sizeBtns.length; i++) {
    sizeBtns[i].addEventListener("click", function () {
      var s = this.dataset.size; applySize(s);
      try { localStorage.setItem("easy-news-font", s); } catch (e) {}
    });
  }
  var cBtn = document.getElementById("contrast");
  function syncContrast() {
    var on = document.documentElement.classList.contains("dark");
    cBtn.setAttribute("aria-pressed", String(on));
    cBtn.textContent = on ? "מצב רגיל" : "ניגודיות גבוהה";
  }
  cBtn.addEventListener("click", function () {
    var on = document.documentElement.classList.toggle("dark");
    try { localStorage.setItem("easy-news-contrast", on ? "1" : "0"); } catch (e) {}
    syncContrast();
  });
  syncContrast();

  window.addEventListener("hashchange", route);
  route();

  if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
})();
