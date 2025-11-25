(function () {
  /* ========================================
     1. URL パラメータ / 共通ヘルパー
     ======================================== */

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
    el.textContent = s ? s : "—";
  }

  const cleanTitle = (s) =>
    s ? s.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim() : s;
  const cleanArtist = cleanTitle;
  const cleanLabel = (s) =>
    s ? s.replace(/\(\d+\)/g, "").trim() : s;

  /* ========================================
     2. スマホ用タッチホバー
     ======================================== */

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

  /* ========================================
     3. メイン処理
     ======================================== */

  async function load() {
    try {
      const rawRiddim = getParam("riddim");
      if (!rawRiddim) return;

      const key = normalizeFilenameKey(rawRiddim);
      if (!key) return;

      const cacheKey = `riddim:${key}`;
      const candidates = [
        `data/${key}.json`,
        `data/${key}_full.json`,
        `data/${key.replace(/__/, "._")}.json`,
      ];

      let rec = null;

      /* 3-A. sessionStorage から即取得 */
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        try {
          rec = JSON.parse(cached);
        } catch {}
      }

      /* 3-B. キャッシュが無い場合のみ fetch */
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

      const tracks = Array.isArray(rec.tracks) ? rec.tracks : [];
      const firstTrack = tracks[0] || null;
      const akaArr = Array.isArray(rec.aka) ? rec.aka : [];

      const displayName =
        (rec.riddim && String(rec.riddim).trim()) ||
        (rec.name && String(rec.name).trim()) ||
        rawRiddim;

      document.title = "RIDDIM INDEX – " + displayName;
      setText("riddimTitle", displayName);

      /* 3-2. メタ情報 */
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

      /* 3-3. PICKUP 展開 */

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
        let title = cleanTitle(p.title || "—");
        let year = p.year ? String(p.year).trim() : "";

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

      /* 3-4. YouTube ボタン */

      const ytBtn = document.getElementById("ytRiddimBtn");
      if (ytBtn) {
        ytBtn.onclick = () => {
          const name = document.getElementById("riddimTitle")?.textContent?.trim() || "";
          if (!name) return;
          window.open(
            "https://www.youtube.com/results?search_query=" +
              encodeURIComponent(name + " riddim"),
            "_blank",
            "noopener"
          );
        };
      }

      /* 3-5. PICKUP 高さ調整 */

      function adjustPickupHeight() {
        try {
          const vh = window.innerHeight;
          if (!document.body.classList.contains("detailPage")) return;

          const masthead = document.querySelector(".masthead");
          const footer = document.querySelector(".footerNote");
          const cards = document.querySelectorAll(".detailPage .card.container");
          if (!masthead || !footer || cards.length < 2) return;

          const riddimCard = cards[0];
          const pickupCard = cards[1];
          const pickupHead = pickupCard.querySelector(".cardHead");

          const usedTop =
            masthead.offsetTop +
            masthead.offsetHeight +
            riddimCard.offsetHeight +
            (pickupHead ? pickupHead.offsetHeight : 0);

          const usedBottom = footer.offsetHeight + 24;
          const max = Math.max(80, vh - usedTop - usedBottom);

          document.documentElement.style.setProperty("--pickup-max-height", max + "px");
        } catch (e) {}
      }

      requestAnimationFrame(adjustPickupHeight);
      window.addEventListener("resize", adjustPickupHeight);

      /* ========================================
         3-6. 動的 JSON-LD を挿入
         ======================================== */
      function injectJsonLd(rec, displayName, baseLabel, baseYear, producer, akaArr) {
        const ld = {
          "@context": "https://schema.org",
          "@type": "CreativeWork",
          "name": displayName,
          "alternateName": akaArr.length ? akaArr : undefined,
          "description": "RIDDIM INDEX のリディム詳細データ。",
          "datePublished": baseYear || undefined,
          "recordLabel": baseLabel || undefined,
          "producer": producer || undefined,
          "url": location.href,
          "isPartOf": {
            "@type": "WebSite",
            "name": "RIDDIM INDEX",
            "url": "https://italisle.jp/"
          }
        };

        // 古いJSON-LDを削除（更新対応）
        document.querySelectorAll('script[data-dynamic-jsonld]').forEach(el => el.remove());

        const script = document.createElement("script");
        script.type = "application/ld+json";
        script.setAttribute("data-dynamic-jsonld", "1");
        script.textContent = JSON.stringify(ld);
        document.head.appendChild(script);
      }

      // ★ load() 内の最後で JSON-LD を生成
      injectJsonLd(
        rec,
        displayName,
        cleanLabel(baseLabel),
        baseYear,
        producer,
        akaArr
      );

    } catch (e) {
      console.error(e);
    }
  }

  load();
})();
