/* ============================================================
   RIDDIM INDEX detail.js  v1.2
   ============================================================ */

(function () {
  /* ============================================================
     1. 基本ヘルパー
     ============================================================ */

  function getParam(key) {
    return new URLSearchParams(location.search).get(key) || "";
  }

  function normalizeFilenameKey(raw) {
    if (!raw) return "";
    let s = raw.trim();
    s = s.replace(/\s+riddim\s*$/i, "");
    s = s.replace(/\([^)]*\)/g, "");
    s = s.replace(/\./g, "_");
    s = s.replace(/\s+/g, "_");
    s = s.toLowerCase();
    s = s.replace(/[^a-z0-9_]/g, "");
    return s;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;

    if (value === undefined || value === null) {
      el.textContent = "—";
      return;
    }
    const s = String(value).trim();
    el.textContent = s || "—";
  }

  const cleanTitle = (s) =>
    s ? s.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim() : s;

  const cleanArtist = cleanTitle;

  const cleanLabel = (s) =>
    s ? s.replace(/\(\d+\)/g, "").trim() : s;


  /* ============================================================
     2. お気に入り / トースト共通
     ============================================================ */

  const FAVORITES_KEY = "riddimFavorites";

  function loadFavorites() {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveFavorites(arr) {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(arr));
    } catch {}
  }

  function isFavorite(key) {
    if (!key) return false;
    return loadFavorites().includes(key);
  }

  function toggleFavorite(key) {
    if (!key) return;
    const favs = loadFavorites();
    const i = favs.indexOf(key);
    if (i === -1) favs.push(key);
    else favs.splice(i, 1);
    saveFavorites(favs);
  }

  // allowAnim = true のときだけ idle アニメ (fav-idle-run) を回す
  function setFavVisual(btn, key, allowAnim = false) {
    const on = isFavorite(key);
    btn.textContent = on ? "★" : "☆";
    btn.classList.toggle("is-on", on);

    // 関連クラスはいったん全部外す
    btn.classList.remove("fav-idle-run", "fav-idle-stop", "is-unfav");

    if (!on) return;

    if (allowAnim) {
      // アニメを再スタートさせるために強制リフロー
      void btn.offsetWidth;
      btn.classList.add("fav-idle-run");
    } else {
      // 停止状態
      btn.classList.add("fav-idle-stop");
    }
  }

  let toastEl    = null;
  let toastTimer = null;

  function showToast(message) {
    if (!toastEl) return;

    toastEl.textContent = message;
    toastEl.classList.remove("show");
    void toastEl.offsetWidth;
    toastEl.classList.add("show");

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("show");
    }, 2000);
  }

  function hapticLight() {
    if (navigator.vibrate) {
      navigator.vibrate(20);
    }
  }

  function playRipple(btn) {
    const ripple = document.createElement("span");
    ripple.className = "favRipple";
    btn.appendChild(ripple);

    ripple.addEventListener("animationend", () => {
      ripple.remove();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    toastEl = document.getElementById("toast");
    if (toastEl) {
      toastEl.addEventListener("click", () => {
        toastEl.classList.remove("show");
        if (toastTimer) clearTimeout(toastTimer);
      });
    }
  });


  /* ============================================================
     3. PICKUP 行 タッチホバー（スマホ）
     ============================================================ */

  function setupTouchHoverForSongs() {
    const rows = document.querySelectorAll(".songRow");
    if (!rows.length) return;

    let activeRow = null;

    rows.forEach((row) => {
      row.addEventListener(
        "touchstart",
        (e) => {
          if (e.touches && e.touches.length > 1) return;

          if (activeRow && activeRow !== row) {
            activeRow.classList.remove("touch-hover");
          }

          row.classList.add("touch-hover");
          activeRow = row;
        },
        { passive: true }
      );
    });

    document.addEventListener(
      "touchstart",
      (e) => {
        const t = e.target.closest && e.target.closest(".songRow");
        if (!t && activeRow) {
          activeRow.classList.remove("touch-hover");
          activeRow = null;
        }
      },
      { passive: true }
    );
  }


  /* ============================================================
     4. メイン処理
     ============================================================ */

  async function load() {
    try {
      /* --- 4-1. パラメータ / JSON 読み込み --- */

      const rawRiddim = getParam("riddim");
      if (!rawRiddim) return;

      toastEl = document.getElementById("toast") || null;

      const favKey = rawRiddim;
      const key = normalizeFilenameKey(rawRiddim);
      if (!key) return;

      const cacheKey = `riddim:${key}`;
      const candidates = [
        `data/${key}.json`,
        `data/${key}_full.json`,
        `data/${key.replace(/__/, "._")}.json`,
      ];

      let rec = null;

      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        try {
          rec = JSON.parse(cached);
        } catch {}
      }

      if (!rec) {
        for (const url of candidates) {
          try {
            const res = await fetch(url);
            if (!res.ok) continue;
            rec = await res.json();
            sessionStorage.setItem(cacheKey, JSON.stringify(rec));
            break;
          } catch {}
        }
      }

      if (!rec) return;

      const tracks     = Array.isArray(rec.tracks) ? rec.tracks : [];
      const firstTrack = tracks[0] || null;
      const akaArr     = Array.isArray(rec.aka) ? rec.aka : [];

      const displayName =
        (rec.riddim && String(rec.riddim).trim()) ||
        (rec.name   && String(rec.name).trim()) ||
        rawRiddim;


      /* --- 4-2. タイトル / お気に入りボタン --- */

      document.title = "RIDDIM INDEX – " + displayName;
      setText("riddimTitle", displayName);

      const favBtn = document.getElementById("favDetailToggle");
      if (favBtn) {
        // 初期表示時は idle アニメも有効にする
        setFavVisual(favBtn, favKey, true);

        favBtn.addEventListener("click", () => {
          playRipple(favBtn);

          const wasFav = isFavorite(favKey);

          toggleFavorite(favKey);
          // クリック時は毎回アニメON（pop + idle）
          setFavVisual(favBtn, favKey, true);

          const nowFav = isFavorite(favKey);

          const titleForToast =
            (displayName && String(displayName).trim()) ||
            rawRiddim ||
            "（名称未設定）";

          if (!wasFav && nowFav) {
            showToast(`${titleForToast}\nお気に入りに追加しました`);
            hapticLight();
          } else if (wasFav && !nowFav) {
            // 解除時の「しぼむ」アニメ
            favBtn.classList.remove("is-unfav");
            void favBtn.offsetWidth;
            favBtn.classList.add("is-unfav");

            setTimeout(() => {
              favBtn.classList.remove("is-unfav");
            }, 260);

            showToast(`${titleForToast}\nお気に入りを解除しました`);
          }
        });
      }


      /* --- 4-3. メタ情報 --- */

      const baseLabel =
        rec.label ||
        (firstTrack && firstTrack.label) ||
        "";
      setText("label", cleanLabel(baseLabel) || "—");

      const baseYear =
        rec.year ||
        (rec.stats && (rec.stats.min_year || rec.stats.year)) ||
        (firstTrack && firstTrack.year) ||
        "";
      setText("year", baseYear || "—");

      let producer =
        (firstTrack && firstTrack.producer) ||
        rec.producer ||
        "";
      if (Array.isArray(producer)) {
        producer = producer.filter(Boolean).join(" & ");
      }
      producer = String(producer).replace(/&amp;/g, "&").trim();
      setText("producer", producer || "—");

      setText("aka", akaArr.length ? akaArr.filter(Boolean).join(" ／ ") : "—");


      /* --- 4-4. PICKUP 展開 --- */

      const ul = document.getElementById("pickup");
      if (!ul) return;
      ul.innerHTML = "";

      let picks = [];

      if (Array.isArray(rec.pickup) && rec.pickup.length) {
        const pickupArr = rec.pickup;

        if (!("artist" in pickupArr[0]) && tracks.length) {
          const map = new Map(tracks.map((t) => [t.row_index, t]));
          pickupArr.forEach((p) => {
            const base = map.get(p.row_index);
            if (!base) return;
            picks.push({ ...base, tier: p.tier, role: p.role });
          });
        } else {
          picks = pickupArr.slice();
        }
      }

      if (rec.original?.artist && rec.original?.title) {
        const orig = rec.original;
        const origKey = `${orig.artist}___${orig.title}`.toLowerCase();
        if (!picks.some((p) => `${p.artist}___${p.title}`.toLowerCase() === origKey)) {
          picks.push(orig);
        }
      }

      picks.sort((a, b) => {
        const ay = Number(a.year);
        const by = Number(b.year);
        const aOk = !isNaN(ay);
        const bOk = !isNaN(by);
        if (aOk && bOk) return ay - by;
        if (aOk) return -1;
        if (bOk) return 1;
        return 0;
      });

      picks.forEach((p) => {
        let artist = cleanArtist(p.artist || "—");
        let title  = cleanTitle(p.title  || "—");
        let year   = p.year ? String(p.year).trim() : "";

        const li = document.createElement("li");
        li.className = "songRow";
        li.style.overflowX = "auto";
        li.style.webkitOverflowScrolling = "touch";

        const hasValid = (artist && artist !== "—") || (title && title !== "—");

        const yearHTML = year
          ? `<span class="songYear" aria-hidden="true"
               style="
                 user-select: none;
                 -webkit-user-select: none;
                 -moz-user-select: none;
                 -ms-user-select: none;
                 margin-left: 4px;
                 opacity: 0.85;
               "
             >(${year})</span>`
          : "";

        if (hasValid) {
          const queryStr = `${artist} ${title}`.trim();
          const a = document.createElement("a");
          a.className = "songLink";
          a.href =
            "https://www.youtube.com/results?search_query=" +
            encodeURIComponent(queryStr);
          a.target = "_blank";
          a.rel = "noopener";
          a.style.whiteSpace = "nowrap";

          a.innerHTML =
            `<span class="dot">・</span>` +
            `<span class="artist">${artist}</span>` +
            `<span class="sep"> - </span>` +
            `<span class="title">${title}</span>` +
            yearHTML;

          li.appendChild(a);
        } else {
          li.innerHTML =
            `<span class="dot">・</span>` +
            `<span class="artist">${artist}</span>` +
            `<span class="sep"> - </span>` +
            `<span class="title">${title}</span>` +
            yearHTML;
        }

        ul.appendChild(li);
      });

      setupTouchHoverForSongs();


      /* --- 4-5. YouTube ボタン --- */

      const ytBtn = document.getElementById("ytRiddimBtn");
      if (ytBtn) {
        ytBtn.onclick = () => {
          const name =
            document.getElementById("riddimTitle")?.textContent?.trim() || "";
          if (!name) return;
          window.open(
            "https://www.youtube.com/results?search_query=" +
              encodeURIComponent(name + " riddim"),
            "_blank",
            "noopener"
          );
        };
      }


      /* --- 4-6. PICKUP カード高さ調整 --- */

      function adjustPickupHeight() {
        try {
          const vh = window.innerHeight;
          if (!document.body.classList.contains("detailPage")) return;

          const masthead = document.querySelector(".masthead");
          const footer   = document.querySelector(".footerNote");
          const cards    = document.querySelectorAll(".detailPage .card.container");
          if (!masthead || !footer || cards.length < 2) return;

          const riddimCard  = cards[0];
          const pickupCard  = cards[1];
          const pickupHead  = pickupCard.querySelector(".cardHead");

          const usedTop =
            masthead.offsetTop +
            masthead.offsetHeight +
            riddimCard.offsetHeight +
            (pickupHead ? pickupHead.offsetHeight : 0);

          const usedBottom = footer.offsetHeight + 24;
          const max = Math.max(80, vh - usedTop - usedBottom);

          document.documentElement.style.setProperty(
            "--pickup-max-height",
            max + "px"
          );
        } catch {}
      }

      requestAnimationFrame(adjustPickupHeight);
      window.addEventListener("resize", adjustPickupHeight);


      /* --- 4-7. JSON-LD --- */

      function injectJsonLd(rec, displayName, baseLabel, baseYear, producer, akaArr) {
        const ld = {
          "@context": "https://schema.org",
          "@type": "CreativeWork",
          name: displayName,
          alternateName: akaArr.length ? akaArr : undefined,
          description: "RIDDIM INDEX のリディム詳細データ。",
          datePublished: baseYear || undefined,
          recordLabel: cleanLabel(baseLabel) || undefined,
          producer: producer || undefined,
          url: location.href,
          isPartOf: {
            "@type": "WebSite",
            name: "RIDDIM INDEX",
            url: "https://italisle.jp/",
          },
        };

        document
          .querySelectorAll('script[data-dynamic-jsonld]')
          .forEach((el) => el.remove());

        const script = document.createElement("script");
        script.type = "application/ld+json";
        script.setAttribute("data-dynamic-jsonld", "1");
        script.textContent = JSON.stringify(ld);
        document.head.appendChild(script);
      }

      injectJsonLd(rec, displayName, baseLabel, baseYear, producer, akaArr);

    } catch (e) {
      console.error(e);
    }
  }


  /* ============================================================
     5. 実行
     ============================================================ */

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
