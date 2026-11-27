/* =========================================================================
   《Basketball Time》UI Refactor Controller (ui-refactor.js)
   Implements 6 UX/UI upgrades without modifying core game math, DBs, or save schema:
   1. Sticky Top Big CTA + 3-Tab Navigation (比賽 / 我 / 球隊)
   2. Unified Settlement Modal (Post-Match / Training / Event: MVP Moment + 3 Gains + Next Goal + Continue)
   3. Pre-Match Coach Directive & Focus 3-Choice (Real Match & Settlement Effects)
   4. Mobile Card Roster (Default Starters 5, Expandable Bench 7)
   5. Universal League Benchmarks & Comparisons (OVR avg, rank, stat vs pos avg, PPG/RPG/APG)
   6. Title Start Screen + 3-Step New Player Onboarding (Position -> Talent -> Tutorial Match)
   ========================================================================= */

window.BTUI = (() => {
  let rosterExpanded = false;
  let currentCreateStep = 1;
  let pendingFocusAction = null; // "PLAY" | "SIM"
  let activeCoachFocus = null;   // { id, title, icon, targetLabel, targetVal, ... }
  let isTutorialMatch = false;
  let preMatchSnapshot = null;
  let settlementOnContinue = null;
  let settlementUnlockTimer = null;

  const COACH_FOCUS_OPTIONS = [
    {
      id: "SCORE_ATTACK",
      icon: "🔥",
      title: "火力全開 · 進攻終結",
      tag: "得分專注",
      quote: "教練指令：「拉開空間，這場你就是第一終結點！」",
      fx: "比賽實效：進攻出手權重提升、投籃命中 +3.5%、張力累積 +15%（體力消耗微增 +6%）。",
      buildGoal: (rotKey) => {
        const target = (rotKey === "ACE" || rotKey === "STARTER") ? 16 : 10;
        return {
          target,
          label: `本場得分 ≥ ${target} 分`,
          rewardText: "達標結算：教練信任 +4、個人名氣 +3",
          check: (u) => (u.pts || 0) >= target,
          progressText: (u) => `得分 ${u.pts || 0} / ${target}`,
          applyReward: (p) => {
            p.coachTrust = Math.min(100, (p.coachTrust || 35) + 4);
            p.reputation = Math.min(100, (p.reputation || 45) + 3);
            return "教練信任 +4、名氣 +3";
          }
        };
      }
    },
    {
      id: "PLAYMAKE_LINK",
      icon: "🧠",
      title: "串聯全隊 · 戰術組織",
      tag: "組織專注",
      quote: "教練指令：「多看弱側隊友空檔，用傳球撕開防線！」",
      fx: "比賽實效：失誤率 -2.5%、隊友接球命中 +3%、助攻權重大幅提升。",
      buildGoal: (rotKey) => {
        const target = (rotKey === "ACE" || rotKey === "STARTER") ? 5 : 3;
        return {
          target,
          label: `本場助攻 ≥ ${target} 次且失誤 ≤ 3`,
          rewardText: "達標結算：教練信任 +5、球隊化學反應 +2",
          check: (u) => (u.ast || 0) >= target && (u.tov || 0) <= 3,
          progressText: (u) => `助攻 ${u.ast || 0}/${target} · 失誤 ${u.tov || 0}`,
          applyReward: (p, season) => {
            p.coachTrust = Math.min(100, (p.coachTrust || 35) + 5);
            if (typeof adjustTeamChemistry === "function") adjustTeamChemistry(2);
            else if (season && season.teamOps) season.teamOps.chemistry = Math.min(100, (season.teamOps.chemistry || 65) + 2);
            return "教練信任 +5、球隊化學 +2";
          }
        };
      }
    },
    {
      id: "LOCKDOWN_DEF",
      icon: "🛡️",
      title: "鐵血鎖死 · 防守籃板",
      tag: "防守專注",
      quote: "教練指令：「貼緊對面王牌，每一個籃板和抄截都要拚下來！」",
      fx: "比賽實效：對手對位命中 -3.5%、抄截／封阻／籃板權重提升。",
      buildGoal: (rotKey) => {
        const target = (rotKey === "ACE" || rotKey === "STARTER") ? 8 : 5;
        return {
          target,
          label: `防守貢獻（板 + 抄×2 + 帽×2）≥ ${target}`,
          rewardText: "達標結算：教練信任 +4、賽後體能額外保留 +4%",
          check: (u) => ((u.oreb || 0) + (u.dreb || 0) + (u.stl || 0) * 2 + (u.blk || 0) * 2) >= target,
          progressText: (u) => {
            const val = (u.oreb || 0) + (u.dreb || 0) + (u.stl || 0) * 2 + (u.blk || 0) * 2;
            return `防守分 ${val} / ${target}`;
          },
          applyReward: (p) => {
            p.coachTrust = Math.min(100, (p.coachTrust || 35) + 4);
            p.condition = Math.min(100, (p.condition || 80) + 4);
            return "教練信任 +4、狀態回復 +4%";
          }
        };
      }
    }
  ];

  const POS_CARDS = [
    { code: "PG", name: "控球後衛 (PG)", desc: "全隊大腦 · 組織、球商、速度與外線防守突出" },
    { code: "SG", name: "得分後衛 (SG)", desc: "外線殺手 · 三分、中投與關鍵時刻火力最強" },
    { code: "SF", name: "小前鋒 (SF)", desc: "全能搖擺 · 攻守均衡、切投兼備最容易上手" },
    { code: "PF", name: "大前鋒 (PF)", desc: "禁區鐵閘 · 籃板、力量、內線終結與護框兼備" },
    { code: "C",  name: "中鋒 (C)",     desc: "內線支柱 · 身高壓制、護框封阻與禁區統治力" }
  ];

  /* -------------------- 5. LEAGUE BENCHMARK COMPUTATION -------------------- */
  function computeLeagueBenchmarks() {
    if (!window.Season || !window.DB || !DB.leagues) return null;
    const league = DB.leagues.leagues.find(l => l.id === Season.leagueId) || DB.leagues.leagues[0];
    const pObj = Season.player;
    const userOvr = pObj ? calcOVR(pObj.stats, pObj.pos, Season.equippedTraits) : 72;
    const userTeamOvr = calcTeamStrength(Season.userRoster || []);

    // Team strength rankings
    const teamOvrs = (Season.standings || []).map(t => ({
      id: t.id,
      name: t.name,
      isUserTeam: Boolean(t.isUserTeam),
      ovr: t.isUserTeam ? userTeamOvr : (t.ovr || 78)
    })).sort((a, b) => b.ovr - a.ovr);
    const teamCount = Math.max(1, teamOvrs.length);
    const teamAvgOvr = Math.round(teamOvrs.reduce((s, t) => s + t.ovr, 0) / teamCount);
    const teamOvrRank = Math.max(1, teamOvrs.findIndex(t => t.isUserTeam) + 1);

    // Standing rank
    const sortedSt = [...(Season.standings || [])].sort((a, b) => (b.w - a.w) || ((b.pf - b.pa) - (a.pf - a.pa)));
    const standingRank = Math.max(1, sortedSt.findIndex(t => t.isUserTeam) + 1);

    // All players OVR across league
    const allPlayers = [];
    for (const pl of (Season.userRoster || [])) {
      allPlayers.push({
        ovr: pl.isUser ? userOvr : (pl.ovr || 72),
        pos: pl.pos || "SG",
        isUser: Boolean(pl.isUser),
        stats: pl.isUser && pObj ? pObj.stats : pl.stats
      });
    }
    for (const tm of (league.teams || [])) {
      const isUT = Season.standings && Season.standings.some(s => s.isUserTeam && s.id === tm.id);
      if (isUT) continue;
      const r = Array.isArray(tm.roster) && tm.roster.length ? tm.roster : (typeof buildOpponentRoster === "function" ? buildOpponentRoster(tm) : []);
      for (const pl of r) {
        allPlayers.push({
          ovr: pl.ovr || tm.ovr || 74,
          pos: pl.pos || "SG",
          isUser: false,
          stats: pl.stats || null
        });
      }
    }

    const totalPlayers = Math.max(1, allPlayers.length);
    const playerAvgOvr = Math.round(allPlayers.reduce((s, x) => s + x.ovr, 0) / totalPlayers);
    const sortedAll = [...allPlayers].sort((a, b) => b.ovr - a.ovr);
    const playerOvrRank = Math.max(1, sortedAll.findIndex(x => x.isUser) + 1);

    const userPos = (pObj && pObj.pos) || "SG";
    const samePos = allPlayers.filter(x => x.pos === userPos).sort((a, b) => b.ovr - a.ovr);
    const posRank = Math.max(1, samePos.findIndex(x => x.isUser) + 1);
    const posTotal = Math.max(1, samePos.length);
    const posAvgOvr = Math.round(samePos.reduce((s, x) => s + x.ovr, 0) / posTotal);

    // Per-stat league benchmark (same position + league OVR scaling)
    const statAvgs = {};
    const posTpl = (DB.origins && DB.origins.posTemplates && DB.origins.posTemplates[userPos]) || {};
    const leagueShift = Math.round((playerAvgOvr - 72) * 0.72);
    for (const d of (DB.origins ? DB.origins.statDefs : [])) {
      const k = d.k;
      const samples = samePos.filter(x => x.stats && typeof x.stats[k] === "number").map(x => x.stats[k]);
      if (samples.length >= 4) {
        statAvgs[k] = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
      } else {
        statAvgs[k] = Math.max(50, Math.min(92, (posTpl[k] || 66) + leagueShift));
      }
    }

    // Per-game starter baseline scaled by league quarter minutes
    const qScale = (league.quarterMinutes || 8) / 8;
    const avgBase = {
      ppg: Number((12.5 * qScale).toFixed(1)),
      rpg: Number((4.8 * qScale).toFixed(1)),
      apg: Number((3.2 * qScale).toFixed(1)),
      spg: Number((1.1 * qScale).toFixed(1)),
      bpg: Number((0.7 * qScale).toFixed(1))
    };

    return {
      leagueName: league.name,
      userOvr,
      playerAvgOvr,
      playerOvrDiff: userOvr - playerAvgOvr,
      playerOvrRank,
      totalPlayers,
      userPos,
      posRank,
      posTotal,
      posAvgOvr,
      userTeamOvr,
      teamAvgOvr,
      teamOvrDiff: userTeamOvr - teamAvgOvr,
      teamOvrRank,
      teamCount,
      standingRank,
      statAvgs,
      avgBase
    };
  }

  function formatDiffSpan(diff, unit = "") {
    if (diff > 0) return `<span class="cmp-badge pos">+${diff}${unit} 高於均線</span>`;
    if (diff < 0) return `<span class="cmp-badge neg">${diff}${unit} 低於均線</span>`;
    return `<span class="cmp-badge">持平聯盟均值</span>`;
  }

  /* -------------------- 1. TOP STICKY CTA & 3-TAB CONTROLLER -------------------- */
  function switchHubTab(tabId) {
    const valid = ["htab-match", "htab-me", "htab-team"];
    const target = valid.includes(tabId) ? tabId : "htab-match";
    document.querySelectorAll("#hubNavTabs .nav-tab").forEach(b => {
      b.classList.toggle("active", b.dataset.htab === target);
    });
    document.querySelectorAll(".hub-panel").forEach(p => {
      p.style.display = (p.id === target) ? "block" : "none";
    });
  }

  function updateTopStickyCTA() {
    const btn = document.getElementById("btnTopBigCta");
    const titleEl = document.getElementById("topCtaTitle");
    const subEl = document.getElementById("topCtaSub");
    if (!btn || !titleEl || !subEl || !window.Season) return;

    const league = DB.leagues.leagues.find(l => l.id === Season.leagueId) || DB.leagues.leagues[0];
    const userTeam = Season.standings.find(t => t.isUserTeam) || { name: "我方", w: 0, l: 0 };
    const seasonDone = Season.currentRoundIdx >= Season.schedule.length;
    const apLeft = (Season.player && typeof Season.player.ap === "number") ? Season.player.ap : 0;

    btn.classList.remove("gold-mode");
    if (Season.retired) {
      btn.classList.add("gold-mode");
      titleEl.textContent = "✨ 開啟全新球員生涯";
      subEl.textContent = `傳奇已謝幕（共 ${Season.careerYear} 季）· 點擊重新創角`;
      btn.dataset.ctaMode = "NEW_CAREER";
    } else if (seasonDone) {
      btn.classList.add("gold-mode");
      titleEl.textContent = "🏆 壓縮賽季進入下一年";
      subEl.textContent = `${league.name} 戰績 ${userTeam.w}勝${userTeam.l}負 · 進入休賽季抉擇`;
      btn.dataset.ctaMode = "NEXT_SEASON";
    } else {
      const nextG = Season.schedule[Season.currentRoundIdx];
      const stageTxt = nextG.stageLabel || `第 ${nextG.round} 輪`;
      titleEl.textContent = "🏀 開始下一場比賽";
      subEl.textContent = `${stageTxt} · ${userTeam.name} VS ${nextG.oppName}${apLeft > 0 ? `（尚餘 ${apLeft} AP 可訓練）` : ""}`;
      btn.dataset.ctaMode = "PLAY_NEXT";
    }

    const meApBadge = document.getElementById("navMeApBadge");
    if (meApBadge) {
      meApBadge.textContent = `${apLeft} AP`;
      meApBadge.style.display = apLeft > 0 ? "inline-flex" : "none";
    }
  }

  /* -------------------- 4. 12-MAN ROSTER CARDS (DEFAULT 5 STARTERS) -------------------- */
  function renderRosterCards(bm) {
    const wrap = document.getElementById("hubTeamRosterCards");
    const toggleBtn = document.getElementById("btnToggleBenchRoster");
    if (!wrap || !window.Season) return;

    const rotWin = getEffectiveRotationWindow();
    const rosterSorted = [...Season.userRoster].sort((a, b) =>
      (a.role === "STARTER" ? 0 : 1) - (b.role === "STARTER" ? 0 : 1) || b.ovr - a.ovr
    );

    const starters = rosterSorted.slice(0, 5);
    const bench = rosterSorted.slice(5);
    const listToShow = rosterExpanded ? rosterSorted : starters;
    const avgOvr = bm ? bm.playerAvgOvr : 74;

    wrap.innerHTML = listToShow.map((pl, idx) => {
      const s = pl.stats || {};
      const isStarter = idx < 5;
      const roleTxt = pl.isUser
        ? `${rotWin.label}·${pl.role === "STARTER" ? "先發" : "替補"}`
        : (isStarter ? "先發主力" : "替補輪換");
      const diff = (pl.ovr || 72) - avgOvr;
      const diffStr = diff > 0 ? `均+${diff}` : (diff < 0 ? `均${diff}` : "持平");
      const skList = (pl.skills || []).map(id => renderSkillChip(id, "font-size:10.5px; padding:2px 6px;")).join("")
        || `<span class="s-badge">基礎球風</span>`;

      return `
        <article class="roster-player-card ${pl.isUser ? "is-user" : (!isStarter ? "is-bench" : "")}">
          <div class="rpc-head">
            <div style="min-width:0;">
              <div class="rpc-name">#${pl.num} ${pl.name}${pl.isUser ? " ★" : ""}</div>
              <div class="rpc-meta">
                <span class="tag">${pl.pos}</span>
                <span class="tag ${isStarter ? "gold" : ""}">${roleTxt}</span>
                <span>${pl.heightCm || 185}cm</span>
              </div>
            </div>
            <div class="rpc-ovr-box">
              <div class="rpc-ovr-num">${pl.ovr}</div>
              <div class="rpc-ovr-cmp">OVR · ${diffStr}</div>
            </div>
          </div>
          <div class="rpc-stats-row">
            <div class="rpc-stat-pill">三分 <strong>${s.threePt || 70}</strong></div>
            <div class="rpc-stat-pill">中投 <strong>${s.midRange || 70}</strong></div>
            <div class="rpc-stat-pill">內線 <strong>${s.inside || 70}</strong></div>
            <div class="rpc-stat-pill">外防 <strong>${s.perimDef || 70}</strong></div>
            <div class="rpc-stat-pill">護框 <strong>${s.intDef || 70}</strong></div>
            <div class="rpc-stat-pill">籃板 <strong>${s.rebound || 70}</strong></div>
          </div>
          <div class="rpc-skills">${skList}</div>
        </article>`;
    }).join("");

    if (toggleBtn) {
      if (bench.length > 0) {
        toggleBtn.style.display = "inline-flex";
        toggleBtn.textContent = rosterExpanded
          ? `▲ 收合替補陣容（只顯示先發 5 人）`
          : `👥 展開替補陣容（+${bench.length} 人 · 共 ${rosterSorted.length} 人）▼`;
      } else {
        toggleBtn.style.display = "none";
      }
    }
  }

  /* -------------------- 5. HUB BENCHMARK ENHANCEMENTS -------------------- */
  function enhanceHubDisplays() {
    if (!window.Season || !Season.player) return;
    const bm = computeLeagueBenchmarks();
    if (!bm) return;
    const p = Season.player;
    const rotWin = getEffectiveRotationWindow();
    const st = Season.seasonTotals || { gp: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, mvps: 0 };
    const gp = Math.max(1, st.gp);

    // Update Top Big CTA
    updateTopStickyCTA();

    // Update OVR & League Comparison Hero Strip in 【我】Tab
    const strip = document.getElementById("meOvrCompareStrip");
    if (strip) {
      const ovrDiffTxt = bm.playerOvrDiff >= 0 ? `+${bm.playerOvrDiff}` : `${bm.playerOvrDiff}`;
      const ovrColor = bm.playerOvrDiff >= 0 ? "var(--ok-green)" : "var(--crimson)";
      const teamDiffTxt = bm.teamOvrDiff >= 0 ? `+${bm.teamOvrDiff}` : `${bm.teamOvrDiff}`;
      const teamColor = bm.teamOvrDiff >= 0 ? "var(--ok-green)" : "var(--crimson)";
      strip.innerHTML = `
        <div class="ovr-kpi-card highlight">
          <div class="ovr-kpi-lbl">個人總評 OVR</div>
          <div class="ovr-kpi-val">${bm.userOvr}</div>
          <div class="ovr-kpi-cmp" style="color:${ovrColor};">均 ${bm.playerAvgOvr} (${ovrDiffTxt})</div>
        </div>
        <div class="ovr-kpi-card">
          <div class="ovr-kpi-lbl">聯盟球員排名</div>
          <div class="ovr-kpi-val">#${bm.playerOvrRank}</div>
          <div class="ovr-kpi-cmp">全聯盟 ${bm.totalPlayers} 人 · ${bm.userPos} #${bm.posRank}/${bm.posTotal}</div>
        </div>
        <div class="ovr-kpi-card">
          <div class="ovr-kpi-lbl">球隊戰力 OVR</div>
          <div class="ovr-kpi-val">${bm.userTeamOvr}</div>
          <div class="ovr-kpi-cmp" style="color:${teamColor};">均 ${bm.teamAvgOvr} (${teamDiffTxt}) · #${bm.teamOvrRank}/${bm.teamCount}</div>
        </div>`;
    }

    // Enhance Player Season Averages with league baseline comparisons
    const summaryEl = document.getElementById("hubPlayerSummary");
    if (summaryEl) {
      const ppg = st.gp ? Number((st.pts / gp).toFixed(1)) : 0;
      const rpg = st.gp ? Number((st.reb / gp).toFixed(1)) : 0;
      const apg = st.gp ? Number((st.ast / gp).toFixed(1)) : 0;
      const spg = st.gp ? Number((st.stl / gp).toFixed(1)) : 0;
      const bpg = st.gp ? Number((st.blk / gp).toFixed(1)) : 0;
      const cmpMini = (val, base) => {
        if (!st.gp) return `<span style="color:var(--ink-soft); font-size:10px;">(均${base})</span>`;
        const d = Number((val - base).toFixed(1));
        const col = d >= 0 ? "#15803D" : "#C81E1E";
        return `<span style="color:${col}; font-size:10px; font-weight:900;">(${d >= 0 ? "+" : ""}${d} vs 均${base})</span>`;
      };
      const eqSet = new Set(Season.equippedTraits);
      const noise = getJudgmentNoiseBand(Season.careerYear, eqSet, 100);
      summaryEl.innerHTML = `
        <div style="display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:6px;">
          <div class="stat-mini-box"><strong>場均得分 PPG</strong><span><strong>${ppg.toFixed(1)}</strong> ${cmpMini(ppg, bm.avgBase.ppg)}</span></div>
          <div class="stat-mini-box"><strong>場均籃板 RPG</strong><span><strong>${rpg.toFixed(1)}</strong> ${cmpMini(rpg, bm.avgBase.rpg)}</span></div>
          <div class="stat-mini-box"><strong>場均助攻 APG</strong><span><strong>${apg.toFixed(1)}</strong> ${cmpMini(apg, bm.avgBase.apg)}</span></div>
          <div class="stat-mini-box"><strong>抄截 / 封阻</strong><span><strong>${spg.toFixed(1)} / ${bpg.toFixed(1)}</strong></span></div>
        </div>
        <div style="font-size:11.5px; color:var(--ink-soft); display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
          <span class="cmp-badge">出賽 ${st.gp} 場</span>
          <span class="cmp-badge gold">單場 MVP ×${st.mvps || 0}</span>
          <span class="cmp-badge">判讀誤差 ±${noise}%</span>
        </div>`;
    }

    // Enhance Role & Coach Trust with threshold comparison
    const rtBox = document.getElementById("hubRoleTrustBox");
    if (rtBox) {
      const trust = p.coachTrust || 35;
      const nextGate = trust < 40 ? { lbl: "輪換門檻", v: 40 } : (trust < 60 ? { lbl: "先發門檻", v: 60 } : (trust < 80 ? { lbl: "王牌門檻", v: 80 } : { lbl: "絕對核心", v: 100 }));
      const gap = Math.max(0, nextGate.v - trust);
      const trustNote = gap > 0 ? `距${nextGate.lbl}(${nextGate.v})差 ${gap}` : `已達${nextGate.lbl}！`;
      rtBox.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px; font-weight:900;">
          <span>🏅 地位：<strong style="color:var(--crimson);">${rotWin.label}</strong></span>
          <span>教練信任：<strong>${trust}/100</strong> <span class="cmp-badge ${gap === 0 ? "pos" : "gold"}">${trustNote}</span></span>
        </div>
        <div style="margin-top:4px; color:var(--ink-soft);">預估上場：<strong>${Math.round(rotWin.minPct * 100)}%–${Math.round(rotWin.maxPct * 100)}%</strong> ｜ 狀態：<strong>${p.condition}%</strong>（均線 75%）</div>
      `;
    }

    // Enhance Team Strength Tag with league average & rank
    const rTag = document.getElementById("hubTeamStrengthTag");
    if (rTag) {
      const diffTxt = bm.teamOvrDiff >= 0 ? `+${bm.teamOvrDiff}` : `${bm.teamOvrDiff}`;
      rTag.textContent = `戰力 OVR ${bm.userTeamOvr}（聯盟均 ${bm.teamAvgOvr} ${diffTxt} · 排名 #${bm.teamOvrRank}/${bm.teamCount}）`;
    }

    // Enhance Team Ops Banner in 【球隊】
    const teamKpiStrip = document.getElementById("teamBenchmarkStrip");
    if (teamKpiStrip) {
      const ops = ensureTeamOps();
      const chemDiff = (ops.chemistry || 65) - 65;
      teamKpiStrip.innerHTML = `
        <div class="ovr-kpi-card highlight">
          <div class="ovr-kpi-lbl">球隊戰力 OVR</div>
          <div class="ovr-kpi-val">${bm.userTeamOvr}</div>
          <div class="ovr-kpi-cmp">聯盟均 ${bm.teamAvgOvr}（${bm.teamOvrDiff >= 0 ? "+" : ""}${bm.teamOvrDiff}）</div>
        </div>
        <div class="ovr-kpi-card">
          <div class="ovr-kpi-lbl">戰力 / 積分排名</div>
          <div class="ovr-kpi-val">#${bm.teamOvrRank} / #${bm.standingRank}</div>
          <div class="ovr-kpi-cmp">共 ${bm.teamCount} 支球隊</div>
        </div>
        <div class="ovr-kpi-card">
          <div class="ovr-kpi-lbl">球隊化學反應</div>
          <div class="ovr-kpi-val">${ops.chemistry}</div>
          <div class="ovr-kpi-cmp">均線 65（${chemDiff >= 0 ? "+" : ""}${chemDiff}）</div>
        </div>`;
    }

    // Render 12-man roster cards (default 5 starters)
    renderRosterCards(bm);
  }

  function render12StatGridWithCompare(st, lastDelta = null, heightCm = null) {
    const bm = computeLeagueBenchmarks();
    const fmtD = (k) => {
      if (!lastDelta || !lastDelta[k]) return "";
      const v = lastDelta[k];
      return v > 0
        ? `<span style="color:#15803D; font-size:10px; margin-left:2px;">▲+${v}</span>`
        : `<span style="color:#C81E1E; font-size:10px; margin-left:2px;">▼${v}</span>`;
    };
    const posBaseH = (window.POS_HEIGHT_BASE && Season && Season.player) ? (POS_HEIGHT_BASE[Season.player.pos] || 186) : 186;
    const hDiff = heightCm !== null ? heightCm - posBaseH : 0;
    const hCell = heightCm !== null
      ? `<div class="stat-mini-box" style="background:#FEFCE8; border-color:var(--ink);">
           <div class="stat-mini-top"><span>身高</span><span style="color:#1D4ED8; font-weight:900;">${heightCm}cm${fmtD("heightCm")}</span></div>
           <div class="stat-mini-cmp ${hDiff >= 0 ? "up" : "down"}">同位均${posBaseH} (${hDiff >= 0 ? "+" : ""}${hDiff})</div>
         </div>`
      : "";

    return `<div class="stat-mini-grid" style="grid-template-columns:repeat(auto-fit, minmax(100px, 1fr));">` +
      hCell +
      DB.origins.statDefs.map(d => {
        const val = st[d.k] || 60;
        const avg = (bm && bm.statAvgs && bm.statAvgs[d.k]) ? bm.statAvgs[d.k] : 70;
        const diff = val - avg;
        const cls = diff >= 2 ? "up" : (diff <= -2 ? "down" : "");
        return `<div class="stat-mini-box">
          <div class="stat-mini-top">
            <span>${d.l}</span>
            <span style="color:${val >= 80 ? "#C81E1E" : "#111"}; font-weight:900;">${val}${fmtD(d.k)}</span>
          </div>
          <div class="stat-mini-cmp ${cls}">均${avg} (${diff >= 0 ? "+" : ""}${diff})</div>
        </div>`;
      }).join("") +
      `</div>`;
  }

  /* -------------------- 3. PRE-MATCH COACH DIRECTIVE 3-CHOICE -------------------- */
  function openPreMatchFocus(actionType) {
    pendingFocusAction = actionType;
    const modal = document.getElementById("preMatchFocusModal");
    if (!modal || !window.Season) {
      if (actionType === "SIM") simCurrentRoundQuick();
      else launchSeasonMatch();
      return;
    }

    const g = Season.schedule[Season.currentRoundIdx];
    const userTeam = Season.standings.find(t => t.isUserTeam) || { name: "我方" };
    const bm = computeLeagueBenchmarks();
    const rotKey = Season.rotationKey || "ROOKIE";

    const oppObj = Season.standings.find(t => t.id === (g && g.oppId));
    const oppOvr = oppObj ? (oppObj.ovr || 78) : 78;
    const headerSub = document.getElementById("pmFocusMatchup");
    if (headerSub && g) {
      headerSub.textContent = `${userTeam.name} (OVR ${bm ? bm.userTeamOvr : "--"}) VS ${g.oppName} (OVR ${oppOvr}) · 王牌 ${g.oppAce}`;
    }

    const modeTag = document.getElementById("pmFocusModeTag");
    if (modeTag) modeTag.textContent = actionType === "SIM" ? "快速模擬模式" : "親自落場作戰";

    const grid = document.getElementById("pmFocusGrid");
    grid.innerHTML = COACH_FOCUS_OPTIONS.map(opt => {
      const goal = opt.buildGoal(rotKey);
      return `
        <button type="button" class="focus-card" data-focus-id="${opt.id}">
          <div class="focus-card-top">
            <span class="focus-card-title">${opt.icon} ${opt.title}</span>
            <span class="focus-card-tag">${opt.tag}</span>
          </div>
          <div class="focus-card-quote">${opt.quote}</div>
          <div class="focus-card-fx">${opt.fx}</div>
          <div class="focus-card-reward">🎯 達標：${goal.label} ｜ ${goal.rewardText}</div>
        </button>`;
    }).join("");

    modal.classList.remove("hidden");
  }

  function selectCoachFocusAndStart(focusId) {
    const opt = COACH_FOCUS_OPTIONS.find(x => x.id === focusId) || COACH_FOCUS_OPTIONS[0];
    const rotKey = (window.Season && Season.rotationKey) || "ROOKIE";
    const goal = opt.buildGoal(rotKey);
    activeCoachFocus = {
      id: opt.id,
      icon: opt.icon,
      title: opt.title,
      tag: opt.tag,
      target: goal.target,
      label: goal.label,
      rewardText: goal.rewardText
    };
    if (window.Match) Match.coachFocus = { ...activeCoachFocus };

    // Capture pre-match player snapshot for accurate post-match 3-progress diff
    capturePreMatchSnapshot();

    document.getElementById("preMatchFocusModal").classList.add("hidden");
    const act = pendingFocusAction;
    pendingFocusAction = null;
    if (act === "SIM") simCurrentRoundQuick();
    else launchSeasonMatch();
  }

  function getActiveCoachFocus() {
    if (window.Match && Match.coachFocus) return Match.coachFocus;
    return activeCoachFocus;
  }

  function evaluateCoachFocusPostMatch(userBox) {
    const f = getActiveCoachFocus();
    if (!f || !Season || !Season.player) return null;
    const opt = COACH_FOCUS_OPTIONS.find(x => x.id === f.id);
    if (!opt) return null;
    const goal = opt.buildGoal(Season.rotationKey || "ROOKIE");
    const met = goal.check(userBox || {});
    let rewardApplied = "";
    if (met) {
      rewardApplied = goal.applyReward(Season.player, Season);
    }
    const result = {
      id: f.id,
      icon: f.icon,
      title: f.title,
      label: goal.label,
      met,
      progress: goal.progressText(userBox || {}),
      rewardApplied
    };
    activeCoachFocus = null;
    if (window.Match) Match.coachFocus = null;
    return result;
  }

  function capturePreMatchSnapshot() {
    if (!window.Season || !Season.player) return;
    const p = Season.player;
    const bm = computeLeagueBenchmarks();
    preMatchSnapshot = {
      ovr: calcOVR(p.stats, p.pos, Season.equippedTraits),
      trust: p.coachTrust || 35,
      condition: p.condition || 100,
      reputation: p.reputation || 45,
      heightCm: p.heightCm || 185,
      stats: { ...(p.stats || {}) },
      standingRank: bm ? bm.standingRank : 1
    };
  }

  function takePlayerSnapshot() {
    if (!window.Season || !Season.player) return null;
    const p = Season.player;
    return {
      ovr: calcOVR(p.stats, p.pos, Season.equippedTraits),
      trust: p.coachTrust || 35,
      condition: p.condition || 100,
      reputation: p.reputation || 45,
      rivalHeat: p.rivalHeat || 35,
      heightCm: p.heightCm || 185,
      ap: p.ap || 0,
      stats: { ...(p.stats || {}) },
      traitsCount: (Season.equippedTraits || []).length
    };
  }

  /* -------------------- 2. UNIFIED SETTLEMENT MODAL -------------------- */
  function buildNextMatchGoalText() {
    if (!window.Season) return "繼續備戰下一場比賽！";
    if (Season.retired) return "生涯已榮耀謝幕，隨時可點擊「新建生涯」開啟下一段籃球傳奇！";
    if (Season.currentRoundIdx >= Season.schedule.length) {
      return "本季賽程已全部結束！點擊頂部「🏆 壓縮賽季進入下一年」邁向新階段。";
    }
    const g = Season.schedule[Season.currentRoundIdx];
    const p = Season.player;
    if (p && p.ap > 0) {
      return p.condition < 65
        ? `下一戰對決 ${g.oppName}（王牌：${g.oppAce}）· 尚餘 ${p.ap} AP，建議先做「🧊 冰浴理療」恢復狀態再出賽。`
        : `下一戰對決 ${g.oppName}（王牌：${g.oppAce}）· 尚餘 ${p.ap} AP，可先去【我】完成特訓提升屬性！`;
    }
    const trust = (p && p.coachTrust) || 35;
    const trustGoal = trust < 60 ? "並衝刺教練信任至 60 搶佔先發" : "穩固主力地位衝擊季後賽";
    return `下一戰 ${g.isHome ? "主場" : "客場"} 迎戰 ${g.oppName}（王牌：${g.oppAce}）：鎖定勝利${trustGoal}！`;
  }

  function showUnifiedSettlement(cfg) {
    const modal = document.getElementById("unifiedSettlementModal");
    if (!modal) return;

    document.getElementById("settleKindStamp").textContent = cfg.stamp || "結算報告";
    document.getElementById("settleSubTag").textContent = cfg.subTag || "";
    document.getElementById("settleMvpBadge").textContent = cfg.mvpBadge || "🏆 MVP 時刻";
    document.getElementById("settleMvpTitle").textContent = cfg.mvpTitle || "";
    document.getElementById("settleMvpSub").textContent = cfg.mvpSub || "";

    const fvEl = document.getElementById("settleFocusVerdict");
    if (fvEl) {
      if (cfg.focusResult) {
        const fr = cfg.focusResult;
        fvEl.style.display = "block";
        fvEl.className = `focus-verdict-pill ${fr.met ? "met" : "missed"}`;
        fvEl.innerHTML = fr.met
          ? `🎯 教練指令【${fr.title}】達成！（${fr.progress}）→ 額外獲得：<strong>${fr.rewardApplied}</strong>`
          : `📋 教練指令【${fr.title}】未達標（${fr.progress} · 目標：${fr.label}）`;
      } else {
        fvEl.style.display = "none";
      }
    }

    // Ensure exactly 3 progress cards
    const gains = (cfg.gains || []).slice(0, 3);
    while (gains.length < 3) {
      gains.push({ label: "目前總評 OVR", value: `${Season && Season.player ? calcOVR(Season.player.stats, Season.player.pos, Season.equippedTraits) : "--"}`, dir: "flat", note: "穩步累積" });
    }
    document.getElementById("settleGainsGrid").innerHTML = gains.map(g => `
      <div class="progress-item-card">
        <div class="progress-item-label">${g.label}</div>
        <div class="progress-item-val ${g.dir || "flat"}">${g.value}</div>
        ${g.note ? `<div class="progress-item-note">${g.note}</div>` : ""}
      </div>
    `).join("");

    document.getElementById("settleNextGoalText").textContent = cfg.nextGoal || buildNextMatchGoalText();

    const extraBtn = document.getElementById("btnSettleViewBoxScore");
    if (extraBtn) {
      if (cfg.onViewBoxScore) {
        extraBtn.style.display = "inline-flex";
        extraBtn.onclick = () => {
          modal.classList.add("hidden");
          cfg.onViewBoxScore();
        };
      } else {
        extraBtn.style.display = "none";
        extraBtn.onclick = null;
      }
    }

    const contBtn = document.getElementById("btnSettleContinue");
    const bar = document.getElementById("settleUnlockBar");
    settlementOnContinue = cfg.onContinue || null;

    // Anti-misclick 0.42s unlock bar
    if (settlementUnlockTimer) clearTimeout(settlementUnlockTimer);
    contBtn.disabled = true;
    contBtn.querySelector(".cont-txt").textContent = cfg.continueLabel || "繼續 ▶";
    if (bar) {
      bar.style.transition = "none";
      bar.style.width = "0%";
      requestAnimationFrame(() => {
        bar.style.transition = "width 0.42s linear";
        bar.style.width = "100%";
      });
    }
    settlementUnlockTimer = setTimeout(() => {
      contBtn.disabled = false;
    }, 420);

    modal.classList.remove("hidden");
  }

  function buildGainsFromSnapshots(before, after, extras = []) {
    const gains = [];
    const statDefs = (DB.origins && DB.origins.statDefs) || [];
    if (before && after && before.stats && after.stats) {
      for (const d of statDefs) {
        const b = before.stats[d.k], a = after.stats[d.k];
        if (typeof b === "number" && typeof a === "number" && a !== b) {
          gains.push({
            label: d.l,
            value: `${b}→${a}${a > b ? "↑" : "↓"}`,
            dir: a > b ? "up" : "down",
            note: a > b ? `+${a - b} 成長` : `${a - b} 變動`
          });
        }
      }
    }
    if (before && after && after.heightCm !== before.heightCm) {
      gains.push({
        label: "身高發育",
        value: `${before.heightCm}→${after.heightCm}cm↑`,
        dir: "up",
        note: `+${after.heightCm - before.heightCm}cm`
      });
    }
    if (before && after && after.ovr !== before.ovr) {
      gains.push({
        label: "總評 OVR",
        value: `${before.ovr}→${after.ovr}${after.ovr > before.ovr ? "↑" : "↓"}`,
        dir: after.ovr > before.ovr ? "up" : "down",
        note: "綜合戰力變化"
      });
    }
    if (before && after && after.trust !== before.trust) {
      gains.push({
        label: "教練信任",
        value: `${before.trust}→${after.trust}${after.trust > before.trust ? "↑" : "↓"}`,
        dir: after.trust > before.trust ? "up" : "down",
        note: after.trust > before.trust ? "輪換更穩固" : "需用表現挽回"
      });
    }
    if (before && after && after.reputation !== before.reputation) {
      gains.push({
        label: "個人名氣",
        value: `${before.reputation}→${after.reputation}${after.reputation > before.reputation ? "↑" : "↓"}`,
        dir: after.reputation > before.reputation ? "up" : "down",
        note: "球探關注度"
      });
    }
    if (before && after && after.condition !== before.condition) {
      gains.push({
        label: "賽季狀態",
        value: `${before.condition}%→${after.condition}%${after.condition > before.condition ? "↑" : "↓"}`,
        dir: after.condition > before.condition ? "up" : "down",
        note: after.condition >= 80 ? "狀態火熱" : (after.condition < 55 ? "建議恢復" : "體能可控")
      });
    }
    for (const ex of extras) {
      if (gains.length < 3) gains.push(ex);
    }
    return gains.slice(0, 3);
  }

  function showPostMatchSettlement(opts) {
    const after = takePlayerSnapshot();
    const bm = computeLeagueBenchmarks();
    const extras = [
      {
        label: "本場個人表現",
        value: `${opts.userPts}分 ${opts.userReb}板 ${opts.userAst}助`,
        dir: opts.won ? "up" : "flat",
        note: opts.won ? "率隊取勝" : "吸取經驗"
      },
      {
        label: "總評 OVR 對比",
        value: `${bm ? bm.userOvr : after.ovr}（均${bm ? bm.playerAvgOvr : "--"}）`,
        dir: (bm && bm.playerOvrDiff >= 0) ? "up" : "flat",
        note: bm ? `全聯盟 #${bm.playerOvrRank}/${bm.totalPlayers}` : ""
      },
      {
        label: "本週行動點",
        value: `已補滿 2 AP↑`,
        dir: "up",
        note: "可回【我】特訓"
      }
    ];
    const gains = buildGainsFromSnapshots(preMatchSnapshot, after, extras);
    preMatchSnapshot = null;

    showUnifiedSettlement({
      stamp: opts.isTutorial ? "🎓 教學賽完場" : (opts.won ? "🏆 賽後結算 · VICTORY" : "🏀 賽後結算 · FINAL"),
      subTag: opts.scoreLine || "",
      mvpBadge: opts.isTutorial ? "⭐ 新秀初登場時刻" : "🏆 本場 MVP 時刻",
      mvpTitle: opts.mvpTitle,
      mvpSub: opts.mvpSub,
      focusResult: opts.focusResult || null,
      gains,
      nextGoal: opts.nextGoal || buildNextMatchGoalText(),
      continueLabel: opts.continueLabel || "繼續 ▶",
      onViewBoxScore: opts.onViewBoxScore || null,
      onContinue: opts.onContinue || null
    });
  }

  function showTrainingSettlement(before, title, detail, tier) {
    const after = takePlayerSnapshot();
    const bm = computeLeagueBenchmarks();
    const extras = [
      {
        label: "總評 OVR",
        value: `${after.ovr}（均${bm ? bm.playerAvgOvr : "--"}）`,
        dir: after.ovr > before.ovr ? "up" : "flat",
        note: bm ? `聯盟 #${bm.playerOvrRank}` : ""
      },
      {
        label: "剩餘行動點",
        value: `${before.ap}→${after.ap} AP`,
        dir: "flat",
        note: after.ap > 0 ? "還可繼續安排" : "可開打下場比賽"
      },
      {
        label: "賽季狀態",
        value: `${after.condition}%`,
        dir: after.condition >= 75 ? "up" : "down",
        note: after.condition >= 75 ? "狀態良好" : "注意疲勞"
      }
    ];
    const gains = buildGainsFromSnapshots(before, after, extras);
    const badgeMap = {
      GREAT: "✨ 特訓大成功時刻",
      SUCCESS: "✅ 訓練達標時刻",
      FAIL: "⚠️ 訓練波折時刻",
      INJURY: "🚑 傷病警示時刻"
    };
    showUnifiedSettlement({
      stamp: "🏋️ 場外訓練結算",
      subTag: `尚餘 ${after.ap} AP`,
      mvpBadge: badgeMap[tier] || "🏋️ 訓練時刻",
      mvpTitle: title,
      mvpSub: detail,
      gains,
      nextGoal: buildNextMatchGoalText(),
      continueLabel: "繼續 ▶"
    });
  }

  function showEventSettlement(before, evtTitle, ok, outText) {
    const after = takePlayerSnapshot();
    const bm = computeLeagueBenchmarks();
    const extras = [
      {
        label: "總評 OVR",
        value: `${after.ovr}（均${bm ? bm.playerAvgOvr : "--"}）`,
        dir: after.ovr > before.ovr ? "up" : "flat",
        note: bm ? `聯盟 #${bm.playerOvrRank}` : ""
      },
      {
        label: "教練信任",
        value: `${after.trust} / 100`,
        dir: after.trust > before.trust ? "up" : "flat",
        note: "隊內地位指標"
      },
      {
        label: "個人名氣",
        value: `${after.reputation} / 100`,
        dir: after.reputation > before.reputation ? "up" : "flat",
        note: "球探與媒體熱度"
      }
    ];
    const gains = buildGainsFromSnapshots(before, after, extras);
    showUnifiedSettlement({
      stamp: "📅 生涯事件結算",
      subTag: ok ? "✅ 順利化解" : "⚠️ 歷練考驗",
      mvpBadge: ok ? "🌟 關鍵人生時刻" : "⚡ 成長轉折時刻",
      mvpTitle: evtTitle,
      mvpSub: outText,
      gains,
      nextGoal: buildNextMatchGoalText(),
      continueLabel: "繼續 ▶"
    });
  }

  /* -------------------- 6. TITLE SCREEN & 3-STEP ONBOARDING + TUTORIAL MATCH -------------------- */
  function showTitleScreen(hasSave) {
    ["viewHub", "viewMatch", "viewCreate"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove("active");
    });
    const titleView = document.getElementById("viewTitle");
    if (!titleView) return;
    titleView.classList.add("active");

    const contBtn = document.getElementById("btnTitleContinue");
    const startBtn = document.getElementById("btnTitleStartNew");
    const saveInfo = document.getElementById("titleSaveInfo");

    if (hasSave && window.Season && Season.player) {
      const league = DB.leagues.leagues.find(l => l.id === Season.leagueId) || DB.leagues.leagues[0];
      const ovr = calcOVR(Season.player.stats, Season.player.pos, Season.equippedTraits);
      const ut = Season.standings.find(t => t.isUserTeam) || { name: "", w: 0, l: 0 };
      if (contBtn) {
        contBtn.style.display = "inline-flex";
        contBtn.textContent = `🏀 繼續生涯（${Season.player.name} · OVR ${ovr}）`;
      }
      if (startBtn) {
        startBtn.className = "manga-btn title-secondary-btn";
        startBtn.textContent = "✨ 開始新遊戲（3 步新手引導）";
      }
      if (saveInfo) {
        saveInfo.style.display = "block";
        saveInfo.innerHTML = `💾 <strong>已讀取 IndexedDB 生涯存檔</strong>：第 ${Season.careerYear} 季 · ${league.name} · ${ut.name}（${ut.w}勝${ut.l}負）`;
      }
    } else {
      if (contBtn) contBtn.style.display = "none";
      if (startBtn) {
        startBtn.className = "manga-btn primary title-primary-btn";
        startBtn.textContent = "🏀 開始遊戲";
      }
      if (saveInfo) saveInfo.style.display = "none";
    }
  }

  function renderPosPickCards() {
    const box = document.getElementById("posPickGrid");
    const sel = document.getElementById("inpPlayerPos");
    if (!box || !sel) return;
    const cur = sel.value || "SG";
    box.innerHTML = POS_CARDS.map(p => `
      <button type="button" class="pos-pick-card ${p.code === cur ? "selected" : ""}" data-pick-pos="${p.code}">
        <div class="pos-pick-code">${p.name}</div>
        <div class="pos-pick-desc">${p.desc}</div>
      </button>
    `).join("");
  }

  function setCreateStep(step) {
    currentCreateStep = step;
    [1, 2, 3].forEach(n => {
      const pill = document.getElementById(`onboardStepPill${n}`);
      if (pill) {
        pill.classList.remove("active", "done");
        if (n < step) pill.classList.add("done");
        else if (n === step) pill.classList.add("active");
      }
      const panel = document.getElementById(`createStep${n}`);
      if (panel) panel.style.display = (n === step) ? "block" : "none";
    });
    if (step === 1) renderPosPickCards();
    if (step === 2 && typeof buildCreationDraft === "function") buildCreationDraft(false);
    if (step === 3) {
      const sum = document.getElementById("step3PlayerSummary");
      if (sum && window.Season && Season.player) {
        const p = Season.player;
        const ovr = calcOVR(p.stats, p.pos, Season.equippedTraits);
        sum.innerHTML = `<strong>#${p.jerseyNum || 16} ${p.name}</strong>（${p.pos} · ${p.heightCm}cm）｜天賦：<strong>${p.rarityName}</strong>（上限 ${p.cap}）｜初始 OVR：<strong>${ovr}</strong>`;
      }
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function launchTutorialMatch() {
    if (!window.Season || !Season.player) return;
    isTutorialMatch = true;
    clearPendingEventTimer();
    hideSkillPopover();

    const league = DB.leagues.leagues.find(l => l.id === Season.leagueId) || DB.leagues.leagues[0];
    const userTeamObj = league.teams.find(t => t.isUserTeam) || league.teams[0];
    const oppTeamObj = league.teams.find(t => !t.isUserTeam) || league.teams[1];

    Match.league = { ...league, quarterMinutes: 2, otMinutes: 1 };
    Match.homeName = `${userTeamObj.name} · 新秀隊`;
    Match.awayName = `${oppTeamObj.name} · 試訓隊`;
    syncUserTeamRole(false);
    Match.homeTeam = Season.userRoster.map(p => createPlayer(p, "HOME"));
    Match.awayTeam = buildOpponentRoster(oppTeamObj).map(p => createPlayer(p, "AWAY"));
    Match.userPlayer = Match.homeTeam.find(p => p.isUser) || Match.homeTeam[1];
    Match.rivalPlayer = Match.awayTeam.find(p => p.isRival) || Match.awayTeam[2];

    // Ensure user starts on floor during tutorial scrimmage
    if (!Match.userPlayer.onFloor) {
      const swapOut = Match.homeTeam.find(p => !p.isUser && p.onFloor);
      if (swapOut) swapOut.onFloor = false;
      Match.userPlayer.onFloor = true;
    }
    Match.userPlayer.stamina = 100;
    Match.userPlayer.maxStaminaCap = 100;

    // 1-quarter fast 2-minute scrimmage (start at Q4 so it finishes right after 1 quarter!)
    Match.quarter = 4;
    Match.timeLeftSec = 120;
    Match.homeScore = 18;
    Match.awayScore = 16;
    Match.qScoresHome = [6, 6, 6, 0];
    Match.qScoresAway = [6, 5, 5, 0];
    Match.benchReason = "";
    Match.totalGameSec = 0;
    Match.tension = 78; // High tension so tutorial Bullet Time + QTE triggers right away!
    Match.cooldownSec = 0;
    Match.userSubCooldownSec = 999;
    Match.rivalHardTriggersThisQ = 0;
    Match.makeStreak = 0;
    Match.missStreak = 0;
    Match.perfectStreak = 0;
    Match.perfectsTotal = 0;
    Match.isZone = false;
    Match.zonePossessionsLeft = 0;
    Match.isGrit = false;
    Match.recentActionIds = [];
    Match.commHistory = [];
    Match.shotAnim = null;
    Match.activeScenario = null;
    Match.pendingPostCutIn = null;
    Match.coachFocus = null;

    document.getElementById("pbpLog").innerHTML = "";
    document.getElementById("viewCreate").classList.remove("active");
    document.getElementById("viewHub").classList.remove("active");
    document.getElementById("viewTitle").classList.remove("active");
    document.getElementById("viewMatch").classList.add("active");
    document.getElementById("boxScoreModal").classList.add("hidden");
    setDockMode("NONE");
    resizeCanvas();

    Match.fastSimming = false;
    const fbtn = document.getElementById("btnFastSimMatch");
    if (fbtn) fbtn.disabled = false;
    Match.phase = "PLAYING";
    Match.simAccumulator = 0;
    SoundFX.whistle();
    broadcast("🎓 【新手教學賽】最後 2 分鐘決勝試訓！留意「子彈時間」選卡與 QTE 黃金區間鎖定！", true);
    updateHUD();
  }

  function handleTutorialMatchEnd() {
    isTutorialMatch = false;
    const u = Match.userPlayer || { pts: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0 };
    const won = Match.homeScore >= Match.awayScore;
    if (Season && Season.player) {
      Season.player.tutorialDone = true;
      SaveManager.save(Season);
    }
    Match.phase = "IDLE";
    document.getElementById("viewMatch").classList.remove("active");
    document.getElementById("viewHub").classList.add("active");
    switchHubTab("htab-match");
    renderHub();

    showUnifiedSettlement({
      stamp: "🎓 教學賽完成！",
      subTag: `試訓比分 ${Match.homeScore} : ${Match.awayScore}`,
      mvpBadge: "⭐ 新手引導 3/3 達成",
      mvpTitle: `${Season.player.name} 完成高一入隊試訓！`,
      mvpSub: `教學賽拿下 ${u.pts} 分 ${(u.oreb || 0) + (u.dreb || 0)} 板 ${u.ast} 助（本場不計入正式戰績）。你已經掌握子彈時間與 QTE 節奏！`,
      gains: [
        { label: "教學賽得分", value: `${u.pts} 分`, dir: u.pts > 0 ? "up" : "flat", note: "試訓手感熱身" },
        { label: "完美判定次數", value: `${Match.perfectsTotal || 0} 次`, dir: (Match.perfectsTotal || 0) > 0 ? "up" : "flat", note: "QTE 精準鎖定" },
        { label: "正式球季 AP", value: "2 / 2 AP↑", dir: "up", note: "已解鎖場外特訓" }
      ],
      nextGoal: "正式踏入日本全國高校大賽！先點頂部「開始下一場比賽」或去【我】完成 2 AP 特訓。",
      continueLabel: "🏀 進入球季大廳 ▶"
    });
  }

  /* -------------------- BIND REFACTOR EVENTS -------------------- */
  function bindRefactorEvents() {
    // Top Big CTA
    const bigCta = document.getElementById("btnTopBigCta");
    if (bigCta) {
      bigCta.addEventListener("click", () => {
        const mode = bigCta.dataset.ctaMode;
        if (mode === "NEW_CAREER") openCareerCreation();
        else if (mode === "NEXT_SEASON") openSeasonEndCrossroads();
        else requestStartMatchOrSim("PLAY");
      });
    }

    // Utility drawer toggle in top bar
    const utilToggle = document.getElementById("btnToggleUtilDrawer");
    const utilDrawer = document.getElementById("topUtilDrawer");
    if (utilToggle && utilDrawer) {
      utilToggle.addEventListener("click", () => {
        utilDrawer.classList.toggle("open");
      });
    }

    // Toggle bench roster
    const benchBtn = document.getElementById("btnToggleBenchRoster");
    if (benchBtn) {
      benchBtn.addEventListener("click", () => {
        rosterExpanded = !rosterExpanded;
        renderRosterCards(computeLeagueBenchmarks());
      });
    }

    // Pre-match coach focus selection
    const pmGrid = document.getElementById("pmFocusGrid");
    if (pmGrid) {
      pmGrid.addEventListener("click", (e) => {
        const card = e.target.closest("[data-focus-id]");
        if (!card) return;
        SoundFX.tap();
        selectCoachFocusAndStart(card.dataset.focusId);
      });
    }
    const pmCancel = document.getElementById("btnPmFocusCancel");
    if (pmCancel) {
      pmCancel.addEventListener("click", () => {
        pendingFocusAction = null;
        document.getElementById("preMatchFocusModal").classList.add("hidden");
      });
    }

    // Unified settlement continue
    const contBtn = document.getElementById("btnSettleContinue");
    if (contBtn) {
      contBtn.addEventListener("click", () => {
        if (contBtn.disabled) return;
        document.getElementById("unifiedSettlementModal").classList.add("hidden");
        const cb = settlementOnContinue;
        settlementOnContinue = null;
        if (typeof cb === "function") cb();
      });
    }

    // Title screen buttons
    const titleCont = document.getElementById("btnTitleContinue");
    if (titleCont) {
      titleCont.addEventListener("click", () => {
        document.getElementById("viewTitle").classList.remove("active");
        document.getElementById("viewHub").classList.add("active");
        switchHubTab("htab-match");
        renderHub();
        const cp = getValidMatchCheckpoint();
        if (cp) restoreMatchFromCheckpoint(cp);
      });
    }
    const titleNew = document.getElementById("btnTitleStartNew");
    if (titleNew) {
      titleNew.addEventListener("click", () => {
        document.getElementById("viewTitle").classList.remove("active");
        openCareerCreation();
      });
    }

    // Onboarding Step 1: position cards + next
    const posGrid = document.getElementById("posPickGrid");
    if (posGrid) {
      posGrid.addEventListener("click", (e) => {
        const card = e.target.closest("[data-pick-pos]");
        if (!card) return;
        const sel = document.getElementById("inpPlayerPos");
        if (sel) sel.value = card.dataset.pickPos;
        renderPosPickCards();
        if (typeof buildCreationDraft === "function") buildCreationDraft(false);
        SoundFX.tap();
      });
    }
    const toStep2 = document.getElementById("btnStep1Next");
    if (toStep2) toStep2.addEventListener("click", () => { SoundFX.tap(); setCreateStep(2); });

    const backStep1 = document.getElementById("btnStep2Back");
    if (backStep1) backStep1.addEventListener("click", () => { SoundFX.tap(); setCreateStep(1); });

    const startTutBtn = document.getElementById("btnStartTutorialMatch");
    if (startTutBtn) startTutBtn.addEventListener("click", () => { SoundFX.tap(); launchTutorialMatch(); });

    const skipTutBtn = document.getElementById("btnSkipTutorialMatch");
    if (skipTutBtn) {
      skipTutBtn.addEventListener("click", () => {
        if (Season && Season.player) {
          Season.player.tutorialDone = true;
          SaveManager.save(Season);
        }
        document.getElementById("viewCreate").classList.remove("active");
        document.getElementById("viewHub").classList.add("active");
        switchHubTab("htab-match");
        renderHub();
      });
    }
  }

  return {
    computeLeagueBenchmarks,
    switchHubTab,
    updateTopStickyCTA,
    enhanceHubDisplays,
    render12StatGridWithCompare,
    openPreMatchFocus,
    getActiveCoachFocus,
    evaluateCoachFocusPostMatch,
    capturePreMatchSnapshot,
    takePlayerSnapshot,
    showPostMatchSettlement,
    showTrainingSettlement,
    showEventSettlement,
    showTitleScreen,
    setCreateStep,
    launchTutorialMatch,
    handleTutorialMatchEnd,
    isTutorialActive: () => isTutorialMatch,
    bindRefactorEvents
  };
})();
