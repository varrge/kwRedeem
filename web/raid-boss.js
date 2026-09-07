/* Eight licensed animated characters. See the CREDITS.md in each character asset directory. */
(() => {
  // Authored artwork and frame timings: see each assets/raid-*/CREDITS.md.
  const skins = Object.freeze({
    "leviathan": {
      "title": "黑棘·利维坦",
      "subtitle": "黑棘古龙",
      "detail": "黑鳞 · 破翼 · 长尾",
      "color": "#d8ad71",
      "credit": "Cethiel",
      "source": "https://opengameart.org/content/dragon-fully-animated",
      "license": "CC0 1.0",
      "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
      "frame": {
        "width": 512,
        "height": 303,
        "columns": 6
      },
      "bounds": [
        73,
        18,
        465,
        267
      ],
      "clips": {
        "idle": {
          "frames": 41,
          "duration": 2683
        },
        "idle-battle": {
          "frames": 36,
          "duration": 2333
        },
        "hurt": {
          "frames": 17,
          "duration": 1033
        },
        "death": {
          "frames": 76,
          "duration": 2400
        }
      }
    },
    "sentinel": {
      "title": "苍木哨兵",
      "subtitle": "远古树灵",
      "detail": "盘根 · 树冠 · 枯木面孔",
      "color": "#a5ba7e",
      "credit": "LudicArts",
      "source": "https://opengameart.org/content/forest-fiends-free-character-pack",
      "license": "CC BY 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
      "frame": {
        "width": 512,
        "height": 435,
        "columns": 6
      },
      "bounds": [
        156,
        47,
        442,
        341
      ],
      "clips": {
        "idle": {
          "frames": 10,
          "duration": 833
        },
        "idle-battle": {
          "frames": 10,
          "duration": 833
        },
        "hurt": {
          "frames": 10,
          "duration": 833
        },
        "death": {
          "frames": 10,
          "duration": 833
        }
      }
    },
    "prism": {
      "title": "菌冠母体",
      "subtitle": "紫晶孢群",
      "detail": "菌伞 · 锯齿口 · 孢子",
      "color": "#b78ce1",
      "credit": "LudicArts",
      "source": "https://opengameart.org/content/forest-fiends-free-character-pack",
      "license": "CC BY 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
      "frame": {
        "width": 512,
        "height": 441,
        "columns": 6
      },
      "bounds": [
        184,
        17,
        460,
        341
      ],
      "clips": {
        "idle": {
          "frames": 10,
          "duration": 833
        },
        "idle-battle": {
          "frames": 10,
          "duration": 833
        },
        "hurt": {
          "frames": 10,
          "duration": 833
        },
        "death": {
          "frames": 10,
          "duration": 833
        }
      }
    },
    "zero-core": {
      "title": "深渊之瞳",
      "subtitle": "零号观察者",
      "detail": "独眼 · 血丝 · 神经束",
      "color": "#91b88e",
      "credit": "Grefuntor / Atmostatic",
      "source": "https://opengameart.org/content/demonic-eye",
      "license": "CC BY 3.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/3.0/",
      "frame": {
        "width": 406,
        "height": 337,
        "columns": 6
      },
      "bounds": [12, 19, 306, 259],
      "clips": {
        "idle": {
          "frames": 36,
          "duration": 3000
        },
        "idle-battle": {
          "frames": 30,
          "duration": 2000
        },
        "hurt": {
          "frames": 15,
          "duration": 900
        },
        "death": {
          "frames": 30,
          "duration": 2000
        }
      }
    },
    "warden": {
      "title": "血月典狱长",
      "subtitle": "诅咒狼裔",
      "detail": "巨爪 · 长吻 · 半兽躯体",
      "color": "#c4a18c",
      "credit": "MindChamber",
      "source": "https://opengameart.org/content/dark-saber-werewolf",
      "license": "CC BY 3.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/3.0/",
      "frame": {
        "width": 512,
        "height": 281,
        "columns": 6
      },
      "bounds": [
        161,
        38,
        375,
        277
      ],
      "clips": {
        "idle": {
          "frames": 50,
          "duration": 1667
        },
        "idle-battle": {
          "frames": 50,
          "duration": 1667
        },
        "hurt": {
          "frames": 26,
          "duration": 1000
        },
        "death": {
          "frames": 101,
          "duration": 3200
        }
      }
    },
    "overmind": {
      "title": "亡骸主宰",
      "subtitle": "瘟疫集群",
      "detail": "腐躯 · 巨肩 · 利爪",
      "color": "#a8b47e",
      "credit": "Cethiel",
      "source": "https://opengameart.org/content/zombie-fully-animated",
      "license": "CC0 1.0",
      "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
      "frame": {
        "width": 264,
        "height": 207,
        "columns": 6
      },
      "bounds": [
        60,
        35,
        180,
        187
      ],
      "clips": {
        "idle": {
          "frames": 45,
          "duration": 4400
        },
        "idle-battle": {
          "frames": 42,
          "duration": 2033
        },
        "hurt": {
          "frames": 12,
          "duration": 383
        },
        "death": {
          "frames": 47,
          "duration": 2400
        }
      }
    },
    "behemoth": {
      "title": "符文巨像",
      "subtitle": "重岩守卫",
      "detail": "重拳 · 浮首 · 碎石躯壳",
      "color": "#bca571",
      "credit": "Joseph Crown (jcrown41)",
      "source": "https://opengameart.org/content/rock-monster",
      "license": "CC0 1.0",
      "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
      "frame": {
        "width": 512,
        "height": 512,
        "columns": 6
      },
      "bounds": [
        61,
        29,
        459,
        471
      ],
      "clips": {
        "idle": {
          "frames": 24,
          "duration": 2400
        },
        "idle-battle": {
          "frames": 24,
          "duration": 1920
        },
        "hurt": {
          "frames": 12,
          "duration": 660
        },
        "death": {
          "frames": 24,
          "duration": 1680
        }
      }
    },
    "singularity": {
      "title": "星渊术士",
      "subtitle": "禁忌咒术",
      "detail": "兜帽 · 符杖 · 长袍",
      "color": "#ada1d8",
      "credit": "ruberboy",
      "source": "https://opengameart.org/content/wizard-characteranimated",
      "license": "CC0 1.0",
      "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
      "frame": {
        "width": 493,
        "height": 512,
        "columns": 6
      },
      "bounds": [
        29,
        14,
        270,
        423
      ],
      "clips": {
        "idle": {
          "frames": 25,
          "duration": 2000
        },
        "idle-battle": {
          "frames": 25,
          "duration": 1350
        },
        "hurt": {
          "frames": 13,
          "duration": 850
        },
        "death": {
          "frames": 37,
          "duration": 2200
        }
      }
    }
  });
  let serial = 0;

  function paintedArtwork(prefix, key, skin) {
    const frame = skin.frame;
    const base = `./assets/raid-${key}/`;
    const [left, top, right, bottom] = skin.bounds;
    const scale = Math.min(740 / (right - left), 450 / (bottom - top), 940 / frame.width, 560 / frame.height);
    const width = frame.width * scale;
    const height = frame.height * scale;
    const x = Math.max(20, Math.min(980 - width, 500 - (left + right) / 2 * scale));
    const y = Math.max(50, Math.min(680 - height, 620 - bottom * scale));
    return `<svg class="rb-svg rb-painted" viewBox="0 0 1000 760" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><radialGradient id="${prefix}-ground"><stop stop-color="#020405" stop-opacity=".95"/><stop offset="1" stop-color="#020405" stop-opacity="0"/></radialGradient>
        <clipPath id="${prefix}-frame" clipPathUnits="userSpaceOnUse"><rect width="${frame.width}" height="${frame.height}"/></clipPath>
      </defs>
      <ellipse cx="540" cy="653" rx="315" ry="50" fill="url(#${prefix}-ground)"/>
      <g class="rb-sprite-light"><ellipse cx="528" cy="608" rx="238" ry="36" fill="none" stroke="#c5a877" stroke-opacity=".15"/></g>
      <svg class="rb-sprite-window" x="${x}" y="${y}" width="${width}" height="${height}" viewBox="0 0 ${frame.width} ${frame.height}" overflow="hidden">
        <g clip-path="url(#${prefix}-frame)">
        <image class="rb-sprite-poster" href="${base}poster.webp" width="${frame.width}" height="${frame.height}"/>
        <image class="rb-sprite-sheet" visibility="hidden"/>
        </g>
      </svg>
    </svg>`;
  }

  function createSprite(host, key, skin) {
    const frame = skin.frame;
    const clips = skin.clips;
    const base = `./assets/raid-${key}/`;
    const sheet = host.querySelector(".rb-sprite-sheet");
    const poster = host.querySelector(".rb-sprite-poster");
    let state = null;
    let clip = null;
    let elapsed = 0;
    let lastTime = null;
    let frameRequest = null;
    let paused = false;
    let reduced = false;
    let revision = 0;
    let disposed = false;
    let loading = null;
    const idleClip = () => ["enraged", "unstable"].includes(state) ? "idle-battle" : "idle";
    function paint(index) {
      sheet.setAttribute("x", String(-(index % frame.columns) * frame.width));
      sheet.setAttribute("y", String(-Math.floor(index / frame.columns) * frame.height));
      host.dataset.frame = String(index);
    }
    function stop() {
      if (frameRequest !== null) cancelAnimationFrame(frameRequest);
      frameRequest = null;
      lastTime = null;
    }
    function schedule() {
      if (frameRequest === null && !loading && !paused && !reduced && clip && state !== "dormant" && typeof requestAnimationFrame === "function") {
        frameRequest = requestAnimationFrame(tick);
      }
    }
    function tick(at) {
      frameRequest = null;
      if (paused || reduced || disposed) return;
      if (lastTime !== null) elapsed += Math.min(at - lastTime, 100);
      lastTime = at;
      const config = clips[clip];
      if (elapsed >= config.duration && clip === "hurt") { play(idleClip()); return; }
      const once = clip === "death";
      const progress = once ? Math.min(1, elapsed / config.duration) : (elapsed % config.duration) / config.duration;
      paint(Math.min(config.frames - 1, Math.floor(progress * config.frames)));
      if (once && progress === 1) { stop(); host.dispatchEvent(new Event("raid-boss-defeated")); return; }
      schedule();
    }
    function play(name, finalPose = false) {
      const ticket = ++revision;
      stop();
      const next = new Image();
      loading = next;
      next.onload = () => {
        if (disposed || ticket !== revision) return;
        const config = clips[name];
        loading = null;
        sheet.setAttribute("href", next.src);
        sheet.setAttribute("width", String(frame.width * frame.columns));
        sheet.setAttribute("height", String(frame.height * Math.ceil(config.frames / frame.columns)));
        sheet.setAttribute("visibility", "visible");
        poster.setAttribute("visibility", "hidden");
        clip = name;
        elapsed = finalPose || (reduced && name === "death") ? config.duration : 0;
        host.dataset.clip = name;
        delete host.dataset.assetError;
        paint(name === "death" && elapsed >= config.duration ? config.frames - 1 : 0);
        if (name === "death" && elapsed >= config.duration) host.dispatchEvent(new Event("raid-boss-defeated"));
        else schedule();
      };
      next.onerror = () => {
        if (disposed || ticket !== revision) return;
        loading = null;
        clip = null;
        sheet.setAttribute("visibility", "hidden");
        poster.setAttribute("visibility", "visible");
        host.dataset.assetError = "true";
        if (state === "defeated") host.dispatchEvent(new Event("raid-boss-defeated"));
      };
      next.src = `${base}${name}.webp`;
    }
    return {
      update(nextState, animate) {
        if (nextState === state) return;
        state = nextState;
        play(state === "defeated" ? "death" : idleClip(), state === "defeated" && !animate);
      },
      hit() { if (!["defeated", "dormant"].includes(state) && !paused && !reduced) play("hurt"); },
      pause(nextPaused, nextReduced) {
        paused = nextPaused; reduced = nextReduced;
        if (paused || reduced) stop();
        if (reduced && clip === "death" && elapsed < clips.death.duration) {
          elapsed = clips.death.duration; paint(clips.death.frames - 1);
          host.dispatchEvent(new Event("raid-boss-defeated"));
        }
        if (!paused && !reduced && !(clip === "death" && elapsed >= clips.death.duration)) schedule();
      },
      destroy() {
        disposed = true; revision++; stop();
        if (loading) { loading.onload = null; loading.onerror = null; }
        loading = null;
      }
    };
  }

  function create(host) {
    const prefix = `raid-boss-${++serial}`;
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let identity = null;
    let currentState = null;
    let paused = false;
    let visible = true;
    let motionDisabled = false;
    let hitTimer;
    let sprite = null;
    function syncPause() {
      host.dataset.paused = String(paused || !visible || document.hidden);
      host.dataset.reducedMotion = String(motionDisabled || Boolean(motion?.matches));
      sprite?.pause(host.dataset.paused === "true", host.dataset.reducedMotion === "true");
    }
    function update(boss, campaignStatus = "active", animate = true) {
      const key = Object.hasOwn(skins, boss.assetKey) ? boss.assetKey : "leviathan";
      const changed = identity !== `${boss.id}:${key}`;
      if (changed) {
        sprite?.destroy();
        sprite = null;
        clearTimeout(hitTimer);
        host.classList.remove("rb-hit");
        host.innerHTML = paintedArtwork(prefix, key, skins[key]);
        host.classList.add("rb-stage");
        host.style.setProperty("--rb-color", skins[key].color);
        host.style.setProperty("--rb-light", "#fff0d9");
        host.dataset.assetKey = key;
        delete host.dataset.clip;
        delete host.dataset.frame;
        delete host.dataset.assetError;
        sprite = createSprite(host, key, skins[key]);
        identity = `${boss.id}:${key}`;
      }
      const nextState = boss.status === "defeated" ? "defeated"
        : ["ended", "aborted"].includes(campaignStatus) || ["ended", "aborted", "locked"].includes(boss.status) ? "dormant"
        : boss.status === "settling" || Number(boss.remainingHealth) <= 0 ? "unstable"
        : Number(boss.remainingHealth) / Number(boss.health) <= .25 ? "enraged" : "idle";
      // Identical refreshes preserve the pose and never restart a completed transition.
      if (changed || currentState !== nextState) {
        host.dataset.transition = !changed && animate && !document.hidden && nextState === "defeated" ? "defeat" : "";
      }
      host.dataset.state = nextState;
      sprite?.update(nextState, !changed && animate && !document.hidden);
      currentState = nextState;
      syncPause();
    }
    function hit() {
      if (!identity || document.hidden || host.dataset.paused === "true" || ["defeated", "dormant"].includes(currentState)) return;
      clearTimeout(hitTimer);
      sprite?.hit();
      host.classList.remove("rb-hit");
      void host.getBoundingClientRect();
      host.classList.add("rb-hit");
      hitTimer = setTimeout(() => host.classList.remove("rb-hit"), 720);
    }
    const observer = typeof IntersectionObserver === "function" ? new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      syncPause();
    }) : null;
    observer?.observe(host);
    document.addEventListener("visibilitychange", syncPause);
    motion?.addEventListener("change", syncPause);
    syncPause();
    return {
      update, hit,
      // Raster completion emits an event; timeout only bounds a stalled asset request.
      defeatTimeout() { return 8000; },
      setPaused(value) { paused = Boolean(value); syncPause(); },
      setReducedMotion(value) { motionDisabled = Boolean(value); syncPause(); },
      destroy() {
        sprite?.destroy();
        clearTimeout(hitTimer);
        observer?.disconnect();
        document.removeEventListener("visibilitychange", syncPause);
        motion?.removeEventListener("change", syncPause);
        host.replaceChildren();
      }
    };
  }
  globalThis.RaidBoss = Object.freeze({ create, skins });
})();
