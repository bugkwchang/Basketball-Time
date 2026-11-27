/* =========================================================================
   《Basketball Time》UI Refactor Controller v2 (ui-refactor.js)
   - One-page mobile Hub with drill-down modals (Match / Me / Team)
   - Compact Live Match HUD + floating Live Detailed Stats modal
   - Pre-Match Coach Directive with real Trust & Chemistry defiance penalties
   - Clickable Player Detail Cards everywhere
   - Clean talent roll without avg diffs & robust tutorial match
   ========================================================================= */

window.BTUI = (() => {
  const getSeason = () => (typeof Season !== "undefined" ? Season : null);
  const getDB = () => (typeof DB !== "undefined" ? DB : null);
  const getMatch = () => (typeof Match !== "undefined" ? Match : null);
  const getPosHeightBase = () =>
    (typeof POS_HEIGHT_BASE !== "undefined" ? POS_HEIGHT_BASE : { PG: 178, SG: 185, SF: 192, PF: 198, C: 205 });

  let rosterExpanded = false;
  let currentCreateStep = 1;
  let pendingFocusAction = null;
  let activeCoachFocus = null;
  let isTutorialMatch = false;
  let preMatchSnapshot = null;
  let settlementOnContinue = null;
  let settlementUnlockTimer = null;
  let activeDrawerSectionId = null;
  let phaseBeforeLiveDetail = null;

  const COACH_FOCUS_OPTIONS = [
    {
      id: "SCORE_ATTACK",
      icon: "🔥",
      title: "火力全開 · 進攻終結",
      tag: "得分專注",
      quote: "「拉開空間，這場你負責終結！」",
      fx: "出手權重↑ · 命中 +3.5% · 張力 +15%（體力消耗 +6%）",
      buildGoal: (rotKey, uOvr = 72) => {
        const roleBase = rotKey === "ACE" ? 18 : (rotKey === "STAR" ? 16 : (rotKey === "STARTER" ? 14 : (rotKey === "ROTATION" ? 10 : 8)));
        const target = Math.max(6, Math.round(roleBase + Math.max(-2, Math.min(4, (uOvr - 72) * 0.2))));
        return {
          target,
          label: `本場得分 ≥ ${target} 分`,
          rewardText: "達標：教練信任 +4、個人名氣 +3",
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
      quote: "「多看空檔，用傳球撕開防線！」",
      fx: "失誤率 -2.5% · 隊友命中 +3% · 助攻權重↑",
      buildGoal: (rotKey, uOvr = 72) => {
        const roleBase = (rotKey === "ACE" || rotKey === "STAR") ? 6 : (rotKey === "STARTER" ? 5 : (rotKey === "ROTATION" ? 3 : 2));
        const target = Math.max(2, roleBase);
        return {
          target,
          label: `本場助攻 ≥ ${target} 次且失誤 ≤ 3`,
          rewardText: "達標：教練信任 +5、球隊化學反應 +2",
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
      quote: "「貼死對方王牌，拚下每個籃板！」",
      fx: "對手命中 -3.5% · 抄截／封阻／籃板權重↑",
      buildGoal: (rotKey, uOvr = 72) => {
        const roleBase = (rotKey === "ACE" || rotKey === "STAR") ? 9 : (rotKey === "STARTER" ? 7 : (rotKey === "ROTATION" ? 5 : 4));
        const target = Math.max(4, roleBase);
        return {
          target,
          label: `防守貢獻（板 + 抄×2 + 帽×2）≥ ${target}`,
          rewardText: "達標：教練信任 +4、賽後體能額外保留 +4%",
          check: (u) => ((u.oreb || 0) + (u.dreb || 0) + (u.stl || 0) * 2 + (u.blk || 0) * 2) >= target,
          progressText: (u) => {
            const val = (u.oreb || 0) + (u.dreb || 0) + (u.stl || 0) * 2 + (u.blk || 0) * 2;
            return `防守分 ${val} / ${target}`;
          },
          applyReward: (p) => {
            p.coachTrust = Math.min(100, (p.coachTrust || 35) + 4);
            p.condition = Math.min(100, (typeof p.condition === "number" ? p.condition : 80) + 4);
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

  function escAttr(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function playerNameLinkHtml(name, teamHint = "", extraLabel = "") {
    const display = extraLabel || name;
    return `<button type="button" class="player-name-link" data-player-name="${escAttr(name)}" data-player-team="${escAttr(teamHint)}">${display}</button>`;
  }

  /* -------------------- DRILL-DOWN SECTION MODAL (ONE-PAGE HUB) -------------------- */
  function openSectionModal(title, badge, sectionId) {
    const modal = document.getElementById("hubDetailModal");
    const host = document.getElementById("hubDetailModalBody");
    const shelf = document.getElementById("hubDrawerShelf");
    const sec = document.getElementById(sectionId);
    if (!modal || !host || !shelf || !sec) return;

    // Return any previously mounted section back to shelf
    if (activeDrawerSectionId && activeDrawerSectionId !== sectionId) {
      const prev = document.getElementById(activeDrawerSectionId);
      if (prev) shelf.appendChild(prev);
    }
    activeDrawerSectionId = sectionId;
    document.getElementById("hubDetailModalTitle").textContent = title;
    document.getElementById("hubDetailModalBadge").textContent = badge || "詳細資訊";
    host.appendChild(sec);
    modal.classList.remove("hidden");
  }

  function closeSectionModal() {
    const modal = document.getElementById("hubDetailModal");
    const shelf = document.getElementById("hubDrawerShelf");
    if (activeDrawerSectionId && shelf) {
      const prev = document.getElementById(activeDrawerSectionId);
      if (prev) shelf.appendChild(prev);
      activeDrawerSectionId = null;
    }
    if (modal) modal.classList.add("hidden");
  }

  function toggleBoxScoreFullMode(forceVal = null) {
    const wrap = document.getElementById("bsRosterWrap");
    const btn = document.getElementById("btnBsToggleFull");
    if (!wrap) return;
    const isFull = forceVal !== null ? Boolean(forceVal) : !wrap.classList.contains("bs-full-mode");
    wrap.classList.toggle("bs-full-mode", isFull);
    if (btn) {
      btn.textContent = isFull ? "📱 切換精簡 6 欄" : "📊 展開詳盡 16 欄";
      btn.className = `manga-btn ${isFull ? "gold" : ""}`;
    }
  }

  function openPlayerMatchStatsPopup(pl, teamName, scoreSub = "") {
    const modal = document.getElementById("liveDetailStatsModal");
    if (!modal || !pl) return;
    phaseBeforeLiveDetail = null;
    document.getElementById("ldsSub").textContent = scoreSub || `${teamName || "單場詳盡數據"}`;
    document.getElementById("ldsPlayerName").innerHTML = `${playerNameLinkHtml(pl.name, teamName, `#${pl.num !== undefined ? pl.num : "--"} ${pl.name} (${pl.pos || "SG"})`)} <span class="tag gold">${pl.role === "STARTER" ? "先發" : "替補"}</span>`;

    const fgPct = pl.fga ? `${Math.round((pl.fgm / pl.fga) * 100)}%` : "—";
    const tpPct = pl.tpa ? `${Math.round((pl.tpm / pl.tpa) * 100)}%` : "—";
    const ftPct = pl.fta ? `${Math.round((pl.ftm / pl.fta) * 100)}%` : "—";
    const reb = (pl.oreb || 0) + (pl.dreb || 0);
    const minStr = typeof formatClock === "function" ? formatClock(pl.secPlayed || 0) : `${Math.round((pl.secPlayed || 0) / 60)}:00`;
    document.getElementById("ldsStatGrid").innerHTML = `
      <div class="live-stat-box"><div class="lbl">得分 PTS</div><div class="val">${pl.pts || 0}</div></div>
      <div class="live-stat-box"><div class="lbl">籃板 (進/防)</div><div class="val" style="font-size:15px;">${reb} (${pl.oreb || 0}/${pl.dreb || 0})</div></div>
      <div class="live-stat-box"><div class="lbl">助攻 AST</div><div class="val">${pl.ast || 0}</div></div>
      <div class="live-stat-box"><div class="lbl">抄截 / 封阻</div><div class="val">${pl.stl || 0} / ${pl.blk || 0}</div></div>
      <div class="live-stat-box"><div class="lbl">投籃 FG</div><div class="val" style="font-size:14.5px;">${pl.fgm || 0}/${pl.fga || 0} (${fgPct})</div></div>
      <div class="live-stat-box"><div class="lbl">三分 3PT</div><div class="val" style="font-size:14.5px;">${pl.tpm || 0}/${pl.tpa || 0} (${tpPct})</div></div>
      <div class="live-stat-box"><div class="lbl">罰球 FT</div><div class="val" style="font-size:14.5px;">${pl.ftm || 0}/${pl.fta || 0} (${ftPct})</div></div>
      <div class="live-stat-box"><div class="lbl">失誤 / 犯規</div><div class="val">${pl.tov || 0} / ${pl.pf || 0}</div></div>
      <div class="live-stat-box"><div class="lbl">上場 / +/-</div><div class="val" style="font-size:14.5px;">${minStr} · ${(pl.plusMinus || 0) > 0 ? "+" + pl.plusMinus : (pl.plusMinus || 0)}</div></div>
    `;
    const focusBox = document.getElementById("ldsFocusBox");
    if (focusBox) focusBox.style.display = "none";
    const fullBtn = document.getElementById("btnLiveOpenFullBox");
    if (fullBtn) fullBtn.style.display = "none";
    const closeBtn = document.getElementById("btnCloseLiveDetailStats");
    if (closeBtn) closeBtn.textContent = "關閉單場詳盡數據";
    modal.classList.remove("hidden");
  }

  function openPastMatchBoxScore(roundIdx) {
    const season = getSeason();
    const match = getMatch();
    if (!season || !Array.isArray(season.schedule) || !match) return;
    const g = season.schedule[roundIdx];
    if (!g || !g.played) return;

    closeSectionModal();
    const userTeam = (season.standings || []).find(t => t.isUserTeam) || { name: "我方" };
    const bs = g.boxScore;
    if (!bs) {
      if (typeof showToast === "function") {
        showToast(`R${g.round} ${userTeam.name} ${g.userScore}-${g.oppScore} ${g.oppName}${g.mvp ? ` ｜ 🏆MVP：${g.mvp.name} (${g.mvp.line})` : ""}`);
      }
      return;
    }

    match._historyView = bs;
    if (typeof activePauseTab !== "undefined") activePauseTab = "HOME";
    const won = bs.homeScore > bs.awayScore;
    const stageLbl = g.stageLabel || `第 ${g.round} 輪`;
    document.getElementById("bsHeaderSub").textContent = `📜 歷史賽果回顧 · ${stageLbl}（${won ? "勝" : "負"}）`;
    document.getElementById("bsHeaderScore").textContent = `${bs.homeName} ${bs.homeScore} - ${bs.awayScore} ${bs.awayName}`;

    const stamp = document.getElementById("bsRankStamp");
    if (stamp) stamp.style.display = "none";

    const mvpEl = document.getElementById("bsMvpBanner");
    if (mvpEl) {
      if (bs.mvp) {
        mvpEl.style.display = "flex";
        mvpEl.innerHTML = `
          <div>
            <div style="font-size:11px; font-weight:900; color:#92400E;">🏆 本場最有價值球員 (MATCH MVP)</div>
            <div style="font-size:15.5px; font-weight:900;">${playerNameLinkHtml(bs.mvp.name, bs.mvp.team)}（${bs.mvp.team}）${bs.mvp.isUser ? " ⭐" : ""}</div>
          </div>
          <div style="font-size:12px; font-weight:900; text-align:right;">${bs.mvp.line || ""}</div>`;
      } else {
        mvpEl.style.display = "none";
      }
    }

    const qhArr = bs.qScoresHome || [bs.homeScore];
    const qaArr = bs.qScoresAway || [bs.awayScore];
    let qh = "<th>球隊</th>";
    for (let i = 0; i < qhArr.length; i++) qh += `<th>${i < 4 ? "Q" + (i + 1) : "OT" + (i - 3)}</th>`;
    qh += "<th>總分</th>";
    document.getElementById("bsQuarterHead").innerHTML = qh;
    document.getElementById("bsQuarterBody").innerHTML =
      `<tr><td class="left">${bs.homeName}</td>${qhArr.map(v => `<td>${v}</td>`).join("")}<td><strong>${bs.homeScore}</strong></td></tr>` +
      `<tr><td class="left">${bs.awayName}</td>${qaArr.map(v => `<td>${v}</td>`).join("")}<td><strong>${bs.awayScore}</strong></td></tr>`;

    document.getElementById("btnBsHomeTab").textContent = `${bs.homeName} (${(bs.homeTeam || []).length}人)`;
    document.getElementById("btnBsAwayTab").textContent = `${bs.awayName} (${(bs.awayTeam || []).length}人)`;
    toggleBoxScoreFullMode(false);
    if (typeof renderPauseTab === "function") renderPauseTab();

    const footer = document.getElementById("bsFooterBtns");
    if (footer) {
      footer.innerHTML = `<button type="button" class="manga-btn primary" id="btnClosePastBoxScore" style="width:100%;">關閉賽果回顧</button>`;
      document.getElementById("btnClosePastBoxScore").addEventListener("click", () => {
        match._historyView = null;
        document.getElementById("boxScoreModal").classList.add("hidden");
      });
    }
    document.getElementById("boxScoreModal").classList.remove("hidden");
  }

  /* -------------------- COMPACT LIVE MATCH DETAILED STATS MODAL -------------------- */
  function openLiveDetailStats() {
    const match = getMatch();
    const modal = document.getElementById("liveDetailStatsModal");
    if (!match || !modal || match.phase === "IDLE") return;

    if (match.phase !== "PAUSED_MENU" && match.phase !== "ENDED") {
      phaseBeforeLiveDetail = match.phase;
      match.phase = "PAUSED_MENU";
    } else {
      phaseBeforeLiveDetail = null;
    }

    const u = match.userPlayer || { num: 10, name: "主角", pts: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, plusMinus: 0, secPlayed: 0, stamina: 100 };
    const qLbl = match.quarter <= 4 ? `Q${match.quarter}` : `OT${match.quarter - 4}`;
    document.getElementById("ldsSub").textContent = `${qLbl} · ${match.homeName} ${match.homeScore} - ${match.awayScore} ${match.awayName}`;
    document.getElementById("ldsPlayerName").innerHTML = `${playerNameLinkHtml(u.name, match.homeName, `#${u.num} ${u.name}`)} <span class="tag gold">${u.onFloor ? "場上作戰" : "場下休息"}</span>`;

    const fgPct = u.fga ? `${Math.round((u.fgm / u.fga) * 100)}%` : "—";
    const tpPct = u.tpa ? `${Math.round((u.tpm / u.tpa) * 100)}%` : "—";
    document.getElementById("ldsStatGrid").innerHTML = `
      <div class="live-stat-box"><div class="lbl">得分 PTS</div><div class="val">${u.pts}</div></div>
      <div class="live-stat-box"><div class="lbl">籃板 REB</div><div class="val">${(u.oreb || 0) + (u.dreb || 0)}</div></div>
      <div class="live-stat-box"><div class="lbl">助攻 AST</div><div class="val">${u.ast}</div></div>
      <div class="live-stat-box"><div class="lbl">抄截 / 封阻</div><div class="val">${u.stl} / ${u.blk}</div></div>
      <div class="live-stat-box"><div class="lbl">投籃 FG</div><div class="val" style="font-size:15px;">${u.fgm}/${u.fga} (${fgPct})</div></div>
      <div class="live-stat-box"><div class="lbl">三分 3PT</div><div class="val" style="font-size:15px;">${u.tpm}/${u.tpa} (${tpPct})</div></div>
      <div class="live-stat-box"><div class="lbl">失誤 / 犯規</div><div class="val">${u.tov} / ${u.pf}</div></div>
      <div class="live-stat-box"><div class="lbl">正負值 +/-</div><div class="val">${u.plusMinus > 0 ? "+" + u.plusMinus : u.plusMinus}</div></div>
      <div class="live-stat-box"><div class="lbl">體力剩餘</div><div class="val">${Math.round(u.stamina || 0)}%</div></div>
    `;

    const focusBox = document.getElementById("ldsFocusBox");
    const f = getActiveCoachFocus();
    if (focusBox) {
      if (f) {
        const opt = COACH_FOCUS_OPTIONS.find(x => x.id === f.id);
        const season = getSeason();
        const goal = opt ? opt.buildGoal((season && season.rotationKey) || "ROOKIE") : null;
        const met = goal ? goal.check(u) : false;
        const prog = goal ? goal.progressText(u) : "";
        focusBox.style.display = "block";
        focusBox.innerHTML = `
          <div style="font-weight:900; font-size:12px; color:${f.defied ? "#C81E1E" : "#111"};">
            ${f.icon} 本場專注：${f.title} ${f.defied ? `<span class="tag loss">⚠️ 違背教練指示</span>` : `<span class="tag win">🎯 執行教練指令</span>`}
          </div>
          <div style="font-size:12px; margin-top:4px; font-weight:800; color:${met ? "#15803D" : "var(--ink-soft)"};">
            進度：${prog}（目標：${f.label}）${met ? " ✅ 已達標！" : ""}
          </div>`;
      } else {
        focusBox.style.display = "none";
      }
    }

    const fullBtn = document.getElementById("btnLiveOpenFullBox");
    if (fullBtn) fullBtn.style.display = "inline-flex";
    const closeBtn = document.getElementById("btnCloseLiveDetailStats");
    if (closeBtn) closeBtn.textContent = "▶ 繼續比賽";
    modal.classList.remove("hidden");
  }

  function sanitizeResumePhase(candidatePhase) {
    const match = getMatch();
    if (!match) return "PLAYING";
    let next = candidatePhase || "PLAYING";
    if (next === "PAUSED_MENU" || next === "IDLE" || next === "ENDED") next = "PLAYING";
    if (next === "BULLET" && !match.activeScenario) next = "PLAYING";
    if (next === "QTE" && !match.qte) next = "PLAYING";
    if (next === "CUTIN" && !match.activeCutIn) next = "PLAYING";
    if (next === "RESULT_SPLASH" && !match.resultSplash) next = "PLAYING";
    if (typeof setDockMode === "function") {
      if (next === "BULLET") setDockMode("BULLET");
      else if (next === "QTE") setDockMode("QTE");
      else setDockMode("NONE");
    }
    return next;
  }

  function closeLiveDetailStats() {
    const match = getMatch();
    const modal = document.getElementById("liveDetailStatsModal");
    if (modal) modal.classList.add("hidden");
    const bsModal = document.getElementById("boxScoreModal");
    const bsStillOpen = bsModal && !bsModal.classList.contains("hidden");
    if (match && !bsStillOpen && match.phase === "PAUSED_MENU") {
      match.phase = sanitizeResumePhase(phaseBeforeLiveDetail);
    }
    phaseBeforeLiveDetail = null;
  }

  /* -------------------- LEAGUE BENCHMARK COMPUTATION -------------------- */
  function computeLeagueBenchmarks() {
    const season = getSeason();
    const db = getDB();
    if (!season || !db || !db.leagues) return null;
    const league = db.leagues.leagues.find(l => l.id === season.leagueId) || db.leagues.leagues[0];
    const pObj = season.player;
    const userOvr = pObj ? calcOVR(pObj.stats, pObj.pos, season.equippedTraits) : 72;
    const userTeamOvr = calcTeamStrength(season.userRoster || []);

    const teamOvrs = (season.standings || []).map(t => ({
      id: t.id, name: t.name, isUserTeam: Boolean(t.isUserTeam),
      ovr: t.isUserTeam ? userTeamOvr : (t.ovr || 78)
    })).sort((a, b) => b.ovr - a.ovr);
    const teamCount = Math.max(1, teamOvrs.length);
    const teamAvgOvr = Math.round(teamOvrs.reduce((s, t) => s + t.ovr, 0) / teamCount);
    const teamOvrRank = Math.max(1, teamOvrs.findIndex(t => t.isUserTeam) + 1);

    const sortedSt = [...(season.standings || [])].sort((a, b) => (b.w - a.w) || ((b.pf - b.pa) - (a.pf - a.pa)));
    const standingRank = Math.max(1, sortedSt.findIndex(t => t.isUserTeam) + 1);

    const allPlayers = [];
    for (const pl of (season.userRoster || [])) {
      const prof = (!pl.isUser && (!pl.stats || !pl.heightCm) && typeof generateNpcProfile === "function")
        ? generateNpcProfile({ ...pl }) : pl;
      allPlayers.push({
        name: prof.name,
        ovr: pl.isUser ? userOvr : (prof.ovr || 72),
        pos: prof.pos || "SG",
        heightCm: pl.isUser && pObj ? (pObj.heightCm || 185) : (prof.heightCm || 185),
        isUser: Boolean(pl.isUser),
        stats: pl.isUser && pObj ? pObj.stats : (prof.stats || null)
      });
    }
    for (const tm of (league.teams || [])) {
      const isUT = season.standings && season.standings.some(s => s.isUserTeam && s.id === tm.id);
      if (isUT) continue;
      const r = (typeof window.getLiveTeamRoster === "function")
        ? window.getLiveTeamRoster(tm.id, season.leagueId)
        : (Array.isArray(tm.roster) && tm.roster.length ? tm.roster : (typeof buildOpponentRoster === "function" ? buildOpponentRoster(tm) : []));
      for (const pl of r) {
        const prof = (!pl.stats || !pl.heightCm) && typeof generateNpcProfile === "function"
          ? generateNpcProfile({ ...pl }) : pl;
        allPlayers.push({
          name: prof.name,
          ovr: prof.ovr || tm.ovr || 74,
          pos: prof.pos || "SG",
          heightCm: prof.heightCm || 185,
          isUser: false,
          stats: prof.stats || null
        });
      }
    }

    const totalPlayers = Math.max(1, allPlayers.length);
    const playerAvgOvr = Math.round(allPlayers.reduce((s, x) => s + x.ovr, 0) / totalPlayers);
    const sortedAll = [...allPlayers].sort((a, b) => b.ovr - a.ovr);
    const getOverallRank = (val) => 1 + sortedAll.filter(x => x.ovr > val).length;
    const getPosRank = (val, posCode) => {
      const pool = allPlayers.filter(x => x.pos === posCode);
      return { rank: 1 + pool.filter(x => x.ovr > val).length, total: Math.max(1, pool.length) };
    };
    const playerOvrRank = getOverallRank(userOvr);

    const userPos = (pObj && pObj.pos) || "SG";
    const samePos = allPlayers.filter(x => x.pos === userPos).sort((a, b) => b.ovr - a.ovr);
    const userPosRankObj = getPosRank(userOvr, userPos);
    const posRank = userPosRankObj.rank;
    const posTotal = userPosRankObj.total;
    const posHeights = samePos.map(x => x.heightCm).filter(h => typeof h === "number" && h > 140);
    const posAvgHeight = posHeights.length
      ? Math.round(posHeights.reduce((a, b) => a + b, 0) / posHeights.length)
      : (getPosHeightBase()[userPos] || 186);

    const statAvgs = {};
    const posTpl = (db.origins && db.origins.posTemplates && db.origins.posTemplates[userPos]) || {};
    const leagueShift = Math.round((playerAvgOvr - 72) * 0.72);
    for (const d of (db.origins ? db.origins.statDefs : [])) {
      const k = d.k;
      const samples = samePos.filter(x => x.stats && typeof x.stats[k] === "number").map(x => x.stats[k]);
      statAvgs[k] = samples.length >= 4
        ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
        : Math.max(50, Math.min(92, (posTpl[k] || 66) + leagueShift));
    }

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
      userOvr, playerAvgOvr, playerOvrDiff: userOvr - playerAvgOvr, playerOvrRank, totalPlayers,
      allPlayersSorted: sortedAll, getOverallRank, getPosRank, userPos, posRank, posTotal, posAvgHeight,
      userTeamOvr, teamAvgOvr, teamOvrDiff: userTeamOvr - teamAvgOvr, teamOvrRank, teamCount, standingRank,
      statAvgs, avgBase
    };
  }

  /* -------------------- CLICKABLE PLAYER DETAIL CARD MODAL -------------------- */
  function findPlayerRecord(name, teamHint = "") {
    const season = getSeason();
    const db = getDB();
    const match = getMatch();
    if (!name) return null;
    const target = name.trim();

    if (match && match.phase !== "IDLE") {
      for (const pl of [...(match.homeTeam || []), ...(match.awayTeam || [])]) {
        if (pl && pl.name === target) return { player: pl, teamName: pl.team === "HOME" ? match.homeName : match.awayName };
      }
    }
    if (season && Array.isArray(season.userRoster)) {
      const ut = (season.standings || []).find(t => t.isUserTeam);
      for (const pl of season.userRoster) {
        if (pl && pl.name === target) {
          const merged = pl.isUser && season.player
            ? { ...pl, stats: season.player.stats, heightCm: season.player.heightCm, skills: season.equippedTraits, ovr: calcOVR(season.player.stats, season.player.pos, season.equippedTraits), age: season.player.age }
            : pl;
          return { player: merged, teamName: ut ? ut.name : "本隊" };
        }
      }
    }
    if (season && db && db.leagues) {
      const league = db.leagues.leagues.find(l => l.id === season.leagueId) || db.leagues.leagues[0];
      const orderedTeams = [...(league.teams || [])].sort((a, b) => (a.name === teamHint ? -1 : (b.name === teamHint ? 1 : 0)));
      for (const tm of orderedTeams) {
        const list = (typeof window.getLiveTeamRoster === "function")
          ? window.getLiveTeamRoster(tm.id, season.leagueId)
          : ((Array.isArray(tm.roster) && tm.roster.length) ? tm.roster : (typeof buildOpponentRoster === "function" ? buildOpponentRoster(tm) : []));
        const found = list.find(pl => pl && pl.name === target);
        if (found) {
          const profiled = (found.stats && found.heightCm) ? found : (typeof generateNpcProfile === "function" ? generateNpcProfile({ ...found }) : found);
          return { player: profiled, teamName: tm.name };
        }
        if (tm.ace === target) {
          const aceObj = list.find(pl => pl.isRival) || list[0];
          if (aceObj) {
            const profiled = (aceObj.stats && aceObj.heightCm) ? aceObj : (typeof generateNpcProfile === "function" ? generateNpcProfile({ ...aceObj, name: target }) : aceObj);
            return { player: { ...profiled, name: target }, teamName: tm.name };
          }
        }
      }
    }
    return null;
  }

  function openPlayerCardByName(name, teamHint = "") {
    const rec = findPlayerRecord(name, teamHint);
    if (!rec) {
      if (typeof showToast === "function") showToast(`暫無 ${name} 的詳細球探檔案`);
      return;
    }
    openPlayerCard(rec.player, rec.teamName);
  }

  function openPlayerCard(pl, teamName = "") {
    const modal = document.getElementById("playerDetailModal");
    const db = getDB();
    if (!modal || !pl || !db) return;

    const bm = computeLeagueBenchmarks();
    const ovr = pl.ovr || 74;
    const avgOvr = bm ? bm.playerAvgOvr : 74;
    const diff = ovr - avgOvr;
    let rankStr = "";
    if (bm && typeof bm.getOverallRank === "function") {
      const rAll = bm.getOverallRank(ovr);
      const rPos = bm.getPosRank(ovr, pl.pos || "SG");
      rankStr = `聯盟 #${rAll}/${bm.totalPlayers} · ${pl.pos || "SG"} #${rPos.rank}/${rPos.total}`;
    }

    const roleTxt = pl.isUser ? "★ 主角球員" : (pl.role === "STARTER" ? "先發主力" : "替補輪換");
    const gtMap = { EARLY: "早熟型", NORMAL: "標準型", LATE: "晚熟型" };
    const potStr = (!pl.isUser && pl.potential) ? ` · 潛力${"★".repeat(pl.potential)}` : "";
    const gtStr = (!pl.isUser && pl.growthType) ? `(${gtMap[pl.growthType] || "標準型"})` : "";
    const sDelta = (!pl.isUser && typeof pl.seasonOvrStart === "number") ? (ovr - pl.seasonOvrStart) : 0;
    const sDeltaStr = sDelta > 0 ? ` · 本季▲+${sDelta}` : (sDelta < 0 ? ` · 本季▼${sDelta}` : "");
    document.getElementById("pdHeroName").textContent = `#${pl.num !== undefined ? pl.num : "--"} ${pl.name}`;
    const displayAge = (pl.isUser && getSeason() && getSeason().player) ? getSeason().player.age : pl.age;
    document.getElementById("pdHeroSub").textContent = `${teamName || "所屬球隊"} · ${pl.pos || "SG"} · ${roleTxt} · ${pl.heightCm || 185}cm${displayAge ? ` · ${displayAge}歲` : ""}${potStr}${gtStr}${sDeltaStr}`;
    document.getElementById("pdOvrVal").textContent = ovr;
    document.getElementById("pdOvrCmp").textContent = `均${avgOvr} (${diff >= 0 ? "+" : ""}${diff})${rankStr ? ` · ${rankStr}` : ""}`;

    const stats = pl.stats || {};
    const statDefs = (db.origins && db.origins.statDefs) || [];
    document.getElementById("pdStatsGrid").innerHTML = statDefs.map(d => {
      const v = stats[d.k] || 70;
      const pct = Math.max(8, Math.min(100, v));
      const barCls = v >= 85 ? "high" : (v >= 75 ? "good" : "");
      return `
        <div class="pdetail-stat-row">
          <div class="pdetail-stat-top"><span>${d.l}</span><span style="color:${v >= 85 ? "#C81E1E" : "#111"};">${v}</span></div>
          <div class="pdetail-bar-track"><div class="pdetail-bar-fill ${barCls}" style="width:${pct}%;"></div></div>
        </div>`;
    }).join("");

    const skills = Array.isArray(pl.skills) ? pl.skills : [];
    document.getElementById("pdSkillsBox").innerHTML = skills.length
      ? skills.map(id => renderSkillChip(id, "font-size:11px; padding:3px 7px;")).join("")
      : `<span class="s-badge">基礎球風（無特殊徽章）</span>`;

    modal.classList.remove("hidden");
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
    const season = getSeason();
    const db = getDB();
    const btn = document.getElementById("btnTopBigCta");
    const titleEl = document.getElementById("topCtaTitle");
    const subEl = document.getElementById("topCtaSub");
    if (!btn || !titleEl || !subEl || !season || !db) return;

    const league = db.leagues.leagues.find(l => l.id === season.leagueId) || db.leagues.leagues[0];
    const userTeam = season.standings.find(t => t.isUserTeam) || { name: "我方", w: 0, l: 0 };
    const seasonDone = season.currentRoundIdx >= season.schedule.length;
    const apLeft = (season.player && typeof season.player.ap === "number") ? season.player.ap : 0;

    btn.classList.remove("gold-mode");
    if (season.retired) {
      btn.classList.add("gold-mode");
      titleEl.textContent = "✨ 開啟全新球員生涯";
      subEl.textContent = `傳奇已謝幕（共 ${season.careerYear} 季）· 點擊重新創角`;
      btn.dataset.ctaMode = "NEW_CAREER";
    } else if (seasonDone) {
      btn.classList.add("gold-mode");
      titleEl.textContent = "🏆 壓縮賽季進入下一年";
      subEl.textContent = `${league.name} 戰績 ${userTeam.w}勝${userTeam.l}負 · 進入休賽季抉擇`;
      btn.dataset.ctaMode = "NEXT_SEASON";
    } else {
      const nextG = season.schedule[season.currentRoundIdx];
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

  /* -------------------- 4. COMPACT 12-MAN ROSTER CARDS (DEFAULT 5 STARTERS) -------------------- */
  function renderRosterCards(bm) {
    const season = getSeason();
    const wrap = document.getElementById("hubTeamRosterCards");
    const toggleBtn = document.getElementById("btnToggleBenchRoster");
    if (!wrap || !season) return;

    const rotWin = getEffectiveRotationWindow();
    const ut = (season.standings || []).find(t => t.isUserTeam);
    const teamName = ut ? ut.name : "本隊";
    const rosterSorted = [...(season.userRoster || [])].sort((a, b) =>
      (a.role === "STARTER" ? 0 : 1) - (b.role === "STARTER" ? 0 : 1) || b.ovr - a.ovr
    );

    const starters = rosterSorted.slice(0, 5);
    const bench = rosterSorted.slice(5);
    const listToShow = rosterExpanded ? rosterSorted : starters;
    const avgOvr = bm ? bm.playerAvgOvr : 74;

    wrap.innerHTML = listToShow.map((pl, idx) => {
      const isStarter = idx < 5;
      const roleTxt = pl.isUser ? `${rotWin.label}` : (isStarter ? "先發" : "替補");
      const diff = (pl.ovr || 72) - avgOvr;
      const diffStr = diff > 0 ? `均+${diff}` : (diff < 0 ? `均${diff}` : "持平");
      const sDelta = (!pl.isUser && typeof pl.seasonOvrStart === "number") ? ((pl.ovr || 72) - pl.seasonOvrStart) : 0;
      const growthTag = sDelta > 0
        ? `<span class="tag win" style="font-size:10px; padding:1px 5px;">▲+${sDelta}</span>`
        : (sDelta < 0 ? `<span class="tag loss" style="font-size:10px; padding:1px 5px;">▼${sDelta}</span>` : "");
      const potBadge = (!pl.isUser && pl.potential) ? `<span style="font-size:10px; color:#92400E; font-weight:800;">潛${"★".repeat(pl.potential)}</span>` : "";

      return `
        <article class="roster-player-card ${pl.isUser ? "is-user" : (!isStarter ? "is-bench" : "")}" data-player-card-name="${escAttr(pl.name)}" data-player-card-team="${escAttr(teamName)}">
          <div class="rpc-left">
            <div class="rpc-name">${playerNameLinkHtml(pl.name, teamName, `#${pl.num} ${pl.name}${pl.isUser ? " ★" : ""}`)} ${growthTag}</div>
            <div class="rpc-meta">
              <span class="tag">${pl.pos}</span>
              <span class="tag ${isStarter ? "gold" : ""}">${roleTxt}</span>
              <span>${pl.heightCm || 185}cm${(pl.isUser && season.player ? season.player.age : pl.age) ? ` · ${pl.isUser && season.player ? season.player.age : pl.age}歲` : ""}</span>
              ${potBadge}
            </div>
          </div>
          <div class="rpc-right">
            <div class="rpc-ovr-box">
              <div class="rpc-ovr-num">${pl.ovr}</div>
              <div class="rpc-ovr-cmp">${diffStr}</div>
            </div>
            <span class="rpc-chev">›</span>
          </div>
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

  /* -------------------- 5. ONE-PAGE HUB DISPLAYS & BENCHMARKS -------------------- */
  function enhanceHubDisplays() {
    const season = getSeason();
    const db = getDB();
    if (!season || !season.player || !db) return;
    const bm = computeLeagueBenchmarks();
    if (!bm) return;
    const p = season.player;
    const rotWin = getEffectiveRotationWindow();
    const st = season.seasonTotals || { gp: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, mvps: 0 };
    const gp = Math.max(1, st.gp);
    const ops = ensureTeamOps();

    updateTopStickyCTA();

    // --- 【比賽】Tab: Scouting bar + 4-game mini schedule preview + button labels ---
    const scoutBox = document.getElementById("nmScoutCompareBox");
    if (scoutBox) {
      const seasonDone = season.currentRoundIdx >= season.schedule.length;
      if (!season.retired && !seasonDone) {
        const nextG = season.schedule[season.currentRoundIdx];
        const oppStanding = (season.standings || []).find(t => t.id === nextG.oppId);
        const oppOvr = oppStanding ? (oppStanding.ovr || 78) : 78;
        const pct = Math.max(25, Math.min(75, Math.round(50 + (bm.userTeamOvr - oppOvr) * 2.5)));
        scoutBox.style.display = "block";
        scoutBox.innerHTML = `
          <div class="match-ovr-compare">
            <span>我方 OVR ${bm.userTeamOvr}</span>
            <div class="match-ovr-bar"><div class="match-ovr-fill-home" style="width:${pct}%;"></div></div>
            <span>對手 OVR ${oppOvr}</span>
          </div>
          <div style="font-size:11.5px; color:#FDE68A; font-weight:800; margin-top:5px;">
            對手王牌：${playerNameLinkHtml(nextG.oppAce, nextG.oppName)}（點名字看能力）
          </div>`;
      } else {
        scoutBox.style.display = "none";
      }
    }

    // Mini schedule preview (last 1 + current + next 2 = max 4 games)
    const miniSched = document.getElementById("miniSchedulePreview");
    if (miniSched && Array.isArray(season.schedule)) {
      const startIdx = Math.max(0, season.currentRoundIdx - 1);
      const slice = season.schedule.slice(startIdx, startIdx + 4);
      miniSched.innerHTML = slice.map((g, offset) => {
        const i = startIdx + offset;
        const cls = g.played ? "done clickable-match" : (i === season.currentRoundIdx ? "current" : "");
        const attr = g.played ? `data-past-match-idx="${i}"` : "";
        const right = g.played
          ? `<span style="display:inline-flex; align-items:center;"><span class="tag ${g.userScore > g.oppScore ? "win" : "loss"}">${g.userScore > g.oppScore ? "勝" : "負"} ${g.userScore}:${g.oppScore}</span><span class="sched-replay-pill">📊 數據</span></span>`
          : (i === season.currentRoundIdx ? `<span class="tag gold">下一場</span>` : `<span class="tag">未賽</span>`);
        return `<div class="sched-item ${cls}" ${attr}>
          <span>${g.stage === 'PLAYOFF_FINALS' ? '🏆總決賽' : (g.stage === 'PLAYOFF_SF' ? '🔥準決賽' : 'R' + g.round)} · ${g.isHome ? "主" : "客"} vs ${g.oppName} (${playerNameLinkHtml(g.oppAce, g.oppName)})</span>
          ${right}
        </div>`;
      }).join("");
    }

    // Full schedule & standings (inside drawer shelf) with clickable names
    const schedEl = document.getElementById("scheduleListBox");
    if (schedEl && Array.isArray(season.schedule)) {
      schedEl.innerHTML = season.schedule.map((g, i) => {
        const cls = g.played ? "done clickable-match" : (i === season.currentRoundIdx ? "current" : "");
        const attr = g.played ? `data-past-match-idx="${i}"` : "";
        const right = g.played
          ? `<span style="display:inline-flex; align-items:center;"><span class="tag ${g.userScore > g.oppScore ? "win" : "loss"}">${g.userScore > g.oppScore ? "勝" : "負"} ${g.userScore}:${g.oppScore}</span><span class="sched-replay-pill">📊 看數據</span></span>`
          : (i === season.currentRoundIdx ? `<span class="tag gold">下一場</span>` : `<span class="tag">未賽</span>`);
        const mvpTag = g.played && g.mvp ? ` <span style="font-size:10.5px; color:#92400E; font-weight:800;">🏆MVP: ${playerNameLinkHtml(g.mvp.name, g.mvp.team)}</span>` : "";
        return `<div class="sched-item ${cls}" ${attr}>
          <span>${g.stage === 'PLAYOFF_FINALS' ? '🏆總決賽' : (g.stage === 'PLAYOFF_SF' ? '🔥準決賽' : 'R' + g.round)} · ${g.isHome ? "主場" : "客場"} vs ${g.oppName} (${playerNameLinkHtml(g.oppAce, g.oppName)})${mvpTag}</span>
          ${right}
        </div>`;
      }).join("");
    }

    const stBody = document.getElementById("standingsBody");
    if (stBody && Array.isArray(season.standings)) {
      const sorted = [...season.standings].sort((a, b) => (b.w - a.w) || ((b.pf - b.pa) - (a.pf - a.pa)));
      const leadW = sorted[0].w, leadL = sorted[0].l;
      stBody.innerHTML = sorted.map((t, idx) => {
        const gpT = t.w + t.l;
        const pct = gpT ? (t.w / gpT).toFixed(3) : ".000";
        const gb = ((leadW - t.w) + (t.l - leadL)) / 2;
        const avg = gpT ? `${(t.pf / gpT).toFixed(1)} / ${(t.pa / gpT).toFixed(1)}` : "0 / 0";
        return `<tr class="${t.isUserTeam ? "hl-row" : ""}">
          <td>${idx + 1}</td><td class="left">${t.name}${t.isUserTeam ? " ★" : ""}</td>
          <td>${t.w}</td><td>${t.l}</td><td>${pct}</td><td>${gb === 0 ? "—" : gb.toFixed(1)}</td>
          <td>${avg}</td><td>${playerNameLinkHtml(t.ace, t.name)}</td>
        </tr>`;
      }).join("");
    }

    const standBtnSub = document.getElementById("btnOpenStandingsSub");
    if (standBtnSub) standBtnSub.textContent = `目前第 #${bm.standingRank} / ${bm.teamCount} 名`;

    // --- 【我】Tab: One-Page KPI + Compact Avg + Train CTA Button + 3 Drawer Buttons ---
    const strip = document.getElementById("meOvrCompareStrip");
    if (strip) {
      const ovrDiffTxt = bm.playerOvrDiff >= 0 ? `+${bm.playerOvrDiff}` : `${bm.playerOvrDiff}`;
      const ovrColor = bm.playerOvrDiff >= 0 ? "var(--ok-green)" : "var(--crimson)";
      const trust = p.coachTrust || 35;
      strip.innerHTML = `
        <div class="ovr-kpi-card highlight">
          <div class="ovr-kpi-lbl">個人 OVR</div>
          <div class="ovr-kpi-val">${bm.userOvr}</div>
          <div class="ovr-kpi-cmp" style="color:${ovrColor};">均${bm.playerAvgOvr} (${ovrDiffTxt}) · #${bm.playerOvrRank}</div>
        </div>
        <div class="ovr-kpi-card">
          <div class="ovr-kpi-lbl">地位 / 教練信任</div>
          <div class="ovr-kpi-val" style="font-size:15.5px;">${rotWin.label}</div>
          <div class="ovr-kpi-cmp">信任 ${trust}/100 · ${bm.userPos} #${bm.posRank}</div>
        </div>
        <div class="ovr-kpi-card">
          <div class="ovr-kpi-lbl">賽季狀態</div>
          ${(() => {
            const cp = typeof window.getConditionProfile === "function"
              ? window.getConditionProfile(p.condition, typeof window.getInjuryLevel === "function" ? window.getInjuryLevel(p) : p.injured)
              : { label: p.injured ? "輕微拉傷" : "狀態良好", color: p.condition < 55 ? "var(--crimson)" : "var(--ok-green)", shortEffect: "" };
            return `<div class="ovr-kpi-val" style="color:${cp.color};">${p.condition}%</div>
          <div class="ovr-kpi-cmp" style="color:${cp.color};">${cp.label}</div>`;
          })()}
        </div>`;
    }

    const avgStrip = document.getElementById("meCompactAvgStrip");
    if (avgStrip) {
      const ppg = st.gp ? Number((st.pts / gp).toFixed(1)) : 0;
      const rpg = st.gp ? Number((st.reb / gp).toFixed(1)) : 0;
      const apg = st.gp ? Number((st.ast / gp).toFixed(1)) : 0;
      const fmtCmp = (val, base) => {
        if (!st.gp) return `<span style="color:var(--ink-soft);">聯盟均 ${base}</span>`;
        const d = Number((val - base).toFixed(1));
        return `<span style="color:${d >= 0 ? "#15803D" : "#C81E1E"};">${d >= 0 ? "+" : ""}${d} vs 均${base}</span>`;
      };
      avgStrip.innerHTML = `
        <div class="me-avg-cell"><div class="me-avg-lbl">場均得分 PPG</div><div class="me-avg-val">${ppg.toFixed(1)}</div><div class="me-avg-cmp">${fmtCmp(ppg, bm.avgBase.ppg)}</div></div>
        <div class="me-avg-cell"><div class="me-avg-lbl">場均籃板 RPG</div><div class="me-avg-val">${rpg.toFixed(1)}</div><div class="me-avg-cmp">${fmtCmp(rpg, bm.avgBase.rpg)}</div></div>
        <div class="me-avg-cell"><div class="me-avg-lbl">場均助攻 APG</div><div class="me-avg-val">${apg.toFixed(1)}</div><div class="me-avg-cmp">${fmtCmp(apg, bm.avgBase.apg)}</div></div>
      `;
    }

    const codexSub = document.getElementById("btnOpenSkillCodexSub");
    if (codexSub && typeof window.getActiveSynergies === "function") {
      const ownedCnt = (season.equippedTraits || []).length;
      const synCnt = window.getActiveSynergies(season.equippedTraits || []).length;
      codexSub.textContent = `已擁有 ${ownedCnt} 項技能 · 啟動 ${synCnt} 組 A＋B 隱藏聯動`;
    }
    const trainBtnTitle = document.getElementById("btnOpenTrainTitle");
    const trainBtnSub = document.getElementById("btnOpenTrainSub");
    if (trainBtnTitle) trainBtnTitle.textContent = `🏋️ 場外養成（剩餘 ${p.ap} AP）`;
    if (trainBtnSub) {
      trainBtnSub.textContent = p.ap > 0
        ? (p.injured ? "⚠️ 輕微拉傷中，點擊理療或特訓" : "點開選擇特訓、恢復與極限 QTE")
        : "本週 AP 已用完，下場賽後補滿";
    }

    // Update detailed player summary inside drawer shelf too
    const summaryEl = document.getElementById("hubPlayerSummary");
    if (summaryEl) {
      const eqSet = new Set(season.equippedTraits);
      const noise = getJudgmentNoiseBand(season.careerYear, eqSet, 100);
      summaryEl.innerHTML = `
        <div style="font-size:12px; display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
          <span class="cmp-badge">出賽 ${st.gp} 場</span>
          <span class="cmp-badge gold">單場 MVP ×${st.mvps || 0}</span>
          <span class="cmp-badge">判讀誤差 ±${noise}%</span>
          <span class="cmp-badge">年齡 ${p.age} 歲 · 上限 ${p.cap}</span>
        </div>`;
    }

    const rtBox = document.getElementById("hubRoleTrustBox");
    if (rtBox) {
      const trust = p.coachTrust || 35;
      const nextGate = trust < 40 ? { lbl: "輪換門檻", v: 40 } : (trust < 60 ? { lbl: "先發門檻", v: 60 } : (trust < 80 ? { lbl: "王牌門檻", v: 80 } : { lbl: "絕對核心", v: 100 }));
      const gap = Math.max(0, nextGate.v - trust);
      rtBox.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px; font-weight:900;">
          <span>🏅 地位：<strong style="color:var(--crimson);">${rotWin.label}</strong></span>
          <span>教練信任：<strong>${trust}/100</strong> <span class="cmp-badge ${gap === 0 ? "pos" : "gold"}">${gap > 0 ? `距${nextGate.lbl}差 ${gap}` : `已達${nextGate.lbl}`}</span></span>
        </div>
        <div style="margin-top:4px; color:var(--ink-soft);">預估上場：<strong>${Math.round(rotWin.minPct * 100)}%–${Math.round(rotWin.maxPct * 100)}%</strong></div>
      `;
    }

    // --- 【球隊】Tab: 3-KPI + Tactics Drawer Button + Compact Starters 5 ---
    const rTag = document.getElementById("hubTeamStrengthTag");
    if (rTag) {
      const diffTxt = bm.teamOvrDiff >= 0 ? `+${bm.teamOvrDiff}` : `${bm.teamOvrDiff}`;
      rTag.textContent = `戰力 OVR ${bm.userTeamOvr}（均 ${bm.teamAvgOvr} ${diffTxt} · #${bm.teamOvrRank}/${bm.teamCount}）`;
    }
    const teamKpiStrip = document.getElementById("teamBenchmarkStrip");
    if (teamKpiStrip) {
      const chemDiff = (ops.chemistry || 65) - 65;
      teamKpiStrip.innerHTML = `
        <div class="ovr-kpi-card highlight">
          <div class="ovr-kpi-lbl">球隊戰力 OVR</div>
          <div class="ovr-kpi-val">${bm.userTeamOvr}</div>
          <div class="ovr-kpi-cmp">均 ${bm.teamAvgOvr}（${bm.teamOvrDiff >= 0 ? "+" : ""}${bm.teamOvrDiff}）</div>
        </div>
        <div class="ovr-kpi-card">
          <div class="ovr-kpi-lbl">戰力 / 積分排名</div>
          <div class="ovr-kpi-val">#${bm.teamOvrRank} / #${bm.standingRank}</div>
          <div class="ovr-kpi-cmp">共 ${bm.teamCount} 支球隊</div>
        </div>
        <div class="ovr-kpi-card">
          <div class="ovr-kpi-lbl">球隊磨合度</div>
          <div class="ovr-kpi-val">${ops.chemistry}</div>
          <div class="ovr-kpi-cmp">均線 65（${chemDiff >= 0 ? "+" : ""}${chemDiff}）</div>
        </div>`;
    }

    const teamOpsSub = document.getElementById("btnOpenTeamOpsSub");
    if (teamOpsSub) {
      const tac = getActiveTactic();
      const osrBtn = document.getElementById("btnOpenOffseasonReport");
    const osrSub = document.getElementById("btnOpenOffseasonSub");
    if (osrBtn) {
      if (season.offseasonReport) {
        osrBtn.style.display = "flex";
        const aceChgCnt = (season.offseasonReport.aceBoard || []).filter(x => x.aceChanged).length;
        if (osrSub) osrSub.textContent = `第 ${season.offseasonReport.year} 季休賽季異動 · ${aceChgCnt} 隊王牌易主 · 點擊詳閱`;
      } else {
        osrBtn.style.display = "none";
      }
    }
    const logCount = (ops.offseasonLog && ops.offseasonLog.length) || 0;
      teamOpsSub.textContent = `目前戰術：${tac.name}${logCount ? ` · 近期異動 ${logCount} 筆` : ""}`;
    }

    renderRosterCards(bm);
  }

  function render12StatGridWithCompare(st, lastDelta = null, heightCm = null, showCompare = true) {
    const season = getSeason();
    const db = getDB();
    const bm = showCompare ? computeLeagueBenchmarks() : null;
    const fmtD = (k) => {
      if (!lastDelta || !lastDelta[k]) return "";
      const v = lastDelta[k];
      return v > 0
        ? `<span style="color:#15803D; font-size:10px; margin-left:2px;">▲+${v}</span>`
        : `<span style="color:#C81E1E; font-size:10px; margin-left:2px;">▼${v}</span>`;
    };
    const posHMap = getPosHeightBase();
    const posBaseH = (bm && typeof bm.posAvgHeight === "number")
      ? bm.posAvgHeight
      : ((season && season.player) ? (posHMap[season.player.pos] || 186) : 186);
    const hDiff = heightCm !== null ? heightCm - posBaseH : 0;
    const hCell = heightCm !== null
      ? `<div class="stat-mini-box" style="background:#FEFCE8; border-color:var(--ink);">
           <div class="stat-mini-top"><span>身高</span><span style="color:#1D4ED8; font-weight:900;">${heightCm}cm${fmtD("heightCm")}</span></div>
           ${showCompare ? `<div class="stat-mini-cmp ${hDiff >= 0 ? "up" : "down"}">同位均${posBaseH} (${hDiff >= 0 ? "+" : ""}${hDiff})</div>` : ""}
         </div>`
      : "";

    const statDefs = (db && db.origins && db.origins.statDefs) ? db.origins.statDefs : [];
    return `<div class="stat-mini-grid" style="grid-template-columns:repeat(auto-fit, minmax(100px, 1fr));">` +
      hCell +
      statDefs.map(d => {
        const val = st[d.k] || 60;
        if (!showCompare) {
          return `<div class="stat-mini-box"><div class="stat-mini-top"><span>${d.l}</span><span style="color:${val >= 80 ? "#C81E1E" : "#111"}; font-weight:900;">${val}${fmtD(d.k)}</span></div></div>`;
        }
        const avg = (bm && bm.statAvgs && bm.statAvgs[d.k]) ? bm.statAvgs[d.k] : 70;
        const diff = val - avg;
        const cls = diff >= 2 ? "up" : (diff <= -2 ? "down" : "");
        return `<div class="stat-mini-box">
          <div class="stat-mini-top"><span>${d.l}</span><span style="color:${val >= 80 ? "#C81E1E" : "#111"}; font-weight:900;">${val}${fmtD(d.k)}</span></div>
          <div class="stat-mini-cmp ${cls}">均${avg} (${diff >= 0 ? "+" : ""}${diff})</div>
        </div>`;
      }).join("") +
      `</div>`;
  }

  /* -------------------- 3. PRE-MATCH COACH DIRECTIVE + DEFIANCE PENALTY -------------------- */
  let cachedDirectiveRoundKey = "";
  let cachedDirectiveObj = null;

  function chooseDynamicCoachDirective(season, nextG) {
    const roundKey = `${season ? season.careerYear : 1}:${season ? season.currentRoundIdx : 0}`;
    if (cachedDirectiveRoundKey === roundKey && cachedDirectiveObj) return cachedDirectiveObj;

    const p = season && season.player;
    const s = (p && p.stats) || {};
    const rotKey = (season && season.rotationKey) || "ROOKIE";
    const cond = (p && typeof p.condition === "number") ? p.condition : 100;
    const ops = ensureTeamOps();
    const chem = (ops && typeof ops.chemistry === "number") ? ops.chemistry : 65;
    const bm = computeLeagueBenchmarks();
    const oppStanding = nextG && season && (season.standings || []).find(t => t.id === nextG.oppId);
    const oppOvr = oppStanding ? (oppStanding.ovr || 78) : 78;
    const teamGap = (bm ? bm.userTeamOvr : 75) - oppOvr;

    const scoreBase = ((s.threePt || 60) + (s.midRange || 60) + (s.inside || 60)) / 3;
    const playBase = ((s.playmaking || 60) * 1.2 + (s.iq || 60) * 0.8) / 2;
    const defBase = ((s.perimDef || 60) + (s.intDef || 60) + (s.rebound || 60)) / 3;

    // Weight by Player Ability + Team Role + Opponent + Condition + Chemistry
    let wScore = Math.max(10, scoreBase - 42);
    let wPlay = Math.max(10, playBase - 42);
    let wDef = Math.max(10, defBase - 42);
    const reasons = [];

    if (rotKey === "ROOKIE" || rotKey === "ROTATION") {
      wDef += 24;
      wPlay += 14;
      wScore = Math.max(6, wScore - 16);
      reasons.push("目前為新人／輪換定位，教練優先考驗防守態度與團隊配合");
    } else if (rotKey === "ACE" || rotKey === "STAR") {
      wScore += 22;
      reasons.push("身為球隊核心主力，教練期望你主動接管比賽節奏");
    } else {
      wScore += 8; wPlay += 8; wDef += 8;
    }

    if (cond < 65) {
      wPlay += 20;
      wScore = Math.max(6, wScore - 12);
      reasons.push(`體能偏低（${cond}%），教練建議多用傳導減輕消耗`);
    }
    if (chem < 58) {
      wPlay += 18;
      reasons.push(`球隊磨合度偏低（${chem}），急需串聯隊友找回化學反應`);
    }
    if (teamGap <= -2) {
      wDef += 18;
      reasons.push(`對手戰力佔優（OVR ${oppOvr}），教練強調先靠鐵血防守咬住比分`);
    } else if (teamGap >= 3 && (rotKey === "STARTER" || rotKey === "STAR" || rotKey === "ACE")) {
      wScore += 12;
      reasons.push("我方戰力佔優，教練鼓勵強勢拉開比分");
    }

    // Deterministic per-round variation so directives genuinely rotate across games
    const seedVal = ((season ? season.careerYear * 31 + season.currentRoundIdx * 17 : 7) + (oppOvr * 3)) % 100;
    const total = wScore + wPlay + wDef;
    const roll = (seedVal / 100) * total;
    let id = "SCORE_ATTACK";
    if (roll < wScore) id = "SCORE_ATTACK";
    else if (roll < wScore + wPlay) id = "PLAYMAKE_LINK";
    else id = "LOCKDOWN_DEF";

    const idDesc = id === "SCORE_ATTACK" ? "強攻終結" : (id === "PLAYMAKE_LINK" ? "串聯組織" : "鐵血防守");
    const reasonText = reasons.length
      ? `📋 教練考量：${reasons[0]}，本場欽點【${idDesc}】。`
      : `📋 教練考量：結合你的技術特點與對手陣容，本場欽點【${idDesc}】。`;

    cachedDirectiveRoundKey = roundKey;
    cachedDirectiveObj = { id, reasonText };
    return cachedDirectiveObj;
  }

  function getCoachDirectiveId(p) {
    const season = getSeason();
    const nextG = season && season.schedule ? season.schedule[season.currentRoundIdx] : null;
    return chooseDynamicCoachDirective(season, nextG).id;
  }

  function calcDefianceProfile(trust, chem) {
    if (trust >= 75 && chem >= 75) {
      return {
        tier: "HIGH",
        tipTrust: 0, tipChem: 0, failExtraTrust: -2, teamMakeDrag: 0,
        warnText: `⚠️ 違背指示（信任 ${trust} / 磨合 ${chem}）：未達標額外 信任 -2`
      };
    }
    if (trust < 45 || chem < 45) {
      return {
        tier: "LOW",
        tipTrust: -4, tipChem: -3, failExtraTrust: -4, teamMakeDrag: -0.02,
        warnText: `🚨 違背指示（信任 ${trust} / 磨合 ${chem} 偏低）：開賽 信任 -4、磨合 -3、隊友命中 -2%；未達標再扣 信任 -4`
      };
    }
    return {
      tier: "MID",
      tipTrust: -2, tipChem: -2, failExtraTrust: -3, teamMakeDrag: 0,
      warnText: `⚠️ 違背指示（信任 ${trust} / 磨合 ${chem}）：開賽 信任 -2、磨合 -2；未達標再扣 信任 -3`
    };
  }

  function openPreMatchFocus(actionType) {
    const season = getSeason();
    pendingFocusAction = actionType;
    const modal = document.getElementById("preMatchFocusModal");
    if (!modal || !season) {
      if (actionType === "SIM") simCurrentRoundQuick();
      else launchSeasonMatch();
      return;
    }

    const g = season.schedule[season.currentRoundIdx];
    const userTeam = season.standings.find(t => t.isUserTeam) || { name: "我方" };
    const bm = computeLeagueBenchmarks();
    const rotKey = season.rotationKey || "ROOKIE";
    const dirObj = chooseDynamicCoachDirective(season, g);
    const directiveId = dirObj.id;
    const uOvrNow = season.player ? calcOVR(season.player.stats, season.player.pos, season.equippedTraits) : 72;
    const reasonEl = document.getElementById("pmFocusReason");
    if (reasonEl) reasonEl.textContent = dirObj.reasonText;
    const trust = (season.player && typeof season.player.coachTrust === "number") ? season.player.coachTrust : 35;
    const ops = ensureTeamOps();
    const chem = (ops && typeof ops.chemistry === "number") ? ops.chemistry : 65;
    const defyProf = calcDefianceProfile(trust, chem);

    const oppObj = season.standings.find(t => t.id === (g && g.oppId));
    const oppOvr = oppObj ? (oppObj.ovr || 78) : 78;
    const headerSub = document.getElementById("pmFocusMatchup");
    if (headerSub && g) {
      headerSub.innerHTML = `${userTeam.name} (OVR ${bm ? bm.userTeamOvr : "--"}) VS ${g.oppName} (OVR ${oppOvr}) · 王牌 ${playerNameLinkHtml(g.oppAce, g.oppName)}`;
    }
    const modeTag = document.getElementById("pmFocusModeTag");
    if (modeTag) modeTag.textContent = actionType === "SIM" ? "快速模擬模式" : "親自落場作戰";

    const grid = document.getElementById("pmFocusGrid");
    grid.dataset.directiveId = directiveId;
    grid.innerHTML = COACH_FOCUS_OPTIONS.map(opt => {
      const goal = opt.buildGoal(rotKey, uOvrNow);
      const isDirective = opt.id === directiveId;
      return `
        <button type="button" class="focus-card ${isDirective ? "recommended" : ""}" data-focus-id="${opt.id}">
          <div class="focus-card-top">
            <span class="focus-card-title">${opt.icon} ${opt.title}</span>
            <span style="display:inline-flex; gap:4px; align-items:center;">
              ${isDirective ? `<span class="focus-rec-badge">🎯 教練欽點指令</span>` : `<span class="tag loss">非指示方向</span>`}
              <span class="focus-card-tag">${opt.tag}</span>
            </span>
          </div>
          <div class="focus-card-quote">${opt.quote}</div>
          <div class="focus-card-fx">${opt.fx}</div>
          ${!isDirective ? `<div class="focus-defy-warn">${defyProf.warnText}</div>` : ""}
          <div class="focus-card-reward">🎯 達標：${goal.label} ｜ ${goal.rewardText}</div>
        </button>`;
    }).join("");

    modal.classList.remove("hidden");
  }

  function selectCoachFocusAndStart(focusId) {
    const season = getSeason();
    const match = getMatch();
    const grid = document.getElementById("pmFocusGrid");
    const directiveId = (grid && grid.dataset.directiveId) || getCoachDirectiveId(season && season.player);
    const opt = COACH_FOCUS_OPTIONS.find(x => x.id === focusId) || COACH_FOCUS_OPTIONS[0];
    const rotKey = (season && season.rotationKey) || "ROOKIE";
    const uOvrNow = (season && season.player) ? calcOVR(season.player.stats, season.player.pos, season.equippedTraits) : 72;
    const goal = opt.buildGoal(rotKey, uOvrNow);
    const defied = opt.id !== directiveId;

    const trust = (season && season.player && typeof season.player.coachTrust === "number") ? season.player.coachTrust : 35;
    const ops = ensureTeamOps();
    const chem = (ops && typeof ops.chemistry === "number") ? ops.chemistry : 65;
    const defyProf = calcDefianceProfile(trust, chem);

    capturePreMatchSnapshot();

    // Apply immediate defiance penalty if player chose a non-directive focus
    let tipPenaltyNote = "";
    if (defied && season && season.player) {
      if (defyProf.tipTrust !== 0) {
        season.player.coachTrust = Math.max(5, (season.player.coachTrust || 35) + defyProf.tipTrust);
      }
      if (defyProf.tipChem !== 0 && typeof adjustTeamChemistry === "function") {
        adjustTeamChemistry(defyProf.tipChem);
      }
      if (defyProf.tipTrust || defyProf.tipChem) {
        tipPenaltyNote = `違背指示（信任 ${defyProf.tipTrust}、磨合 ${defyProf.tipChem}）`;
      }
    }

    activeCoachFocus = {
      id: opt.id, icon: opt.icon, title: opt.title, tag: opt.tag,
      target: goal.target, label: goal.label, rewardText: goal.rewardText,
      defied, defyProf, tipPenaltyNote
    };
    if (match) match.coachFocus = { ...activeCoachFocus };

    document.getElementById("preMatchFocusModal").classList.add("hidden");
    const act = pendingFocusAction;
    pendingFocusAction = null;
    if (act === "SIM") simCurrentRoundQuick();
    else launchSeasonMatch();
  }

  function getActiveCoachFocus() {
    const match = getMatch();
    if (match && match.coachFocus) return match.coachFocus;
    return activeCoachFocus;
  }

  function evaluateCoachFocusPostMatch(userBox) {
    const season = getSeason();
    const match = getMatch();
    const f = getActiveCoachFocus();
    if (!f || !season || !season.player) return null;
    const opt = COACH_FOCUS_OPTIONS.find(x => x.id === f.id);
    if (!opt) return null;
    const uOvrNow = (season && season.player) ? calcOVR(season.player.stats, season.player.pos, season.equippedTraits) : 72;
    const goal = opt.buildGoal(season.rotationKey || "ROOKIE", uOvrNow);
    const met = goal.check(userBox || {});
    let rewardApplied = "";
    let penaltyApplied = f.tipPenaltyNote || "";

    if (met) {
      rewardApplied = goal.applyReward(season.player, season);
      if (f.defied && f.defyProf && f.defyProf.tier === "HIGH") {
        season.player.coachTrust = Math.min(100, (season.player.coachTrust || 35) + 2);
        rewardApplied += "、王牌正名信任 +2";
      }
    } else if (f.defied && f.defyProf && f.defyProf.failExtraTrust) {
      season.player.coachTrust = Math.max(5, (season.player.coachTrust || 35) + f.defyProf.failExtraTrust);
      penaltyApplied = penaltyApplied
        ? `${penaltyApplied} ＋ 未達標追加信任 ${f.defyProf.failExtraTrust}`
        : `違背指示且未達標：教練信任 ${f.defyProf.failExtraTrust}`;
    }

    const result = {
      id: f.id, icon: f.icon, title: f.title, label: goal.label,
      met, defied: Boolean(f.defied),
      progress: goal.progressText(userBox || {}),
      rewardApplied, penaltyApplied
    };
    activeCoachFocus = null;
    if (match) match.coachFocus = null;
    return result;
  }

  function capturePreMatchSnapshot() {
    const season = getSeason();
    if (!season || !season.player) return;
    const p = season.player;
    const bm = computeLeagueBenchmarks();
    preMatchSnapshot = {
      ovr: calcOVR(p.stats, p.pos, season.equippedTraits),
      trust: p.coachTrust || 35,
      condition: typeof p.condition === "number" ? p.condition : 100,
      reputation: p.reputation || 45,
      heightCm: p.heightCm || 185,
      stats: { ...(p.stats || {}) },
      standingRank: bm ? bm.standingRank : 1
    };
  }

  function takePlayerSnapshot() {
    const season = getSeason();
    if (!season || !season.player) return null;
    const p = season.player;
    return {
      ovr: calcOVR(p.stats, p.pos, season.equippedTraits),
      trust: p.coachTrust || 35,
      condition: typeof p.condition === "number" ? p.condition : 100,
      reputation: p.reputation || 45,
      rivalHeat: p.rivalHeat || 35,
      heightCm: p.heightCm || 185,
      ap: p.ap || 0,
      stats: { ...(p.stats || {}) },
      traitsCount: (season.equippedTraits || []).length
    };
  }

  /* -------------------- 2. UNIFIED SETTLEMENT MODAL -------------------- */
  function buildNextMatchGoalText() {
    const season = getSeason();
    if (!season) return "繼續備戰下一場比賽！";
    if (season.retired) return "生涯已榮耀謝幕，隨時可點擊「新建生涯」開啟下一段籃球傳奇！";
    if (season.currentRoundIdx >= season.schedule.length) {
      return "本季賽程已全部結束！點擊頂部「🏆 壓縮賽季進入下一年」邁向新階段。";
    }
    const g = season.schedule[season.currentRoundIdx];
    const p = season.player;
    if (p && p.ap > 0) {
      return p.condition < 65
        ? `下一戰對決 ${g.oppName}（王牌：${g.oppAce}）· 尚餘 ${p.ap} AP，建議先去【我】→ 場外養成做冰浴恢復。`
        : `下一戰對決 ${g.oppName}（王牌：${g.oppAce}）· 尚餘 ${p.ap} AP，可先去【我】→ 場外養成提升能力！`;
    }
    const trust = (p && p.coachTrust) || 35;
    const trustGoal = trust < 60 ? "並衝刺教練信任至 60 搶佔先發" : "穩固主力地位衝擊季後賽";
    return `下一戰 ${g.isHome ? "主場" : "客場"} 迎戰 ${g.oppName}（王牌：${g.oppAce}）：鎖定勝利${trustGoal}！`;
  }

  function showUnifiedSettlement(cfg) {
    const season = getSeason();
    const modal = document.getElementById("unifiedSettlementModal");
    if (!modal) return;

    // Close hub detail drawer if training was launched from it
    closeSectionModal();

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
        if (fr.met) {
          fvEl.innerHTML = `${fr.defied ? "⚡ 違背指示但用實力正名！" : "🎯 教練指令達成！"}【${fr.title}】（${fr.progress}）→ 獲得：<strong>${fr.rewardApplied}</strong>${fr.penaltyApplied ? `<br/>⚠️ 開賽磨合代價：${fr.penaltyApplied}` : ""}`;
        } else {
          fvEl.innerHTML = `${fr.defied ? "🚨 違背教練指示且未達標！" : "📋 教練指令未達標"}【${fr.title}】（${fr.progress} · 目標：${fr.label}）${fr.penaltyApplied ? `<br/>懲罰：<strong>${fr.penaltyApplied}</strong>` : ""}`;
        }
      } else {
        fvEl.style.display = "none";
      }
    }

    const gains = (cfg.gains || []).slice(0, 3);
    while (gains.length < 3) {
      gains.push({
        label: "目前總評 OVR",
        value: `${season && season.player ? calcOVR(season.player.stats, season.player.pos, season.equippedTraits) : "--"}`,
        dir: "flat",
        note: "穩步累積"
      });
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
    settlementUnlockTimer = setTimeout(() => { contBtn.disabled = false; }, 420);

    modal.classList.remove("hidden");
  }

  function buildGainsFromSnapshots(before, after, extras = []) {
    const db = getDB();
    const gains = [];
    const statDefs = (db && db.origins && db.origins.statDefs) || [];
    if (before && after && before.stats && after.stats) {
      for (const d of statDefs) {
        const b = before.stats[d.k], a = after.stats[d.k];
        if (typeof b === "number" && typeof a === "number" && a !== b) {
          gains.push({ label: d.l, value: `${b}→${a}${a > b ? "↑" : "↓"}`, dir: a > b ? "up" : "down", note: a > b ? `+${a - b} 成長` : `${a - b} 變動` });
        }
      }
    }
    if (before && after && after.heightCm !== before.heightCm) {
      gains.push({ label: "身高發育", value: `${before.heightCm}→${after.heightCm}cm↑`, dir: "up", note: `+${after.heightCm - before.heightCm}cm` });
    }
    if (before && after && after.ovr !== before.ovr) {
      gains.push({ label: "總評 OVR", value: `${before.ovr}→${after.ovr}${after.ovr > before.ovr ? "↑" : "↓"}`, dir: after.ovr > before.ovr ? "up" : "down", note: "綜合戰力變化" });
    }
    if (before && after && after.trust !== before.trust) {
      gains.push({ label: "教練信任", value: `${before.trust}→${after.trust}${after.trust > before.trust ? "↑" : "↓"}`, dir: after.trust > before.trust ? "up" : "down", note: after.trust > before.trust ? "輪換更穩固" : "信任下滑" });
    }
    if (before && after && after.reputation !== before.reputation) {
      gains.push({ label: "個人名氣", value: `${before.reputation}→${after.reputation}${after.reputation > before.reputation ? "↑" : "↓"}`, dir: after.reputation > before.reputation ? "up" : "down", note: "球探關注度" });
    }
    if (before && after && after.condition !== before.condition) {
      gains.push({ label: "賽季狀態", value: `${before.condition}%→${after.condition}%${after.condition > before.condition ? "↑" : "↓"}`, dir: after.condition > before.condition ? "up" : "down", note: after.condition >= 80 ? "狀態火熱" : (after.condition < 55 ? "建議恢復" : "體能可控") });
    }
    for (const ex of extras) {
      if (gains.length < 3) gains.push(ex);
    }
    return gains.slice(0, 3);
  }

  function showPostMatchSettlement(opts) {
    const after = takePlayerSnapshot() || { ovr: "--", trust: 35, condition: 100, reputation: 45 };
    const bm = computeLeagueBenchmarks();
    const extras = [
      { label: "本場個人表現", value: `${opts.userPts}分 ${opts.userReb}板 ${opts.userAst}助`, dir: opts.won ? "up" : "flat", note: opts.won ? "率隊取勝" : "吸取經驗" },
      { label: "總評 OVR 對比", value: `${bm ? bm.userOvr : after.ovr}（均${bm ? bm.playerAvgOvr : "--"}）`, dir: (bm && bm.playerOvrDiff >= 0) ? "up" : "flat", note: bm ? `全聯盟 #${bm.playerOvrRank}/${bm.totalPlayers}` : "" },
      { label: "本週行動點", value: `已補滿 2 AP↑`, dir: "up", note: "可回【我】養成" }
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

  function showTrainingSettlement(before, title, detail, tier, onContinue = null) {
    const after = takePlayerSnapshot();
    if (!before || !after) return;
    const bm = computeLeagueBenchmarks();
    const extras = [
      { label: "總評 OVR", value: `${after.ovr}（均${bm ? bm.playerAvgOvr : "--"}）`, dir: after.ovr > before.ovr ? "up" : "flat", note: bm ? `聯盟 #${bm.playerOvrRank}` : "" },
      { label: "剩餘行動點", value: `${before.ap}→${after.ap} AP`, dir: "flat", note: after.ap > 0 ? "還可繼續安排" : "可開打下場比賽" },
      { label: "賽季狀態", value: `${after.condition}%`, dir: after.condition >= 75 ? "up" : "down", note: after.condition >= 75 ? "狀態良好" : "注意疲勞" }
    ];
    const gains = buildGainsFromSnapshots(before, after, extras);
    const badgeMap = { GREAT: "✨ 特訓大成功時刻", SUCCESS: "✅ 訓練達標時刻", FAIL: "⚠️ 訓練波折時刻", INJURY: "🚑 傷病警示時刻" };
    showUnifiedSettlement({
      stamp: "🏋️ 場外訓練結算", subTag: `尚餘 ${after.ap} AP`,
      mvpBadge: badgeMap[tier] || "🏋️ 訓練時刻", mvpTitle: title, mvpSub: detail,
      gains, nextGoal: buildNextMatchGoalText(), continueLabel: "繼續 ▶", onContinue
    });
  }

  function showEventSettlement(before, evtTitle, ok, outText) {
    const after = takePlayerSnapshot();
    if (!before || !after) return;
    const bm = computeLeagueBenchmarks();
    const extras = [
      { label: "總評 OVR", value: `${after.ovr}（均${bm ? bm.playerAvgOvr : "--"}）`, dir: after.ovr > before.ovr ? "up" : "flat", note: bm ? `聯盟 #${bm.playerOvrRank}` : "" },
      { label: "教練信任", value: `${after.trust} / 100`, dir: after.trust > before.trust ? "up" : "flat", note: "隊內地位指標" },
      { label: "個人名氣", value: `${after.reputation} / 100`, dir: after.reputation > before.reputation ? "up" : "flat", note: "球探與媒體熱度" }
    ];
    const gains = buildGainsFromSnapshots(before, after, extras);
    showUnifiedSettlement({
      stamp: "📅 生涯事件結算", subTag: ok ? "✅ 順利化解" : "⚠️ 歷練考驗",
      mvpBadge: ok ? "🌟 關鍵人生時刻" : "⚡ 成長轉折時刻", mvpTitle: evtTitle, mvpSub: outText,
      gains, nextGoal: buildNextMatchGoalText(), continueLabel: "繼續 ▶"
    });
  }

  /* -------------------- 6. TITLE SCREEN & 3-STEP ONBOARDING + TUTORIAL MATCH -------------------- */
  let activeCodexTab = "unlocks";

  function openSkillCodex(tab = "unlocks") {
    const modal = document.getElementById("skillCodexModal");
    if (!modal) return;
    activeCodexTab = tab || "unlocks";
    renderSkillCodexTab(activeCodexTab);
    modal.classList.remove("hidden");
  }

  function renderSkillCodexTab(tab) {
    const season = getSeason();
    const db = getDB();
    const body = document.getElementById("codexBody");
    if (!body || !season || !db || !db.skills) return;
    activeCodexTab = tab;
    document.querySelectorAll("#codexTabBar .osr-tab").forEach(b => b.classList.toggle("active", b.dataset.codexTab === tab));

    const owned = new Set(season.equippedTraits || []);
    const allSkills = db.skills.skills || [];
    const skMap = new Map(allSkills.map(s => [s.id, s]));
    const prog = typeof window.ensureSkillProgress === "function" ? window.ensureSkillProgress(season) : {};
    const chains = window.SKILL_UNLOCK_CHAINS || [];
    const syns = window.SKILL_SYNERGIES || [];

    if (tab === "unlocks") {
      body.innerHTML = chains.map(ch => {
        const sk = skMap.get(ch.skillId);
        const name = sk ? sk.name : ch.skillId;
        const isDone = owned.has(ch.skillId);
        const cur = Math.min(ch.target, prog[ch.metric] || 0);
        const pct = isDone ? 100 : Math.round((cur / Math.max(1, ch.target)) * 100);
        return `
          <div class="codex-card ${isDone ? "unlocked" : ""}">
            <div class="osr-team-top">
              <strong>${name}</strong>
              <span class="tag ${isDone ? "gold" : ""}">${isDone ? "✅ 已領悟" : `${cur} / ${ch.target}`}</span>
            </div>
            <div style="font-size:11.5px; color:var(--ink); font-weight:800;">條件：${ch.condText}</div>
            <div class="codex-prog-track"><div class="codex-prog-fill ${isDone ? "done" : ""}" style="width:${pct}%;"></div></div>
            <div class="codex-story">${ch.story}</div>
          </div>`;
      }).join("");
    } else if (tab === "synergies") {
      body.innerHTML = syns.map(syn => {
        const hasA = owned.has(syn.req[0]);
        const hasB = owned.has(syn.req[1]);
        const active = hasA && hasB;
        const skA = skMap.get(syn.req[0]);
        const skB = skMap.get(syn.req[1]);
        const statusTag = active
          ? `<span class="tag gold">🔥 已啟動聯動</span>`
          : ((hasA || hasB) ? `<span class="tag win">差 1 項即可啟動</span>` : `<span class="tag">未啟動</span>`);
        return `
          <div class="codex-card ${active ? "synergy-active" : ""}">
            <div class="osr-team-top">
              <strong>${syn.name}</strong>
              ${statusTag}
            </div>
            <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap; margin:5px 0;">
              <span class="tag ${hasA ? "win" : ""}">${hasA ? "✓ " : ""}${skA ? skA.name : syn.req[0]}</span>
              <span style="font-weight:900;">＋</span>
              <span class="tag ${hasB ? "win" : ""}">${hasB ? "✓ " : ""}${skB ? skB.name : syn.req[1]}</span>
            </div>
            <div style="font-size:12px; font-weight:900; color:var(--crimson);">隱藏效果：${syn.desc}</div>
            <div class="codex-story">${syn.story}</div>
          </div>`;
      }).join("");
    } else {
      const visible = allSkills.filter(s => s.category !== "SYSTEM");
      body.innerHTML = visible.map(sk => {
        const has = owned.has(sk.id);
        const story = typeof window.getSkillStory === "function" ? window.getSkillStory(sk) : "";
        return `
          <div class="codex-card ${has ? "unlocked" : ""}">
            <div class="osr-team-top">
              <strong>${sk.name}</strong>
              <span class="tag ${has ? "gold" : (sk.category === "RED_TRAIT" ? "loss" : "")}">${has ? "已裝備" : (sk.category === "RED_TRAIT" ? "負面特質" : "未擁有")}</span>
            </div>
            <div style="font-size:11.5px; color:var(--ink); margin-top:2px;">${sk.desc || ""}</div>
            <div class="codex-story">${story}</div>
          </div>`;
      }).join("");
    }
  }

  let activeOsrTab = "myteam";

  function openOffseasonReport(tab = "myteam") {
    const season = getSeason();
    const modal = document.getElementById("offseasonReportModal");
    if (!modal || !season || !season.offseasonReport) return;
    activeOsrTab = tab || "myteam";
    const rep = season.offseasonReport;
    const stamp = document.getElementById("osrSeasonStamp");
    const title = document.getElementById("osrTitle");
    if (stamp) stamp.textContent = `第 ${rep.year} 季開季前`;
    if (title) title.textContent = `${rep.leagueName}・休賽季異動快報`;
    renderOffseasonReportTab(activeOsrTab);
    modal.classList.remove("hidden");
  }

  function renderOffseasonReportTab(tab) {
    const season = getSeason();
    const body = document.getElementById("osrBody");
    if (!body || !season || !season.offseasonReport) return;
    const rep = season.offseasonReport;
    activeOsrTab = tab;

    document.querySelectorAll("#osrTabBar .osr-tab").forEach(b => {
      b.classList.toggle("active", b.dataset.osrTab === tab);
    });

    if (tab === "myteam") {
      const logs = rep.myTeamLogs || [];
      body.innerHTML = `
        <div class="osr-section-head">🏠 ${rep.myTeamName} 本季陣容異動</div>
        ${logs.length
          ? logs.map(line => `<div class="osr-log-row">${line}</div>`).join("")
          : `<div class="osr-empty">本隊維持既有班底，默契持續升溫！</div>`}`;
    } else if (tab === "league") {
      const moves = rep.leagueMoves || [];
      body.innerHTML = moves.map(m => {
        const depHtml = (m.departures || []).length
          ? m.departures.map(d => `<span class="tag loss" style="margin:2px 3px 2px 0;">${d.reason} ${d.name}(${d.pos}·${d.ovr})${d.wasAce ? "👑" : ""}</span>`).join("")
          : `<span style="font-size:11px; color:var(--ink-soft);">無主力離隊</span>`;
        const arrHtml = (m.arrivals || []).length
          ? m.arrivals.map(a => `<span class="tag ${a.isSuperRookie ? "gold" : "win"}" style="margin:2px 3px 2px 0;">${a.isSuperRookie ? "🌟" : "+"}${playerNameLinkHtml(a.name, m.teamName, `${a.name}(${a.pos}·${a.ovr})`)}</span>`).join("")
          : `<span style="font-size:11px; color:var(--ink-soft);">無新援加盟</span>`;
        const aceBadge = m.aceChanged ? `<span class="tag gold">🔥 新王牌：${playerNameLinkHtml(m.newAce, m.teamName)}</span>` : `<span style="font-size:11px; color:var(--ink-soft);">王牌：${playerNameLinkHtml(m.newAce, m.teamName)}</span>`;
        return `
          <div class="osr-team-card">
            <div class="osr-team-top">
              <strong>${m.teamName}（戰力 ${m.teamOvr}）</strong>
              ${aceBadge}
            </div>
            <div class="osr-move-line"><span class="osr-lbl">離隊：</span>${depHtml}</div>
            <div class="osr-move-line"><span class="osr-lbl">加盟：</span>${arrHtml}</div>
            ${(m.growths && m.growths.length) ? `<div class="osr-move-line"><span class="osr-lbl">成長：</span>${m.growths.map(g => `<span class="tag" style="margin:2px 3px 2px 0; background:#EFF6FF; color:#1D4ED8;">▲${playerNameLinkHtml(g.name, m.teamName, `${g.name}+${g.delta}→${g.ovr}`)}</span>`).join("")}</div>` : ""}
          </div>`;
      }).join("") || `<div class="osr-empty">本季無聯賽異動紀錄。</div>`;
    } else if (tab === "rookies") {
      const rookies = rep.topRookies || [];
      body.innerHTML = `
        <div class="osr-section-head">🌟 本季全聯賽焦點新人（點擊姓名查看詳細球探卡）</div>
        ${rookies.map(r => {
          const skChips = (r.skills || []).slice(0, 3).map(id => renderSkillChip(id, "font-size:10px; padding:2px 5px;")).join("");
          return `
            <div class="osr-rookie-card ${r.isSuperRookie ? "super" : ""}">
              <div class="osr-team-top">
                <div>
                  ${r.isSuperRookie ? '<span class="tag gold">🌟 天選超級新人</span> ' : '<span class="tag">新秀</span> '}
                  <strong>${playerNameLinkHtml(r.name, r.teamName)}</strong>
                  <span style="font-size:11px; color:var(--ink-soft);">(${r.pos} · ${r.age}歲 · ${r.teamName})</span>
                </div>
                <strong style="font-size:15px; color:var(--crimson);">評級 ${r.ovr}</strong>
              </div>
              <div style="font-size:11px; color:#92400E; font-weight:800; margin:3px 0;">潛力 ${"★".repeat(r.potential || 3)} ${r.archetypeTag ? `· 球風【${r.archetypeTag}】` : ""}</div>
              <div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:4px;">${skChips || '<span style="font-size:11px; color:var(--ink-soft);">基礎潛力新秀</span>'}</div>
            </div>`;
        }).join("") || `<div class="osr-empty">本季無焦點新人資料。</div>`}`;
    } else if (tab === "aces") {
      const board = rep.aceBoard || [];
      body.innerHTML = `
        <div class="osr-section-head">👑 新球季各隊頭號王牌與球隊戰力</div>
        ${board.map((row, idx) => `
          <div class="osr-ace-row ${row.isUserTeam ? "is-user" : ""}">
            <div class="osr-ace-left">
              <span class="osr-rank">#${idx + 1}</span>
              <div>
                <div style="font-weight:900; font-size:13px;">${playerNameLinkHtml(row.aceName, row.teamName)} <span class="tag">${row.acePos}</span> ${row.aceChanged ? '<span class="tag gold">🔥 新王牌</span>' : ''}</div>
                <div style="font-size:11px; color:var(--ink-soft);">${row.teamName}（球隊戰力 ${row.teamOvr}）${row.aceChanged ? ` · 接替 ${row.oldAce}` : ""}</div>
              </div>
            </div>
            <div class="osr-ace-ovr">${row.aceOvr}</div>
          </div>`).join("")}`;
    }
  }

  async function renderTitleSaveSlots() {
    const wrap = document.getElementById("titleSaveSlots");
    if (!wrap || typeof SaveManager === "undefined" || !SaveManager.listSlots) return;
    const slots = await SaveManager.listSlots();
    const active = SaveManager.getActiveSlot();
    const fmtDate = (ts) => {
      try {
        const d = new Date(ts);
        return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      } catch (_) { return ""; }
    };
    wrap.innerHTML = slots.map(s => {
      const isAct = s.slot === active;
      if (s.empty || !s.meta) {
        return `
          <div class="save-slot-card empty ${isAct ? "active-slot" : ""}">
            <div class="save-slot-head">
              <span class="save-slot-badge">存檔槽 ${s.slot}</span>
              <span style="font-size:11px; color:var(--ink-soft);">空白存檔位</span>
            </div>
            <button type="button" class="manga-btn primary" data-slot-new="${s.slot}" style="width:100%; margin-top:6px; padding:8px 10px; font-size:13px;">🏀 在槽位 ${s.slot} 開啟新旅程</button>
          </div>`;
      }
      const m = s.meta;
      return `
        <div class="save-slot-card ${isAct ? "active-slot" : ""}">
          <div class="save-slot-head">
            <span class="save-slot-badge ${isAct ? "gold" : ""}">存檔槽 ${s.slot}${isAct ? " · 上次遊玩" : ""}</span>
            <span style="font-size:10.5px; color:var(--ink-soft);">${fmtDate(m.updatedAt)}</span>
          </div>
          <div class="save-slot-main">
            <div>
              <div style="font-size:14.5px; font-weight:900;">${m.name} <span class="tag">${m.pos}</span> <span style="color:var(--crimson);">評級 ${m.ovr}</span></div>
              <div style="font-size:11.5px; color:var(--ink-soft); margin-top:2px;">第 ${m.careerYear} 季 · ${m.leagueName} · ${m.teamName}（${m.wl}）${m.retired ? " · 🏛️已退役" : ""}</div>
            </div>
          </div>
          <div class="save-slot-actions">
            <button type="button" class="manga-btn primary" data-slot-load="${s.slot}" style="flex:1; padding:7px 10px; font-size:12.5px;">🏀 繼續生涯</button>
            <button type="button" class="manga-btn" data-slot-export="${s.slot}" style="padding:7px 9px; font-size:11.5px;" title="匯出 JSON 備份">📤 備份</button>
            <button type="button" class="manga-btn" data-slot-delete="${s.slot}" style="padding:7px 9px; font-size:11.5px; color:#B91C1C;" title="清空此存檔槽">🗑️</button>
          </div>
        </div>`;
    }).join("");
  }

  async function showTitleScreen(hasSave) {
    ["viewHub", "viewMatch", "viewCreate"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove("active");
    });
    const titleView = document.getElementById("viewTitle");
    if (!titleView) return;
    titleView.classList.add("active");
    await renderTitleSaveSlots();
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
    const season = getSeason();
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
      if (sum && season && season.player) {
        const p = season.player;
        const ovr = calcOVR(p.stats, p.pos, season.equippedTraits);
        sum.innerHTML = `<strong>#${p.jerseyNum || 16} ${p.name}</strong>（${p.pos} · ${p.heightCm}cm）｜天賦：<strong>${p.rarityName}</strong>（上限 ${p.cap}）｜初始 OVR：<strong>${ovr}</strong>`;
      }
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function launchTutorialMatch() {
    const season = getSeason();
    const db = getDB();
    const match = getMatch();
    if (!season || !season.player || !db || !match) return;
    isTutorialMatch = true;
    clearPendingEventTimer();
    hideSkillPopover();

    const league = db.leagues.leagues.find(l => l.id === season.leagueId) || db.leagues.leagues[0];
    const userTeamObj = league.teams.find(t => t.isUserTeam) || league.teams[0];
    const oppTeamObj = league.teams.find(t => !t.isUserTeam) || league.teams[1];

    match.league = { ...league, quarterMinutes: 2, otMinutes: 1 };
    match.homeName = `${userTeamObj.name} · 新秀隊`;
    match.awayName = `${oppTeamObj.name} · 試訓隊`;
    syncUserTeamRole(false);
    match.homeTeam = season.userRoster.map(p => createPlayer(p, "HOME"));
    match.awayTeam = buildOpponentRoster(oppTeamObj).map(p => createPlayer(p, "AWAY"));
    match.userPlayer = match.homeTeam.find(p => p.isUser) || match.homeTeam[1];
    match.rivalPlayer = match.awayTeam.find(p => p.isRival) || match.awayTeam[2];

    if (!match.userPlayer.onFloor) {
      const swapOut = match.homeTeam.find(p => !p.isUser && p.onFloor);
      if (swapOut) swapOut.onFloor = false;
      match.userPlayer.onFloor = true;
    }
    match.userPlayer.stamina = 100;
    match.userPlayer.maxStaminaCap = 100;

    match.quarter = 4; match.timeLeftSec = 120;
    match.homeScore = 18; match.awayScore = 16;
    match.qScoresHome = [6, 6, 6, 0]; match.qScoresAway = [6, 5, 5, 0];
    match.benchReason = ""; match.totalGameSec = 0; match.tension = 82;
    match.cooldownSec = 0; match.userSubCooldownSec = 999; match.rivalHardTriggersThisQ = 0;
    match.makeStreak = 0; match.missStreak = 0; match.perfectStreak = 0; match.perfectsTotal = 0;
    match.isZone = false; match.zonePossessionsLeft = 0; match.isGrit = false;
    match.recentActionIds = []; match.commHistory = []; match.shotAnim = null;
    match.activeScenario = null; match.pendingPostCutIn = null; match.coachFocus = null;

    document.getElementById("pbpLog").innerHTML = "";
    document.getElementById("viewCreate").classList.remove("active");
    document.getElementById("viewHub").classList.remove("active");
    document.getElementById("viewTitle").classList.remove("active");
    document.getElementById("viewMatch").classList.add("active");
    document.getElementById("boxScoreModal").classList.add("hidden");
    setDockMode("NONE");
    resizeCanvas();

    match.fastSimming = false;
    const fbtn = document.getElementById("btnFastSimMatch");
    if (fbtn) fbtn.disabled = false;
    match.phase = "PLAYING";
    match.simAccumulator = 0;
    SoundFX.whistle();
    broadcast("🎓 【新手教學賽】最後 2 分鐘決勝試訓！留意「子彈時間」選卡與 QTE 黃金區間鎖定！", true);
    updateHUD();
  }

  function handleTutorialMatchEnd() {
    const season = getSeason();
    const match = getMatch();
    isTutorialMatch = false;
    const u = (match && match.userPlayer) || { pts: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0 };
    if (season && season.player) {
      season.player.tutorialDone = true;
      SaveManager.save(season);
    }
    if (match) match.phase = "IDLE";
    document.getElementById("viewMatch").classList.remove("active");
    document.getElementById("viewHub").classList.add("active");
    switchHubTab("htab-match");
    renderHub();

    showUnifiedSettlement({
      stamp: "🎓 教學賽完成！",
      subTag: `試訓比分 ${match ? match.homeScore : 0} : ${match ? match.awayScore : 0}`,
      mvpBadge: "⭐ 新手引導 3/3 達成",
      mvpTitle: `${season && season.player ? season.player.name : "新秀"} 完成高一入隊試訓！`,
      mvpSub: `教學賽拿下 ${u.pts} 分 ${(u.oreb || 0) + (u.dreb || 0)} 板 ${u.ast} 助（本場不計入正式戰績）。你已經掌握子彈時間與 QTE 節奏！`,
      gains: [
        { label: "教學賽得分", value: `${u.pts} 分`, dir: u.pts > 0 ? "up" : "flat", note: "試訓手感熱身" },
        { label: "完美判定次數", value: `${(match && match.perfectsTotal) || 0} 次`, dir: (match && match.perfectsTotal) > 0 ? "up" : "flat", note: "QTE 精準鎖定" },
        { label: "正式球季 AP", value: "2 / 2 AP↑", dir: "up", note: "已解鎖場外特訓" }
      ],
      nextGoal: "正式踏入日本全國高校大賽！點頂部「開始下一場比賽」或去【我】→ 場外養成。",
      continueLabel: "🏀 進入球季大廳 ▶"
    });
  }

  /* -------------------- LEAGUE STAT LEADERS & SEASON AWARDS CEREMONY -------------------- */
  let activeLeaderCat = "ppg";
  let awardsProceedCb = null;

  function ensureLeaguePlayerTotals() {
    const season = getSeason();
    if (!season) return {};
    if (!season.leaguePlayerTotals || typeof season.leaguePlayerTotals !== "object") {
      season.leaguePlayerTotals = {};
    }
    return season.leaguePlayerTotals;
  }

  function recordMatchToLeagueTotals(teamId, teamName, playerList) {
    const totals = ensureLeaguePlayerTotals();
    if (!Array.isArray(playerList)) return;
    for (const pl of playerList) {
      if (!pl || !pl.name) continue;
      const key = `${teamId}::${pl.name}`;
      if (!totals[key]) {
        totals[key] = {
          name: pl.name, teamId, teamName, pos: pl.pos || "SG",
          age: (pl.isUser && season.player ? season.player.age : (pl.age || 17)), ovr: pl.ovr || 70, isUser: Boolean(pl.isUser),
          gp: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0
        };
      }
      const rec = totals[key];
      rec.teamName = teamName;
      rec.isUser = Boolean(pl.isUser);
      if (pl.ovr) rec.ovr = pl.ovr;
      const resolvedAge = (pl.isUser && season.player) ? season.player.age : pl.age;
      if (resolvedAge) rec.age = resolvedAge;
      rec.gp += 1;
      rec.pts += (pl.pts || 0);
      rec.reb += ((pl.oreb || 0) + (pl.dreb || 0));
      rec.ast += (pl.ast || 0);
      rec.stl += (pl.stl || 0);
      rec.blk += (pl.blk || 0);
    }
  }

  function recordSimulatedTeamGame(teamId, teamName, teamPts, leagueObj) {
    const db = getDB();
    const lg = leagueObj || (db && db.leagues && db.leagues.leagues.find(l => l.id === (getSeason() && getSeason().leagueId)));
    if (!lg) return;
    const tm = (lg.teams || []).find(t => t.id === teamId);
    if (!tm) return;
    const rawRoster = (typeof window.getLiveTeamRoster === "function")
      ? window.getLiveTeamRoster(tm.id, lg.id)
      : ((Array.isArray(tm.roster) && tm.roster.length) ? tm.roster : (typeof buildOpponentRoster === "function" ? buildOpponentRoster(tm) : []));
    const profiled = rawRoster.map(pl =>
      (!pl.stats || !pl.heightCm) && typeof generateNpcProfile === "function" ? generateNpcProfile({ ...pl }) : pl
    );
    const qScale = (lg.quarterMinutes || 8) / 8;
    // Distribute exact integer teamPts across 12 players (sum === teamPts!), and realistic team reb/ast/stl/blk
    const teamReb = Math.max(20, Math.round((24 + Math.random() * 10) * qScale));
    const teamAst = Math.max(8, Math.round(teamPts * (0.22 + Math.random() * 0.08)));
    const teamStl = Math.max(2, Math.round((4 + Math.random() * 4) * qScale));
    const teamBlk = Math.max(1, Math.round((2 + Math.random() * 3.5) * qScale));

    const distributeInt = (total, weights) => {
      const sumW = weights.reduce((a, b) => a + b, 0) || 1;
      const out = weights.map(w => Math.floor((total * w) / sumW));
      let rem = total - out.reduce((a, b) => a + b, 0);
      const order = weights.map((w, i) => ({ i, frac: ((total * w) / sumW) - out[i] })).sort((a, b) => b.frac - a.frac);
      for (let k = 0; k < rem; k++) out[order[k % order.length].i] += 1;
      return out;
    };

    const ptsW = profiled.map(p => {
      const s = p.stats || {};
      const m = p.role === "STARTER" ? 1.85 : 0.45;
      return Math.max(1, ((s.threePt || 60) + (s.midRange || 60) + (s.inside || 60) - 120 + (p.isRival ? 28 : 0)) * m * (0.75 + Math.random() * 0.5));
    });
    const rebW = profiled.map(p => {
      const s = p.stats || {};
      const m = p.role === "STARTER" ? 1.75 : 0.45;
      return Math.max(1, ((s.rebound || 60) - 35 + Math.max(0, (p.heightCm || 185) - 178) * 1.2) * m * (0.75 + Math.random() * 0.5));
    });
    const astW = profiled.map(p => {
      const s = p.stats || {};
      const m = p.role === "STARTER" ? 1.8 : 0.42;
      return Math.max(1, ((s.playmaking || 60) + (s.iq || 60) - 85 + (p.pos === "PG" ? 24 : 0)) * m * (0.7 + Math.random() * 0.6));
    });
    const stlW = profiled.map(p => {
      const s = p.stats || {};
      const m = p.role === "STARTER" ? 1.65 : 0.45;
      return Math.max(1, ((s.perimDef || 60) + (s.speed || 60) - 90) * m * (0.6 + Math.random() * 0.8));
    });
    const blkW = profiled.map(p => {
      const s = p.stats || {};
      const m = p.role === "STARTER" ? 1.7 : 0.4;
      return Math.max(1, ((s.intDef || 60) + (s.vertical || 60) - 95 + Math.max(0, (p.heightCm || 185) - 186) * 2.0) * m * (0.6 + Math.random() * 0.8));
    });

    const ptsArr = distributeInt(teamPts, ptsW);
    const rebArr = distributeInt(teamReb, rebW);
    const astArr = distributeInt(teamAst, astW);
    const stlArr = distributeInt(teamStl, stlW);
    const blkArr = distributeInt(teamBlk, blkW);

    const boxList = profiled.map((p, i) => ({
      name: p.name, pos: p.pos, age: p.age, ovr: p.ovr, isUser: false,
      pts: ptsArr[i], oreb: Math.floor(rebArr[i] * 0.3), dreb: Math.ceil(rebArr[i] * 0.7),
      ast: astArr[i], stl: stlArr[i], blk: blkArr[i]
    }));
    recordMatchToLeagueTotals(teamId, teamName, boxList);
  }

  function backfillTotalsFromLegacySave() {
    const season = getSeason();
    const db = getDB();
    if (!season || !db || !db.leagues) return;
    const totals = ensureLeaguePlayerTotals();
    if (Object.keys(totals).length > 0) return;
    const league = db.leagues.leagues.find(l => l.id === season.leagueId) || db.leagues.leagues[0];
    const uTeam = (season.standings || []).find(t => t.isUserTeam);
    if (!uTeam) return;
    // Replay actual recorded boxScores from schedule
    for (const g of (season.schedule || [])) {
      if (g.played && g.boxScore) {
        recordMatchToLeagueTotals(uTeam.id, uTeam.name, g.boxScore.homeTeam || []);
        recordMatchToLeagueTotals(g.oppId, g.oppName, g.boxScore.awayTeam || []);
      }
    }
    // Backfill remaining teams up to their actual standings GP & PF
    for (const st of (season.standings || [])) {
      if (st.id === uTeam.id) continue;
      const gpTarget = (st.w || 0) + (st.l || 0);
      const existingRec = Object.values(totals).find(r => r.teamId === st.id);
      const curGp = existingRec ? existingRec.gp : 0;
      const curPf = Object.values(totals).filter(r => r.teamId === st.id).reduce((s, r) => s + r.pts, 0);
      const remGp = Math.max(0, gpTarget - curGp);
      let remPf = Math.max(0, (st.pf || 0) - curPf);
      for (let k = 0; k < remGp; k++) {
        const gamePts = k === remGp - 1 ? remPf : Math.max(30, Math.round(remPf / (remGp - k)));
        remPf = Math.max(0, remPf - gamePts);
        recordSimulatedTeamGame(st.id, st.name, gamePts, league);
      }
    }
  }

  function computeLeagueStatLeaders() {
    const season = getSeason();
    if (!season) return [];
    backfillTotalsFromLegacySave();
    const totals = ensureLeaguePlayerTotals();
    const standingMap = Object.fromEntries((season.standings || []).map(t => [t.id, t]));
    const uTeam = (season.standings || []).find(t => t.isUserTeam) || { id: "user", name: "我方", w: 0, l: 0 };

    // Build profile lookup so OVR & age stay live
    const bm = computeLeagueBenchmarks();
    const rows = [];
    for (const rec of Object.values(totals)) {
      if (!rec || !rec.gp) continue;
      const tmSt = standingMap[rec.teamId] || { w: 0, l: 0 };
      const tmGp = Math.max(1, (tmSt.w || 0) + (tmSt.l || 0));
      const winPct = tmGp ? (tmSt.w / tmGp) : 0.5;

      // For user, reconcile strictly with Season.seasonTotals if present
      let gp = rec.gp, pts = rec.pts, reb = rec.reb, ast = rec.ast, stl = rec.stl, blk = rec.blk;
      let ovr = rec.ovr || 70;
      if (rec.isUser && season.player && season.seasonTotals && season.seasonTotals.gp > 0) {
        gp = season.seasonTotals.gp;
        pts = season.seasonTotals.pts;
        reb = season.seasonTotals.reb;
        ast = season.seasonTotals.ast;
        stl = season.seasonTotals.stl;
        blk = season.seasonTotals.blk;
        ovr = calcOVR(season.player.stats, season.player.pos, season.equippedTraits);
      } else if (bm && Array.isArray(bm.allPlayersSorted)) {
        const matchP = bm.allPlayersSorted.find(x => x.name === rec.name);
        if (matchP && matchP.ovr) ovr = matchP.ovr;
      }

      const ppg = Number((pts / gp).toFixed(1));
      const rpg = Number((reb / gp).toFixed(1));
      const apg = Number((ast / gp).toFixed(1));
      const spg = Number((stl / gp).toFixed(1));
      const bpg = Number((blk / gp).toFixed(1));
      const mvpScore = ppg * 1.15 + rpg * 0.95 + apg * 1.35 + spg * 2.2 + bpg * 2.0 + winPct * 12;
      const dpoyScore = spg * 3.8 + bpg * 3.6 + rpg * 0.55 + ovr * 0.12 + winPct * 4;

      rows.push({
        name: rec.name, teamName: rec.teamName || uTeam.name, pos: rec.pos || "SG",
        age: rec.age || 17, ovr, isUser: Boolean(rec.isUser), gp,
        ppg, rpg, apg, spg, bpg, mvpScore, dpoyScore, winPct
      });
    }
    return rows;
  }

  function renderLeagueLeadersTab(cat = null) {
    if (cat) activeLeaderCat = cat;
    const box = document.getElementById("leagueLeadersList");
    if (!box) return;
    document.querySelectorAll("#leadersTabRow .leaders-tab-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.lcat === activeLeaderCat);
    });
    const season = getSeason();
    if (!season || (season.currentRoundIdx || 0) === 0) {
      box.innerHTML = `<div style="padding:18px 12px; text-align:center; border:2px dashed var(--ink); background:#FFFDF7; font-size:12.5px; font-weight:800; color:var(--ink-soft); line-height:1.6;">📅 新賽季尚未開打！<br/>完成第 1 輪比賽後，系統將即時統計全聯盟五大數據排行榜。</div>`;
      return;
    }
    const rows = computeLeagueStatLeaders();
    const sorted = [...rows].sort((a, b) => (b[activeLeaderCat] - a[activeLeaderCat]) || (b.ovr - a.ovr));
    const unitMap = { ppg: "PPG", rpg: "RPG", apg: "APG", spg: "SPG", bpg: "BPG" };
    const top10 = sorted.slice(0, 10);
    const userIdx = sorted.findIndex(x => x.isUser);
    const showList = [...top10];
    if (userIdx >= 10) showList.push({ ...sorted[userIdx], _actualRank: userIdx + 1 });

    box.innerHTML = showList.map((r, i) => {
      const rank = r._actualRank || (i + 1);
      return `
        <div class="leader-row ${r.isUser ? "is-user" : ""}">
          <div style="display:flex; align-items:center; gap:6px; min-width:0;">
            <span class="leader-rank">#${rank}</span>
            <div style="min-width:0;">
              <div>${playerNameLinkHtml(r.name, r.teamName)}${r.isUser ? " ★" : ""} <span class="tag">${r.pos}</span></div>
              <div style="font-size:10.5px; color:var(--ink-soft);">${r.teamName} · OVR ${r.ovr}</div>
            </div>
          </div>
          <div class="leader-val">${r[activeLeaderCat].toFixed(1)} <span style="font-size:10px; color:var(--ink-soft);">${unitMap[activeLeaderCat]}</span></div>
        </div>`;
    }).join("");
  }

  function openSeasonAwardsCeremony(onProceed) {
    const season = getSeason();
    const db = getDB();
    const modal = document.getElementById("seasonAwardsModal");
    if (!modal || !season || !db) {
      if (typeof onProceed === "function") onProceed();
      return;
    }
    awardsProceedCb = onProceed;
    const league = db.leagues.leagues.find(l => l.id === season.leagueId) || db.leagues.leagues[0];
    const rows = computeLeagueStatLeaders();
    if (!rows.length) {
      if (typeof onProceed === "function") onProceed();
      return;
    }

    const mvp = [...rows].sort((a, b) => b.mvpScore - a.mvpScore)[0];
    const dpoy = [...rows].sort((a, b) => b.dpoyScore - a.dpoyScore)[0];
    const maxRookieAge = season.leagueId === "hs_nationals" ? 15 : (season.leagueId === "ncaa_madness" ? 19 : 22);
    const rookies = rows.filter(r => r.age <= maxRookieAge);
    const roy = (rookies.length ? rookies : rows).sort((a, b) => b.mvpScore - a.mvpScore)[0];

    const ppgKing = [...rows].sort((a, b) => b.ppg - a.ppg)[0];
    const rpgKing = [...rows].sort((a, b) => b.rpg - a.rpg)[0];
    const apgKing = [...rows].sort((a, b) => b.apg - a.apg)[0];
    const spgKing = [...rows].sort((a, b) => b.spg - a.spg)[0];
    const bpgKing = [...rows].sort((a, b) => b.bpg - a.bpg)[0];

    const positions = ["PG", "SG", "SF", "PF", "C"];
    const firstTeam = positions.map(pos => {
      const pool = rows.filter(r => r.pos === pos);
      const best = (pool.length ? pool : rows).sort((a, b) => b.mvpScore - a.mvpScore)[0];
      return { pos, player: best };
    });

    const fmvpName = (season.playoffs && season.playoffs.finalsMvp && season.playoffs.finalsMvp.name) || null;
    const fmvpIsUser = Boolean(season.playoffs && season.playoffs.finalsMvp && season.playoffs.finalsMvp.isUser);

    // Record user's awards for hall of fame archive
    const userHonors = [];
    if (mvp && mvp.isUser) userHonors.push("👑 例行賽MVP");
    if (dpoy && dpoy.isUser) userHonors.push("🛡️ 最佳防守球員");
    if (roy && roy.isUser) userHonors.push("🌟 最佳新秀");
    if (ppgKing && ppgKing.isUser) userHonors.push("🔥 得分王");
    if (rpgKing && rpgKing.isUser) userHonors.push("🧲 籃板王");
    if (apgKing && apgKing.isUser) userHonors.push("🎯 助攻王");
    if (spgKing && spgKing.isUser) userHonors.push("⚡ 抄截王");
    if (bpgKing && bpgKing.isUser) userHonors.push("🧱 封阻王");
    if (firstTeam.some(x => x.player && x.player.isUser)) userHonors.push("🏅 最佳一陣");
    season._seasonAwardsHonors = userHonors;

    document.getElementById("awardsHeroSub").textContent = `第 ${season.careerYear} 季 · ${league.name} 年度頒獎典禮`;
    document.getElementById("awardsHeroUserSummary").textContent = userHonors.length
      ? `🎉 你本季斬獲榮譽：${userHonors.join(" · ")}`
      : "本季所有個人獎項與最佳一陣正式揭曉！";

    const majorCards = [
      { lbl: "👑 例行賽 MVP", w: mvp, stat: `${mvp.ppg}分 ${mvp.rpg}板 ${mvp.apg}助` },
      { lbl: "🛡️ 最佳防守 DPOY", w: dpoy, stat: `${dpoy.spg}抄 ${dpoy.bpg}帽 ${dpoy.rpg}板` },
      { lbl: "🌟 最佳新秀 ROY", w: roy, stat: `${roy.age}歲 · ${roy.ppg}分 ${roy.apg}助` },
      fmvpName
        ? { lbl: "🏆 總決賽 FMVP", w: { name: fmvpName, teamName: season.playoffs.result === "CHAMPION" ? "總冠軍" : "決賽", isUser: fmvpIsUser }, stat: "季後賽最高榮耀" }
        : { lbl: "🔥 聯賽得分王", w: ppgKing, stat: `場均 ${ppgKing.ppg} 分` }
    ];
    document.getElementById("awardsMajorGrid").innerHTML = majorCards.map(c => `
      <div class="award-card ${c.w && c.w.isUser ? "user-won" : ""}">
        <div class="award-lbl">${c.lbl}</div>
        <div class="award-winner">${playerNameLinkHtml(c.w.name, c.w.teamName)}${c.w.isUser ? " ⭐" : ""}</div>
        <div class="award-stat">${c.w.teamName} · ${c.stat}</div>
      </div>`).join("");

    const statKings = [
      { lbl: "得分王", w: ppgKing, v: `${ppgKing.ppg} PPG` },
      { lbl: "籃板王", w: rpgKing, v: `${rpgKing.rpg} RPG` },
      { lbl: "助攻王", w: apgKing, v: `${apgKing.apg} APG` },
      { lbl: "抄截王", w: spgKing, v: `${spgKing.spg} SPG` },
      { lbl: "封阻王", w: bpgKing, v: `${bpgKing.bpg} BPG` }
    ];
    document.getElementById("awardsKingsList").innerHTML = statKings.map(k => `
      <div class="leader-row ${k.w.isUser ? "is-user" : ""}" style="padding:5px 8px; font-size:11.5px;">
        <span><strong>${k.lbl}</strong>：${playerNameLinkHtml(k.w.name, k.w.teamName)}${k.w.isUser ? " ⭐" : ""} <span style="color:var(--ink-soft);">(${k.w.teamName})</span></span>
        <strong>${k.v}</strong>
      </div>`).join("");

    document.getElementById("awardsFirstTeamGrid").innerHTML = firstTeam.map(x => `
      <div class="first-team-cell ${x.player && x.player.isUser ? "user-won" : ""}">
        <div style="color:var(--crimson); font-size:10px;">${x.pos}</div>
        <div style="margin-top:2px;">${playerNameLinkHtml(x.player.name, x.player.teamName)}</div>
        <div style="font-size:9.5px; color:var(--ink-soft);">${x.player.ppg}分</div>
      </div>`).join("");

    modal.classList.remove("hidden");
  }

  /* -------------------- BIND REFACTOR EVENTS -------------------- */
  function bindRefactorEvents() {
    const bigCta = document.getElementById("btnTopBigCta");
    if (bigCta) {
      bigCta.addEventListener("click", () => {
        const mode = bigCta.dataset.ctaMode;
        if (mode === "NEW_CAREER") openCareerCreation();
        else if (mode === "NEXT_SEASON") openSeasonAwardsCeremony(() => openSeasonEndCrossroads());
        else requestStartMatchOrSim("PLAY");
      });
    }

    const utilToggle = document.getElementById("btnToggleUtilDrawer");
    const utilDrawer = document.getElementById("topUtilDrawer");
    if (utilToggle && utilDrawer) utilToggle.addEventListener("click", () => utilDrawer.classList.toggle("open"));

    const benchBtn = document.getElementById("btnToggleBenchRoster");
    if (benchBtn) {
      benchBtn.addEventListener("click", () => {
        rosterExpanded = !rosterExpanded;
        renderRosterCards(computeLeagueBenchmarks());
      });
    }

    // One-Page Hub Drill-Down Modal Launchers
    const drawerBindings = [
      ["btnOpenTrainModal", "🏋️ 本週場外養成", "每輪補滿 2 AP", "drawerSecTrain"],
      ["btnOpenStatsModal", "📊 12 項能力與技能徽章", "附聯盟對比", "drawerSecStats"],
      ["btnOpenRivalModal", "🔥 宿敵檔案與人生經歷", "自動時間軸", "drawerSecRival"],
      ["btnOpenCareerModal", "🏛️ 生涯履歷與名人堂", "IndexedDB 存檔", "drawerSecCareer"],
      ["btnOpenFullSched", "📅 本季完整賽程表", "LOD 0 逐場", "drawerSecSched"],
      ["btnOpenStandings", "🏆 本聯賽積分榜", "即時排名", "drawerSecStandings"],
      ["btnOpenLeaders", "📊 賽季各項數據榜", "五大數據領跑", "drawerSecLeaders"],
      ["btnOpenWorldLod", "🌏 海外聯賽動態", "LOD 1 背景演算", "drawerSecWorld"],
      ["btnOpenTeamOps", "🧠 教練戰術與陣容異動／補強", "化學反應與輪換", "drawerSecTeamOps"]
    ];
    for (const [btnId, title, badge, secId] of drawerBindings) {
      const el = document.getElementById(btnId);
      if (el) el.addEventListener("click", () => {
        if (secId === "drawerSecLeaders") renderLeagueLeadersTab();
        openSectionModal(title, badge, secId);
      });
    }
    const lTabRow = document.getElementById("leadersTabRow");
    if (lTabRow) {
      lTabRow.addEventListener("click", (e) => {
        const b = e.target.closest("[data-lcat]");
        if (b) renderLeagueLeadersTab(b.dataset.lcat);
      });
    }
    const awardsNextBtn = document.getElementById("btnAwardsContinue");
    if (awardsNextBtn) {
      awardsNextBtn.addEventListener("click", () => {
        document.getElementById("seasonAwardsModal").classList.add("hidden");
        const cb = awardsProceedCb;
        awardsProceedCb = null;
        if (typeof cb === "function") cb();
      });
    }

    const hdClose = document.getElementById("btnCloseHubDetailModal");
    const hdModal = document.getElementById("hubDetailModal");
    if (hdClose && hdModal) {
      hdClose.addEventListener("click", closeSectionModal);
      hdModal.addEventListener("click", (e) => { if (e.target.id === "hubDetailModal") closeSectionModal(); });
    }

    // Live Match Detailed Stats trigger
    const ldsBtn = document.getElementById("btnLiveDetailStats");
    const ldsClose = document.getElementById("btnCloseLiveDetailStats");
    const ldsBoxBtn = document.getElementById("btnLiveOpenFullBox");
    const ldsModal = document.getElementById("liveDetailStatsModal");
    if (ldsBtn) ldsBtn.addEventListener("click", openLiveDetailStats);
    if (ldsClose) ldsClose.addEventListener("click", closeLiveDetailStats);
    if (ldsModal) ldsModal.addEventListener("click", (e) => { if (e.target.id === "liveDetailStatsModal") closeLiveDetailStats(); });
    if (ldsBoxBtn) {
      ldsBoxBtn.addEventListener("click", () => {
        if (ldsModal) ldsModal.classList.add("hidden");
        const match = getMatch();
        if (match && phaseBeforeLiveDetail && match.phase === "PAUSED_MENU") {
          match.phase = sanitizeResumePhase(phaseBeforeLiveDetail);
        }
        phaseBeforeLiveDetail = null;
        openPauseCenter(false);
      });
    }

    // Box Score Full 16-col toggle
    const bsToggleBtn = document.getElementById("btnBsToggleFull");
    if (bsToggleBtn) bsToggleBtn.addEventListener("click", () => toggleBoxScoreFullMode());

    // Tap any stat row in Box Score (outside name link) -> pop out single-player detailed match stats!
    const bsBody = document.getElementById("bsRosterBody");
    if (bsBody) {
      bsBody.addEventListener("click", (e) => {
        if (e.target.closest("[data-player-name]")) return;
        const tr = e.target.closest("tr[data-bs-row-idx]");
        if (!tr) return;
        const match = getMatch();
        const src = (match && match._historyView) ? match._historyView : match;
        if (!src) return;
        const tab = (typeof activePauseTab !== "undefined") ? activePauseTab : "HOME";
        const list = tab === "HOME" ? (src.homeTeam || []) : (src.awayTeam || []);
        const pl = list[Number(tr.dataset.bsRowIdx)];
        if (!pl) return;
        const tName = tab === "HOME" ? src.homeName : src.awayName;
        openPlayerMatchStatsPopup(pl, tName, `${src.homeName} ${src.homeScore} - ${src.awayScore} ${src.awayName}`);
      });
    }

    // Global delegated click for Player Name Link, Roster Card, or Played Schedule Item
    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-skill-id]")) return;
      const nameLink = e.target.closest("[data-player-name]");
      if (nameLink) {
        e.stopPropagation();
        openPlayerCardByName(nameLink.dataset.playerName, nameLink.dataset.playerTeam || "");
        return;
      }
      const pastRow = e.target.closest("[data-past-match-idx]");
      if (pastRow) {
        openPastMatchBoxScore(Number(pastRow.dataset.pastMatchIdx));
        return;
      }
      const card = e.target.closest("[data-player-card-name]");
      if (card) openPlayerCardByName(card.dataset.playerCardName, card.dataset.playerCardTeam || "");
    });

    const pdClose = document.getElementById("btnClosePlayerDetail");
    const pdModal = document.getElementById("playerDetailModal");
    if (pdClose && pdModal) {
      pdClose.addEventListener("click", () => pdModal.classList.add("hidden"));
      pdModal.addEventListener("click", (e) => { if (e.target.id === "playerDetailModal") pdModal.classList.add("hidden"); });
    }

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
    if (pmCancel) pmCancel.addEventListener("click", () => { pendingFocusAction = null; document.getElementById("preMatchFocusModal").classList.add("hidden"); });

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

    const slotWrap = document.getElementById("titleSaveSlots");
    if (slotWrap) {
      slotWrap.addEventListener("click", async (e) => {
        const loadBtn = e.target.closest("[data-slot-load]");
        if (loadBtn) {
          const slotNum = Number(loadBtn.dataset.slotLoad);
          if (typeof window.loadCareerFromSlot === "function") {
            const ok = await window.loadCareerFromSlot(slotNum);
            if (ok) {
              document.getElementById("viewTitle").classList.remove("active");
              document.getElementById("viewHub").classList.add("active");
              switchHubTab("htab-match");
              renderHub();
              const cp = getValidMatchCheckpoint();
              if (cp) restoreMatchFromCheckpoint(cp);
            }
          }
          return;
        }
        const newBtn = e.target.closest("[data-slot-new]");
        if (newBtn) {
          const slotNum = Number(newBtn.dataset.slotNew);
          SaveManager.setActiveSlot(slotNum);
          document.getElementById("viewTitle").classList.remove("active");
          openCareerCreation();
          return;
        }
        const expBtn = e.target.closest("[data-slot-export]");
        if (expBtn) {
          const slotNum = Number(expBtn.dataset.slotExport);
          const jsonStr = await SaveManager.exportSlotJson(slotNum);
          if (!jsonStr) { showToast("此槽位無可匯出的存檔"); return; }
          const blob = new Blob([jsonStr], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = `basketball-time-slot${slotNum}.json`;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          showToast(`📤 已匯出存檔槽 ${slotNum} 備份檔案！`);
          return;
        }
        const delBtn = e.target.closest("[data-slot-delete]");
        if (delBtn) {
          const slotNum = Number(delBtn.dataset.slotDelete);
          if (window.confirm(`確定要清空【存檔槽 ${slotNum}】嗎？此操作無法復原（建議先點擊備份）。`)) {
            await SaveManager.clear(slotNum);
            await renderTitleSaveSlots();
            showToast(`🗑️ 已清空存檔槽 ${slotNum}`);
          }
        }
      });
    }

    const impBtn = document.getElementById("btnTitleImportSave");
    const impInput = document.getElementById("saveImportFileInput");
    if (impBtn && impInput) {
      impBtn.addEventListener("click", () => impInput.click());
      impInput.addEventListener("change", (e) => {
        const f = e.target.files[0]; if (!f) return;
        const rd = new FileReader();
        rd.onload = async () => {
          try {
            const slots = await SaveManager.listSlots();
            const emptySlot = slots.find(s => s.empty);
            const targetSlot = emptySlot ? emptySlot.slot : SaveManager.getActiveSlot();
            if (!emptySlot && !window.confirm(`三個存檔槽皆已使用，將覆寫【存檔槽 ${targetSlot}】，是否繼續？`)) return;
            await SaveManager.importSlotJson(targetSlot, rd.result);
            SaveManager.setActiveSlot(targetSlot);
            await renderTitleSaveSlots();
            showToast(`📥 已成功還原存檔至【存檔槽 ${targetSlot}】！`);
          } catch (err) {
            showToast(`存檔匯入失敗：${err.message}`);
          }
        };
        rd.readAsText(f); e.target.value = "";
      });
    }

    const switchSlotBtn = document.getElementById("btnSwitchSaveSlot");
    if (switchSlotBtn) {
      switchSlotBtn.addEventListener("click", async () => {
        const season = getSeason();
        if (season && season.player) await SaveManager.save(season);
        await showTitleScreen(true);
      });
    }

    const codexOpenBtn = document.getElementById("btnOpenSkillCodex");
    if (codexOpenBtn) codexOpenBtn.addEventListener("click", () => openSkillCodex("unlocks"));
    const codexCloseBtn = document.getElementById("btnCloseSkillCodex");
    if (codexCloseBtn) codexCloseBtn.addEventListener("click", () => { const m = document.getElementById("skillCodexModal"); if (m) m.classList.add("hidden"); });
    const codexTabBar = document.getElementById("codexTabBar");
    if (codexTabBar) {
      codexTabBar.addEventListener("click", (e) => {
        const b = e.target.closest("[data-codex-tab]");
        if (b) renderSkillCodexTab(b.dataset.codexTab);
      });
    }

    const osrOpenBtn = document.getElementById("btnOpenOffseasonReport");
    if (osrOpenBtn) osrOpenBtn.addEventListener("click", () => openOffseasonReport("myteam"));
    const osrCloseBtn = document.getElementById("btnCloseOffseasonReport");
    const osrConfBtn = document.getElementById("btnConfirmOffseasonReport");
    const closeOsr = () => { const m = document.getElementById("offseasonReportModal"); if (m) m.classList.add("hidden"); };
    if (osrCloseBtn) osrCloseBtn.addEventListener("click", closeOsr);
    if (osrConfBtn) osrConfBtn.addEventListener("click", closeOsr);
    const osrTabBar = document.getElementById("osrTabBar");
    if (osrTabBar) {
      osrTabBar.addEventListener("click", (e) => {
        const b = e.target.closest("[data-osr-tab]");
        if (b) renderOffseasonReportTab(b.dataset.osrTab);
      });
    }

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
        const season = getSeason();
        if (season && season.player) { season.player.tutorialDone = true; SaveManager.save(season); }
        document.getElementById("viewCreate").classList.remove("active");
        document.getElementById("viewHub").classList.add("active");
        switchHubTab("htab-match");
        renderHub();
      });
    }
  }

  return {
    computeLeagueBenchmarks,
    playerNameLinkHtml,
    openPlayerCard,
    openPlayerCardByName,
    openSectionModal,
    closeSectionModal,
    openLiveDetailStats,
    closeLiveDetailStats,
    toggleBoxScoreFullMode,
    openPlayerMatchStatsPopup,
    openPastMatchBoxScore,
    sanitizeResumePhase,
    recordMatchToLeagueTotals,
    recordSimulatedTeamGame,
    renderLeagueLeadersTab,
    openSeasonAwardsCeremony,
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
    openOffseasonReport,
    openSkillCodex,
    setCreateStep,
    launchTutorialMatch,
    handleTutorialMatchEnd,
    isTutorialActive: () => isTutorialMatch,
    resetTutorialFlag: () => { isTutorialMatch = false; },
    bindRefactorEvents
  };
})();
