(() => {
  const SUPABASE_URL = "https://vdctxgvfjfzojjdmhaqy.supabase.co";
  const SUPABASE_KEY = "sb_publishable_YSr6kFrajDqmoOHBDUt_Og_7QVrKHZE";
  const supabaseClient = window.supabase
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

  const APP_VERSION = "26.01.046"; // 格式：年.大版本.小版本 (00.00.000)
  const ADMIN_PASS_HASH = "d1aa55811ebb21d1377cfb72fab3bcf7e00d616494b0af754f56aeae4b1d6d4d";
  const GRID_COLS = 16;
  const GRID_ROWS = 16;
  const STRIP_LENGTH = 68; // 拉長轉輪長度，讓單次轉動更有情緒張力與累積感
  const MAX_CHAIN_CAP = 8; // 連線計算上限為 8 連

  // 符號設定：權重越高越常出現；baseMult 為 3 連基礎倍率，4 連以上依指數放大（上限 8 連）
  const SYMBOLS = [
    { id: "seven",   icon: "7️⃣", name: "幸運 7", weight: 2,  baseMult: 8.0 },
    { id: "diamond", icon: "💎", name: "鑽石",   weight: 4,  baseMult: 3.0 },
    { id: "bell",    icon: "🔔", name: "金鈴鐺", weight: 6,  baseMult: 1.5 },
    { id: "clover",  icon: "🍀", name: "四葉草", weight: 8,  baseMult: 0.8 },
    { id: "star",    icon: "⭐", name: "星星",   weight: 10, baseMult: 0.5 },
    { id: "cherry",  icon: "🍒", name: "櫻桃",   weight: 12,    baseMult: 0.3 },
    { id: "lemon",   icon: "🍋", name: "檸檬",   weight: 14,    baseMult: 0.2 },
    { id: "bomb",      icon: "💣", name: "炸彈",     weight: 3.5,   baseMult: 1.0, isPenalty: true },
    { id: "eightball", icon: "🎱", name: "黑八滅獎", weight: 0.025, baseMult: 0,   isVoid: true },
    { id: "mahjong",   icon: "🀄", name: "紅中",     weight: 0.025, baseMult: 0,   isSpecial: true },
    { id: "tw",        icon: "🇹🇼", name: "台灣之光", weight: 0.008, baseMult: 0,   isTopJackpot: true }
  ];

  const INITIAL_CREDITS = 2000;
  const MAX_WIN_CREDITS = 3000000000000000; // 達到 3,000,000,000,000,000 直接通關結束
  const INITIAL_ULTRA_JACKPOT = 25000;
  const MIN_BET = 5;

  const TW_FLAG_HTML = `<img class="tw-flag-img" src="Flag_of_the_Republic_of_China.svg" alt="🇹🇼" />`;

  function formatTwFlags(text) {
    return String(text).replaceAll("🇹🇼", TW_FLAG_HTML);
  }

  function renderSymbolIcon(sym) {
    if (sym.id === "tw") return TW_FLAG_HTML;
    return `<svg class="sym-svg sym-${sym.id}" viewBox="0 0 64 64" aria-hidden="true"><use href="#sym-${sym.id}"/></svg>`;
  }

  const BASE_BOMB_WEIGHT = 3.5;
  const NON_BOMB_WEIGHT = SYMBOLS
    .filter((s) => s.id !== "bomb")
    .reduce((sum, s) => sum + s.weight, 0);
  const BASE_BOMB_RATE = BASE_BOMB_WEIGHT / (NON_BOMB_WEIGHT + BASE_BOMB_WEIGHT);
  const MAX_BOMB_RATE = 0.50;
  const BOMB_CAP_CREDITS = 2000000; // 需累積至 200 萬點以上才會觸及 50% 上限

  function getDynamicBombWeight() {
    if (state.devBombShield) return 0;
    if (state.activeSpinBombWeight !== null) return state.activeSpinBombWeight;
    if (state.credits <= INITIAL_CREDITS) return BASE_BOMB_WEIGHT;
    const excess = state.credits - INITIAL_CREDITS;
    const progress = Math.min(1, Math.pow(excess / BOMB_CAP_CREDITS, 0.8));
    const targetRate = BASE_BOMB_RATE + progress * (MAX_BOMB_RATE - BASE_BOMB_RATE);
    const weight = (targetRate * NON_BOMB_WEIGHT) / (1 - targetRate);
    return +weight.toFixed(2);
  }

  function getMidgameSevenProfile() {
    const active = state.spinCount >= 8 || state.credits >= 5000;
    if (!active) {
      return {
        active: false,
        weightMult: 1,
        threeSevensChance: 0,
        fiveSevensChance: 0
      };
    }
    const spinProgress = Math.max(0, Math.min(1, (state.spinCount - 8) / 17));
    const creditProgress = Math.max(0, Math.min(1, (state.credits - 5000) / 95000));
    const intensity = Math.max(0.45, spinProgress, creditProgress);
    return {
      active: true,
      weightMult: +(1 + 1.1 * intensity).toFixed(2),
      threeSevensChance: +(0.06 + 0.06 * intensity).toFixed(4),
      fiveSevensChance: +(0.015 + 0.025 * intensity).toFixed(4)
    };
  }

  function getSymbolWeight(sym, { applySecretBurst = false } = {}) {
    let w = sym.id === "bomb" ? getDynamicBombWeight() : sym.weight;
    if (sym.id === "seven") {
      w *= getMidgameSevenProfile().weightMult;
    }
    // 連轉 ×5 模式偷偷提高炸彈與紅中出現率
    if (applySecretBurst && state.burstRemaining > 0) {
      if (sym.id === "bomb") w *= 1.65;
      if (sym.id === "mahjong") w *= 4.0;
    }
    return w;
  }

  function getBombRatePercent() {
    const bombW = getDynamicBombWeight();
    const totalW = SYMBOLS.reduce((sum, s) => sum + getSymbolWeight(s), 0);
    return ((bombW / totalW) * 100).toFixed(1);
  }

  function pickWeightedSymbol() {
    const totalWeight = SYMBOLS.reduce((sum, s) => sum + getSymbolWeight(s, { applySecretBurst: true }), 0);
    let roll = Math.random() * totalWeight;
    for (const sym of SYMBOLS) {
      roll -= getSymbolWeight(sym, { applySecretBurst: true });
      if (roll <= 0) return sym;
    }
    return SYMBOLS[SYMBOLS.length - 1];
  }

  function createRandomCol() {
    return Array.from({ length: GRID_ROWS }, () => pickWeightedSymbol());
  }

  // 全域狀態（每次開啟遊戲固定從 2,000 開始；各機台 Jackpot 獨立計算，超終極大獎全場共用）
  const state = {
    credits: INITIAL_CREDITS,
    peakCredits: INITIAL_CREDITS,
    maxSingleWin: 0,
    totalBetSpent: 0,
    totalGrossWon: 0,
    jackpotHits: 0,
    ultraHits: 0,
    mahjongHits: 0,
    eightBallHits: 0,
    isSettled: false,
    activeSpinBombWeight: null,
    currentBet: 25,
    betMode: "normal", // "normal" | "max" | "single_allin" | "second_allin" | "dual_allin"
    lastNetWin: 0,
    ultraJackpot: INITIAL_ULTRA_JACKPOT,
    spinCount: 0,
    autoSpin: false,
    autoSpinPendingDual: false,
    burstRemaining: 0,
    isBurstSession: false,
    secretTaiwanPending: false,
    secretBlackPending: false,
    secretDoubleBlackPending: false,
    secretSplitBlackPending: false,
    secretMahjongPending: false,
    secretFiveSevensPending: false,
    secretNukePending: false,
    secretStarfallPending: false,
    secretUnlimitPending: false,
    secretFullBoardSymbol: null,
    secretFullBoardRemaining: 0,
    cheatUsed: false,
    devFastSpin: false,
    devGodMode: false,
    devBombShield: false,
    devNoZeroEnd: false,
    devMobileVibrate: true,
    devMobileBigBtn: false,
    devMobileCompact: false,
    devUnlocked: false,
    soundEnabled: true,
    gamepadEnabled: true,
    gamepadRumbleEnabled: true,
    gamepadConnected: false,
    isUploadingLeaderboard: false,
    hasUploadedCurrentSettlement: false,
    adminSessionPass: null,
    adminCachedRows: []
  };

  // 動態押注限制演算法：依目前總餘額與啟用機台數動態計算可壓上限（每台最多壓單台可用額度的 25%）
  function getDynamicMaxBet(machineCount = 2) {
    if (state.credits < MIN_BET * machineCount) {
      return Math.max(1, Math.floor(state.credits / machineCount));
    }
    const perMachineBudget = state.credits / machineCount;
    const rawLimit = Math.floor((perMachineBudget * 0.25) / 5) * 5;
    return Math.max(MIN_BET, rawLimit);
  }

  function getBetStep(maxBet) {
    return Math.max(5, Math.round((maxBet * 0.1) / 5) * 5);
  }

  function clampBetValue(val, machineCount = machines.length) {
    const maxBet = getDynamicMaxBet(machineCount);
    if (!Number.isFinite(val) || val < 1) return Math.min(1, maxBet);
    return Math.min(Math.floor(val), maxBet);
  }

  function clampAllMachineBets() {
    machines.forEach((m) => {
      m.bet = clampBetValue(m.bet, machines.length);
    });
    state.currentBet = machines[0].bet;
  }

  // DOM 參照
  const dualCabinetsEl = document.getElementById("dualCabinets");
  const creditsEl = document.getElementById("creditsValue");
  const creditsSpendStackEl = document.getElementById("creditsSpendStack");
  const bombRateLabelEl = document.getElementById("bombRateLabel");
  const betEl = document.getElementById("betValue");
  const maxBetLabelEl = document.getElementById("maxBetLabel");
  const winEl = document.getElementById("winValue");
  const ultraJackpotEl = document.getElementById("ultraJackpotValue");
  const spinCountEl = document.getElementById("spinCount");
  const historyListEl = document.getElementById("historyList");

  const spinAllBtn = document.getElementById("spinAllBtn");
  const burstSpinBtn = document.getElementById("burstSpinBtn");
  const betDownBtn = document.getElementById("betDownBtn");
  const betUpBtn = document.getElementById("betUpBtn");
  const maxBetBtn = document.getElementById("maxBetBtn");
  const betModeBtns = Array.from(document.querySelectorAll("[data-bet-mode]"));
  const autoMachineABtn = document.getElementById("autoMachineABtn");
  const autoMachineBBtn = document.getElementById("autoMachineBBtn");
  const autoSpinBtn = document.getElementById("autoSpinBtn");

  const paytableModal = document.getElementById("paytableModal");
  const closePaytableBtn = document.getElementById("closePaytableBtn");
  const paytableBody = document.getElementById("paytableBody");

  const startScreen = document.getElementById("startScreen");
  const resumeGameBtn = document.getElementById("resumeGameBtn");
  const startTutorialBtn = document.getElementById("startTutorialBtn");
  const startGameBtn = document.getElementById("startGameBtn");
  const gameOverScreen = document.getElementById("gameOverScreen");
  const gameOverStats = document.getElementById("gameOverStats");
  const gameOverShareXBtn = document.getElementById("gameOverShareXBtn");
  const gameOverShareThreadsBtn = document.getElementById("gameOverShareThreadsBtn");
  const gameOverShareOtherBtn = document.getElementById("gameOverShareOtherBtn");
  const gameOverDisableDevRestartBtn = document.getElementById("gameOverDisableDevRestartBtn");
  const gameOverRestartBtn = document.getElementById("gameOverRestartBtn");
  const gameOverHomeBtn = document.getElementById("gameOverHomeBtn");

  const menuBtn = document.getElementById("menuBtn");
  const gameMenu = document.getElementById("gameMenu");
  const menuSettleBtn = document.getElementById("menuSettleBtn");
  const menuRestartBtn = document.getElementById("menuRestartBtn");
  const menuHomeBtn = document.getElementById("menuHomeBtn");
  const menuPaytableBtn = document.getElementById("menuPaytableBtn");
  const menuTutorialBtn = document.getElementById("menuTutorialBtn");
  const menuLeaderboardBtn = document.getElementById("menuLeaderboardBtn");
  const menuSettingsBtn = document.getElementById("menuSettingsBtn");
  const menuChangelogBtn = document.getElementById("menuChangelogBtn");
  const menuDisableDevRestartBtn = document.getElementById("menuDisableDevRestartBtn");
  const menuSecretCodeBtn = document.getElementById("menuSecretCodeBtn");
  const mobileFullscreenBtn = document.getElementById("mobileFullscreenBtn");
  const devPanelBtn = document.getElementById("devPanelBtn");
  const gamepadStatusBtn = document.getElementById("gamepadStatusBtn");
  const gamepadModal = document.getElementById("gamepadModal");
  const closeGamepadModalBtn = document.getElementById("closeGamepadModalBtn");
  const gamepadModalStatus = document.getElementById("gamepadModalStatus");
  const gamepadToggleBtn = document.getElementById("gamepadToggleBtn");
  const gamepadTestRumbleBtn = document.getElementById("gamepadTestRumbleBtn");
  const settingsModal = document.getElementById("settingsModal");
  const closeSettingsModalBtn = document.getElementById("closeSettingsModalBtn");
  const settingSoundBtn = document.getElementById("settingSoundBtn");
  const settingMobileVibrateBtn = document.getElementById("settingMobileVibrateBtn");
  const settingGamepadRumbleBtn = document.getElementById("settingGamepadRumbleBtn");
  const settingGamepadInputBtn = document.getElementById("settingGamepadInputBtn");
  const tutorialModal = document.getElementById("tutorialModal");
  const closeTutorialBtn = document.getElementById("closeTutorialBtn");
  const tutorialStepBadge = document.getElementById("tutorialStepBadge");
  const tutorialDeviceBadge = document.getElementById("tutorialDeviceBadge");
  const tutorialBody = document.getElementById("tutorialBody");
  const tutorialDots = document.getElementById("tutorialDots");
  const tutorialPrevBtn = document.getElementById("tutorialPrevBtn");
  const tutorialNextBtn = document.getElementById("tutorialNextBtn");

  const changelogModal = document.getElementById("changelogModal");
  const closeChangelogBtn = document.getElementById("closeChangelogBtn");
  const changelogList = document.getElementById("changelogList");
  const startLatestUpdates = document.getElementById("startLatestUpdates");

  const mobileCodeModal = document.getElementById("mobileCodeModal");
  const closeMobileCodeBtn = document.getElementById("closeMobileCodeBtn");
  const mobileCodeInput = document.getElementById("mobileCodeInput");
  const mobileCodeSubmitBtn = document.getElementById("mobileCodeSubmitBtn");
  const mobileCodeFeedback = document.getElementById("mobileCodeFeedback");

  const devMobileBigBtn = document.getElementById("devMobileBigBtn");
  const devMobileCompactBtn = document.getElementById("devMobileCompactBtn");

  const settlementScreen = document.getElementById("settlementScreen");
  const settleTitle = document.getElementById("settleTitle");
  const settleStatsGrid = document.getElementById("settleStatsGrid");
  const downloadSettleImgBtn = document.getElementById("downloadSettleImgBtn");
  const settleShareXBtn = document.getElementById("shareXBtn");
  const settleShareThreadsBtn = document.getElementById("shareThreadsBtn");
  const shareSettleBtn = document.getElementById("shareSettleBtn");
  const settleDisableDevRestartBtn = document.getElementById("settleDisableDevRestartBtn");
  const settleRestartBtn = document.getElementById("settleRestartBtn");
  const startLeaderboardList = document.getElementById("startLeaderboardList");
  const startLeaderboardRefreshBtn = document.getElementById("startLeaderboardRefreshBtn");
  const settleLeaderboardList = document.getElementById("settleLeaderboardList");
  const settleLeaderboardRefreshBtn = document.getElementById("settleLeaderboardRefreshBtn");
  const leaderboardModal = document.getElementById("leaderboardModal");
  const closeLeaderboardModalBtn = document.getElementById("closeLeaderboardModalBtn");
  const modalLeaderboardRefreshBtn = document.getElementById("modalLeaderboardRefreshBtn");
  const modalLeaderboardList = document.getElementById("modalLeaderboardList");
  const leaderboardUploadBox = document.getElementById("leaderboardUploadBox");
  const leaderboardNameInput = document.getElementById("leaderboardNameInput");
  const leaderboardSubmitBtn = document.getElementById("leaderboardSubmitBtn");
  const leaderboardSubmitFeedback = document.getElementById("leaderboardSubmitFeedback");

  const devPanelModal = document.getElementById("devPanelModal");
  const closeDevPanelBtn = document.getElementById("closeDevPanelBtn");
  const devStatsBox = document.getElementById("devStatsBox");
  const devRefreshStatsBtn = document.getElementById("devRefreshStatsBtn");
  const devOpenAdminBtn = document.getElementById("devOpenAdminBtn");
  const adminModal = document.getElementById("adminModal");
  const closeAdminModalBtn = document.getElementById("closeAdminModalBtn");
  const adminLoginView = document.getElementById("adminLoginView");
  const adminDashboardView = document.getElementById("adminDashboardView");
  const adminPasswordInput = document.getElementById("adminPasswordInput");
  const adminLoginBtn = document.getElementById("adminLoginBtn");
  const adminLoginFeedback = document.getElementById("adminLoginFeedback");
  const adminLogoutBtn = document.getElementById("adminLogoutBtn");
  const adminSummaryBox = document.getElementById("adminSummaryBox");
  const adminRefreshBtn = document.getElementById("adminRefreshBtn");
  const adminAddRowBtn = document.getElementById("adminAddRowBtn");
  const adminExportCsvBtn = document.getElementById("adminExportCsvBtn");
  const adminActionFeedback = document.getElementById("adminActionFeedback");
  const adminLeaderboardList = document.getElementById("adminLeaderboardList");
  const devCustomCreditsInput = document.getElementById("devCustomCreditsInput");
  const devAddCustomBtn = document.getElementById("devAddCustomBtn");
  const devAdd10kBtn = document.getElementById("devAdd10kBtn");
  const devAdd100kBtn = document.getElementById("devAdd100kBtn");
  const devReset2kBtn = document.getElementById("devReset2kBtn");
  const devSet1Btn = document.getElementById("devSet1Btn");
  const devBoostUltraBtn = document.getElementById("devBoostUltraBtn");
  const devBoostMachinesBtn = document.getElementById("devBoostMachinesBtn");
  const devFastSpinBtn = document.getElementById("devFastSpinBtn");
  const devGodModeBtn = document.getElementById("devGodModeBtn");
  const devBombShieldBtn = document.getElementById("devBombShieldBtn");
  const devNoZeroEndBtn = document.getElementById("devNoZeroEndBtn");
  const devForceUnlimitBtn = document.getElementById("devForceUnlimitBtn");
  const devForceSplitBlackBtn = document.getElementById("devForceSplitBlackBtn");
  const devForceDoubleBlackBtn = document.getElementById("devForceDoubleBlackBtn");
  const devFullSymbolSelect = document.getElementById("devFullSymbolSelect");
  const devForceFullSymbolBtn = document.getElementById("devForceFullSymbolBtn");
  const devForceFiveFullSymbolBtn = document.getElementById("devForceFiveFullSymbolBtn");
  const devClearPendingBtn = document.getElementById("devClearPendingBtn");
  const devCodesList = document.getElementById("devCodesList");

  // Web Audio API 簡易合成音效
  let audioCtx = null;
  function playTone(freq, duration = 0.08, type = "triangle", volume = 0.08, delay = 0) {
    if (!state.soundEnabled) return;
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    const now = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  let spinAudioTimer = null;
  let spinTickStep = 0;

  function startSpinLoopSound() {
    stopSpinLoopSound();
    playTone(220, 0.07, "sawtooth", 0.045, 0);
    spinAudioTimer = setInterval(() => {
      if (!state.soundEnabled) return;
      const freq = 185 + (spinTickStep % 4) * 26;
      spinTickStep += 1;
      playTone(freq, 0.035, "triangle", 0.03, 0);
    }, 75);
  }

  function stopSpinLoopSound() {
    if (spinAudioTimer) {
      clearInterval(spinAudioTimer);
      spinAudioTimer = null;
    }
  }

  const CONNECT_STEP_MS = 40;
  const CONNECT_MAX_DELAY_MS = 1100;

  function getConnectStepMs(cellCount) {
    if (cellCount <= 1) return CONNECT_STEP_MS;
    if (cellCount >= 200) return 10;
    return Math.min(CONNECT_STEP_MS, Math.max(10, Math.floor(CONNECT_MAX_DELAY_MS / cellCount)));
  }

  function playConnectDaDaDaSound(cellCount) {
    if (!state.soundEnabled || cellCount <= 0) return;
    const stepMs = getConnectStepMs(cellCount);
    const ticks = Math.min(cellCount, 36);
    for (let i = 0; i < ticks; i++) {
      const delaySec = (i * stepMs) / 1000;
      const freq = 640 + Math.min(i, 18) * 22;
      playTone(freq, 0.038, "triangle", 0.065, delaySec);
    }
    // 全盤 256 格滿盤連線時額外合併高音階和弦音效
    if (cellCount >= 200) {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((chordFreq, idx) => {
        playTone(chordFreq, 0.45, "triangle", 0.06, 0.08 + idx * 0.03);
      });
    }
  }

  function playStopSound(reelIndex) {
    if (!state.soundEnabled) return;
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    // 明顯的低頻機械頓點（頻率快速下墜 + 清晰卡榫聲）
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(145 + (reelIndex % 4) * 12, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.075);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.09);

    playTone(320 + reelIndex * 14, 0.025, "square", 0.022, 0);
  }

  function playWinSound(isJackpot) {
    const notes = isJackpot ? [523, 659, 784, 1046, 1318, 1568] : [523, 659, 784, 1046];
    notes.forEach((n, idx) => playTone(n, 0.18, "triangle", 0.08, idx * 0.08));
  }

  function playBombSound() {
    playTone(150, 0.18, "sawtooth", 0.1, 0);
    playTone(95, 0.25, "square", 0.09, 0.08);
  }

  function playEightBallDropSound() {
    playTone(130, 0.22, "triangle", 0.12, 0.18);
    playTone(72, 0.32, "sine", 0.14, 0.22);
  }

  function playSpecialSound() {
    [587, 740, 880, 1175, 1480].forEach((n, idx) => {
      playTone(n, 0.2, "triangle", 0.09, idx * 0.07);
    });
  }

  // 沿著單一方向 (dc, dr) 掃描連續 3 顆以上的符號
  function scanLine(cols, startC, startR, dc, dr, bet, acc, chainCap = MAX_CHAIN_CAP) {
    let c = startC;
    let r = startR;

    while (c >= 0 && c < GRID_COLS && r >= 0 && r < GRID_ROWS) {
      const sym = cols[c][r];
      let runLen = 1;
      let nc = c + dc;
      let nr = r + dr;

      while (
        nc >= 0 && nc < GRID_COLS &&
        nr >= 0 && nr < GRID_ROWS &&
        cols[nc][nr].id === sym.id
      ) {
        runLen += 1;
        nc += dc;
        nr += dr;
      }

      if (runLen >= 3) {
        const cappedRun = Math.min(runLen, chainCap);
        const mult = sym.baseMult * Math.pow(2, cappedRun - 3);
        const rawAmount = Math.round(bet * mult);
        const amount = Math.min(
          Number.MAX_SAFE_INTEGER,
          Math.max(1, Number.isFinite(rawAmount) ? rawAmount : Number.MAX_SAFE_INTEGER)
        );

        if (sym.isPenalty) {
          acc.bombCount += 1;
          acc.penalty = Math.min(Number.MAX_SAFE_INTEGER, acc.penalty + amount);
          for (let k = 0; k < runLen; k++) {
            const key = `${c + dc * k}-${r + dr * k}`;
            if (!acc.bombCells.has(key)) {
              acc.bombCells.set(key, acc.bombOrder++);
            }
          }
        } else {
          acc.lineCount += 1;
          acc.grossWin = Math.min(Number.MAX_SAFE_INTEGER, acc.grossWin + amount);
          for (let k = 0; k < runLen; k++) {
            const key = `${c + dc * k}-${r + dr * k}`;
            if (!acc.winCells.has(key)) {
              acc.winCells.set(key, acc.winOrder++);
            }
          }
          if (sym.id === "seven" && cappedRun >= 5) {
            acc.isJackpot = true;
            acc.jackpotTriggers += 1;
          }
          if (!acc.bestCombo || amount > acc.bestCombo.amount) {
            acc.bestCombo = { sym, runLen: cappedRun, amount };
          }
        }
      }

      c = nc;
      r = nr;
    }
  }

  // 檢查某條線上是否有 5 連以上的 7️⃣
  function lineHasFiveSevens(cols, startC, startR, dc, dr) {
    let c = startC;
    let r = startR;
    let streak = 0;
    while (c >= 0 && c < GRID_COLS && r >= 0 && r < GRID_ROWS) {
      if (cols[c][r].id === "seven") {
        streak += 1;
        if (streak >= 5) return true;
      } else {
        streak = 0;
      }
      c += dc;
      r += dr;
    }
    return false;
  }

  function hasFiveSevens(cols) {
    for (let r = 0; r < GRID_ROWS; r++) if (lineHasFiveSevens(cols, 0, r, 1, 0)) return true;
    for (let c = 0; c < GRID_COLS; c++) if (lineHasFiveSevens(cols, c, 0, 0, 1)) return true;
    for (let c = 0; c < GRID_COLS; c++) if (lineHasFiveSevens(cols, c, 0, 1, 1)) return true;
    for (let r = 1; r < GRID_ROWS; r++) if (lineHasFiveSevens(cols, 0, r, 1, 1)) return true;
    for (let c = 0; c < GRID_COLS; c++) if (lineHasFiveSevens(cols, c, 0, -1, 1)) return true;
    for (let r = 1; r < GRID_ROWS; r++) if (lineHasFiveSevens(cols, GRID_COLS - 1, r, -1, 1)) return true;
    return false;
  }

  function countTw(cols) {
    let count = 0;
    for (let c = 0; c < GRID_COLS; c++) {
      for (let r = 0; r < GRID_ROWS; r++) {
        if (cols[c][r].id === "tw") count += 1;
      }
    }
    return count;
  }

  function replaceExtraTw(cols, maxAllowedTw) {
    const fallbackSym = SYMBOLS.find((s) => s.id === "star");
    let seen = 0;
    for (let c = 0; c < GRID_COLS; c++) {
      for (let r = 0; r < GRID_ROWS; r++) {
        if (cols[c][r].id === "tw") {
          seen += 1;
          if (seen > maxAllowedTw) cols[c][r] = fallbackSym;
        }
      }
    }
  }

  function hasAdjacentTwPair(twPositions) {
    for (let i = 0; i < twPositions.length; i++) {
      for (let j = i + 1; j < twPositions.length; j++) {
        const [c1, r1] = twPositions[i];
        const [c2, r2] = twPositions[j];
        if (Math.abs(c1 - c2) <= 1 && Math.abs(r1 - r2) <= 1) {
          return true;
        }
      }
    }
    return false;
  }

  const FULL_BOARD_ALLOWED_SYMBOLS = SYMBOLS.filter((s) => s.id !== "tw" && s.id !== "mahjong");
  const SECRET_MIRACLE_CHANCE = 0.0008; // 0.08% 超級稀有秘密全盤同一符號（除 🇹🇼 與 🀄）

  function pickSecretFullBoardSymbol(requestedId = "random") {
    if (requestedId && requestedId !== "random") {
      const exact = FULL_BOARD_ALLOWED_SYMBOLS.find((s) => s.id === requestedId);
      if (exact) return exact;
    }
    const pool = FULL_BOARD_ALLOWED_SYMBOLS.map((s) => {
      let w = s.weight;
      if (s.id === "eightball") w = 0.05;
      if (s.id === "bomb") w = 0.35;
      return { sym: s, w };
    });
    const total = pool.reduce((sum, item) => sum + item.w, 0);
    let roll = Math.random() * total;
    for (const item of pool) {
      roll -= item.w;
      if (roll <= 0) return item.sym;
    }
    return pool[0].sym;
  }

  function placeSevenLine(cols, len) {
    const sevenSym = SYMBOLS.find((s) => s.id === "seven");
    const dirs = [
      [1, 0],
      [0, 1],
      [1, 1],
      [-1, 1]
    ];
    for (let attempt = 0; attempt < 24; attempt++) {
      const [dc, dr] = dirs[Math.floor(Math.random() * dirs.length)];
      const minC = dc < 0 ? len - 1 : 0;
      const maxC = dc > 0 ? GRID_COLS - len : GRID_COLS - 1;
      const maxR = dr > 0 ? GRID_ROWS - len : GRID_ROWS - 1;
      const startC = minC + Math.floor(Math.random() * (maxC - minC + 1));
      const startR = Math.floor(Math.random() * (maxR + 1));

      let blocked = false;
      for (let k = 0; k < len; k++) {
        const cell = cols[startC + dc * k][startR + dr * k];
        if (cell.id === "tw" || cell.id === "eightball" || cell.id === "mahjong") {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      for (let k = 0; k < len; k++) {
        cols[startC + dc * k][startR + dr * k] = sevenSym;
      }
      return true;
    }
    return false;
  }

  // 確保 🇹🇼 與 5 連 7️⃣ 絕對不會同時出現於同一盤面，且單台最多 3 顆 🇹🇼
  function enforceExclusiveJackpot(cols, maxTwOnBoard = 3) {
    let hasTw = countTw(cols) > 0;
    if (!hasTw) return cols;

    if (hasFiveSevens(cols)) {
      replaceExtraTw(cols, 0);
      return cols;
    }

    replaceExtraTw(cols, maxTwOnBoard);
    return cols;
  }

  function evaluateGrid(cols, bet, machineJackpot, chainCap = MAX_CHAIN_CAP, machineInitialJackpot = 7770) {
    const acc = {
      grossWin: 0,
      penalty: 0,
      isJackpot: false,
      jackpotTriggers: 0,
      isUltraJackpot: false,
      voidedByEightBall: false,
      leaveOneCredit: false,
      instantGameOver: false,
      eightBallCount: 0,
      twCount: 0,
      lineCount: 0,
      bombCount: 0,
      mahjongCount: 0,
      mahjongBonus: 0,
      bestCombo: null,
      winOrder: 0,
      bombOrder: 0,
      winCells: new Map(),
      bombCells: new Map(),
      specialCells: new Set(),
      voidCells: new Set()
    };

    // 先檢查盤面上是否出現 🎱（1 顆歸零、2 顆分開留 1 元、2 顆相連即死）、🇹🇼 與 🀄
    const bonusPerMahjong = Math.max(1000, getDynamicMaxBet(machines.length));
    const twPositions = [];
    const eightPositions = [];
    for (let c = 0; c < GRID_COLS; c++) {
      for (let r = 0; r < GRID_ROWS; r++) {
        const cellSym = cols[c][r];
        if (cellSym.id === "eightball") {
          acc.eightBallCount += 1;
          eightPositions.push([c, r]);
          acc.voidCells.add(`${c}-${r}`);
        } else if (cellSym.id === "mahjong") {
          acc.mahjongCount += 1;
          acc.mahjongBonus += bonusPerMahjong;
          acc.specialCells.add(`${c}-${r}`);
        } else if (cellSym.id === "tw") {
          twPositions.push([c, r]);
          acc.twCount += 1;
          acc.isJackpot = true;
          acc.specialCells.add(`${c}-${r}`);
        }
      }
    }

    const twAdjacent = hasAdjacentTwPair(twPositions);
    if (acc.twCount >= 2 && twAdjacent) {
      acc.isUltraJackpot = true;
    }
    acc.grossWin += acc.mahjongBonus;

    for (let r = 0; r < GRID_ROWS; r++) scanLine(cols, 0, r, 1, 0, bet, acc, chainCap);
    for (let c = 0; c < GRID_COLS; c++) scanLine(cols, c, 0, 0, 1, bet, acc, chainCap);
    for (let c = 0; c < GRID_COLS; c++) scanLine(cols, c, 0, 1, 1, bet, acc, chainCap);
    for (let r = 1; r < GRID_ROWS; r++) scanLine(cols, 0, r, 1, 1, bet, acc, chainCap);
    for (let c = 0; c < GRID_COLS; c++) scanLine(cols, c, 0, -1, 1, bet, acc, chainCap);
    for (let r = 1; r < GRID_ROWS; r++) scanLine(cols, GRID_COLS - 1, r, -1, 1, bet, acc, chainCap);

    // 計算 🇹🇼 獎金：
    // 1 顆 = GRAND；2 顆分開 = GRAND + 10%；2 顆相連 = ULTRA GRAND；3 顆以上（不論是否相連）再加 GRAND 的 50%
    let twPayout = 0;
    if (acc.twCount === 1) {
      twPayout = machineJackpot;
    } else if (acc.twCount === 2) {
      twPayout = twAdjacent ? state.ultraJackpot : Math.round(machineJackpot * 1.1);
    } else if (acc.twCount >= 3) {
      const baseTw = twAdjacent ? state.ultraJackpot : Math.round(machineJackpot * 1.1);
      twPayout = baseTw + Math.round(machineJackpot * 0.5);
    }

    if (acc.twCount > 0) {
      acc.grossWin = Math.max(acc.grossWin, twPayout);
    } else if (acc.isJackpot) {
      const repeatCount = Math.max(0, acc.jackpotTriggers - 1);
      const totalJackpotPayout = Math.min(Number.MAX_SAFE_INTEGER, machineJackpot + repeatCount * machineInitialJackpot);
      acc.grossWin = Math.max(acc.grossWin, totalJackpotPayout);
    }

    // 炸彈只會扣除本局賺到的獎金，不會倒扣玩家持有的本金；若開啟炸彈護盾則免疫炸彈扣分
    if (state.devBombShield) {
      acc.penalty = 0;
    }
    let netResult = Math.max(0, acc.grossWin - acc.penalty);
    if (acc.eightBallCount > 0 && !state.devGodMode) {
      acc.voidedByEightBall = true;
      const eightAdjacent = acc.eightBallCount >= 2 && hasAdjacentTwPair(eightPositions);
      acc.instantGameOver = eightAdjacent;
      acc.leaveOneCredit = acc.eightBallCount >= 2 && !eightAdjacent;
      acc.isJackpot = false;
      acc.isUltraJackpot = false;
      acc.winCells.clear();
      acc.specialCells.clear();
      netResult = 0;
    }

    let label = "再接再厲，下一轉會更好！";
    let mode = "normal";

    if (acc.instantGameOver) {
      label = `🎱🎱 雙黑八相連！直接判定遊戲結束！`;
      mode = "penalty";
    } else if (acc.leaveOneCredit) {
      label = `🎱 雙黑八分開降臨！餘額僅留最後 1 元！`;
      mode = "penalty";
    } else if (acc.voidedByEightBall) {
      label = `🎱 黑八降臨 ×${acc.eightBallCount}！失去本局所有獎金（獎池與餘額保留）`;
      mode = "penalty";
    } else if (acc.isUltraJackpot) {
      const extraText = acc.twCount >= 3 ? ` + GRAND 50%` : "";
      label = `👑 超終極大獎 ULTRA JACKPOT！相連 🇹🇼 奪得 ${twPayout.toLocaleString()}${extraText}`;
      if (acc.mahjongBonus > 0) label += `｜🀄 +${acc.mahjongBonus.toLocaleString()}`;
      if (acc.penalty > 0) label += `（💣 −${acc.penalty.toLocaleString()}）`;
      mode = "jackpot";
    } else if (acc.twCount >= 2) {
      const extraText = acc.twCount >= 3 ? ` + 50%` : "";
      label = `🇹🇼 分開 ${acc.twCount} 顆！中 GRAND+10%${extraText}（${twPayout.toLocaleString()}）`;
      if (acc.mahjongBonus > 0) label += `｜🀄 +${acc.mahjongBonus.toLocaleString()}`;
      if (acc.penalty > 0) label += `（💣 −${acc.penalty.toLocaleString()}）`;
      mode = "jackpot";
    } else if (acc.twCount === 1) {
      label = `🇹🇼 台灣之光！直中本台 GRAND JACKPOT（${machineJackpot.toLocaleString()}）`;
      if (acc.mahjongBonus > 0) label += `｜🀄 +${acc.mahjongBonus.toLocaleString()}`;
      if (acc.penalty > 0) label += `（💣 −${acc.penalty.toLocaleString()}）`;
      mode = "jackpot";
    } else if (acc.isJackpot) {
      const repeatCount = Math.max(0, acc.jackpotTriggers - 1);
      label = `🎉 GRAND JACKPOT！${acc.bestCombo.runLen} 連 ${acc.bestCombo.sym.name}`;
      if (repeatCount > 0) label += `（重複 ×${repeatCount} 各補初始 ${machineInitialJackpot.toLocaleString()}）`;
      if (acc.mahjongBonus > 0) label += `｜🀄 紅中送 ${acc.mahjongBonus.toLocaleString()}`;
      if (acc.penalty > 0) label += `（💣 −${acc.penalty.toLocaleString()}）`;
      mode = "jackpot";
    } else if (acc.mahjongCount > 0) {
      label = `🀄 紅中降臨 ×${acc.mahjongCount}！動態贈送 +${acc.mahjongBonus.toLocaleString()}`;
      if (acc.lineCount > 0) label += `｜連線 ${acc.lineCount} 條`;
      if (acc.penalty > 0) label += `｜💣 −${acc.penalty.toLocaleString()}`;
      mode = "jackpot";
    } else if (acc.bombCount > 0 && netResult === 0) {
      label = `💣 炸彈連環爆（${acc.bombCount} 條）！獎金已被抵銷（不扣本金）`;
      mode = "penalty";
    } else if (acc.lineCount > 0) {
      label = `✨ 命中 ${acc.lineCount} 條（最佳 ${acc.bestCombo.runLen} 連 ${acc.bestCombo.sym.name}）`;
      if (acc.penalty > 0) label += `｜💣 −${acc.penalty.toLocaleString()}`;
      mode = netResult > 0 ? "win" : "penalty";
    }

    return { ...acc, netResult, label, mode };
  }

  // 建立單一 16×16 機台實例（各自擁有獨立的 GRAND JACKPOT）
  function createMachine(id, title, initialJackpot = 7770, externalAutoBtn = null) {
    const section = document.createElement("section");
    section.className = "cabinet";
    section.innerHTML = `
      <div class="cabinet-head">
        <span class="cabinet-title">${title}</span>
        <div class="cabinet-actions">
          <span class="machine-jackpot" title="本台獨立 GRAND JACKPOT">🏆 ${initialJackpot.toLocaleString()}</span>
          <button class="mini-spin-btn" type="button">單台轉動</button>
          <button class="mini-allin-btn" type="button" title="將目前全部本金單押此台">ALL IN</button>
        </div>
      </div>
      <div class="machine-bet-bar">
        <span class="machine-bet-label">本台押注</span>
        <div class="machine-bet-controls">
          <button class="machine-bet-step" data-dir="-1" type="button" aria-label="減少本台押注">−</button>
          <input class="machine-bet-input" type="number" min="1" step="1" value="25" aria-label="${title} 押注金額" />
          <button class="machine-bet-step" data-dir="1" type="button" aria-label="增加本台押注">+</button>
        </div>
      </div>
      <div class="reel-stage">
        <div class="reels-grid" aria-label="${title} 16x16 轉輪"></div>
        <div class="glass-glare" aria-hidden="true"></div>
        <div class="eightball-drop-layer" aria-hidden="true"></div>
      </div>
      <div class="status-banner" role="status" aria-live="polite">準備就緒！</div>
    `;
    dualCabinetsEl.appendChild(section);

    const gridEl = section.querySelector(".reels-grid");
    const statusEl = section.querySelector(".status-banner");
    const miniSpinBtn = section.querySelector(".mini-spin-btn");
    const miniAllInBtn = section.querySelector(".mini-allin-btn");
    const betInputEl = section.querySelector(".machine-bet-input");
    const betMinusBtn = section.querySelector('[data-dir="-1"]');
    const betPlusBtn = section.querySelector('[data-dir="1"]');
    const miniAutoBtn = externalAutoBtn;
    const jackpotBadgeEl = section.querySelector(".machine-jackpot");
    const eightBallLayerEl = section.querySelector(".eightball-drop-layer");

    const reelWindows = [];
    const reelStrips = [];
    for (let c = 0; c < GRID_COLS; c++) {
      const winBox = document.createElement("div");
      winBox.className = "reel-window";
      const strip = document.createElement("div");
      strip.className = "reel-strip";
      winBox.appendChild(strip);
      gridEl.appendChild(winBox);
      reelWindows.push(winBox);
      reelStrips.push(strip);
    }

    const machine = {
      id,
      title,
      section,
      statusEl,
      miniSpinBtn,
      miniAllInBtn,
      miniAutoBtn,
      betInputEl,
      betMinusBtn,
      betPlusBtn,
      jackpotBadgeEl,
      initialJackpot,
      jackpot: initialJackpot,
      bet: 25,
      isSpinning: false,
      autoSpin: false,
      autoTimer: null,
      currentCols: Array.from({ length: GRID_COLS }, () => createRandomCol()),

      updateJackpotUI() {
        jackpotBadgeEl.textContent = `🏆 ${machine.jackpot.toLocaleString()}`;
      },

      setStatus(msg, mode = "normal") {
        statusEl.innerHTML = formatTwFlags(msg);
        statusEl.className = "status-banner";
        if (mode !== "normal") statusEl.classList.add(mode);
      },

      renderStatic(winCells = new Map(), bombCells = new Map(), specialCells = new Set(), voidCells = new Set()) {
        const winStep = getConnectStepMs(winCells.size);
        const bombStep = getConnectStepMs(bombCells.size);
        reelStrips.forEach((strip, colIdx) => {
          strip.style.transition = "none";
          strip.style.transform = "translate3d(0, 0, 0)";
          strip.innerHTML = machine.currentCols[colIdx]
            .map((sym, rowIdx) => {
              const key = `${colIdx}-${rowIdx}`;
              let cls = "";
              let styleAttr = "";
              if (voidCells.has(key)) {
                cls = " void-cell";
              } else if (specialCells.has(key)) {
                cls = " special-cell";
              } else if (bombCells.has(key)) {
                cls = " bomb-cell";
                const delay = bombCells.get(key) * bombStep;
                styleAttr = ` style="--pop-delay: ${delay}ms"`;
              } else if (winCells.has(key)) {
                cls = " win-cell";
                const delay = winCells.get(key) * winStep;
                styleAttr = ` style="--pop-delay: ${delay}ms"`;
              }
              return `<div class="symbol-cell${cls}"${styleAttr}>${renderSymbolIcon(sym)}</div>`;
            })
            .join("");
        });
      },

      spinOne(bet, staggerOffsetMs = 0, prebuiltCols = null, chainCap = MAX_CHAIN_CAP) {
        if (machine.isSpinning) return Promise.resolve(null);

        machine.isSpinning = true;
        machine.jackpot += Math.max(5, Math.round(bet * 0.25));
        machine.updateJackpotUI();
        section.classList.add("spinning-active");
        machine.setStatus("高速累積轉動中... 等待開獎！");

        const nextCols = prebuiltCols || enforceExclusiveJackpot(
          Array.from({ length: GRID_COLS }, () => createRandomCol())
        );
        const firstCell = reelStrips[0].querySelector(".symbol-cell");
        const symbolH = firstCell ? firstCell.offsetHeight : 23;
        const fillerCount = STRIP_LENGTH - GRID_ROWS * 2;

        const animPromises = Array.from({ length: GRID_COLS }, (_, colIdx) => {
          return new Promise((resolve) => {
            // 拉長轉動時間並逐軸累積節奏（約 1.6s ~ 4.4s）；極速模式則壓縮至 0.25s ~ 0.55s
            const duration = state.devFastSpin
              ? 240 + colIdx * 20
              : 1600 + colIdx * 175 + staggerOffsetMs;
            const strip = reelStrips[colIdx];
            const winBox = reelWindows[colIdx];

            const items = [...machine.currentCols[colIdx]];
            for (let i = 0; i < fillerCount; i++) {
              items.push(pickWeightedSymbol());
            }
            items.push(...nextCols[colIdx]);

            strip.style.transition = "none";
            strip.style.transform = "translate3d(0, 0, 0)";
            strip.innerHTML = items.map((s) => `<div class="symbol-cell">${renderSymbolIcon(s)}</div>`).join("");
            void strip.offsetHeight;

            winBox.classList.add("spinning");
            const targetY = -((items.length - GRID_ROWS) * symbolH);
            strip.style.transition = `transform ${duration}ms cubic-bezier(0.12, 0.92, 0.24, 1.06)`;
            strip.style.transform = `translate3d(0, ${targetY}px, 0)`;

            setTimeout(() => {
              winBox.classList.remove("spinning");
              winBox.classList.remove("reel-thud");
              void winBox.offsetWidth;
              winBox.classList.add("reel-thud");
              playStopSound(colIdx);
              triggerReelStopHaptic(colIdx);
              resolve();
            }, duration);
          });
        });

        return Promise.all(animPromises).then(() => {
          machine.currentCols = nextCols;
          const result = evaluateGrid(nextCols, bet, machine.jackpot, chainCap, machine.initialJackpot);
          machine.renderStatic(result.winCells, result.bombCells, result.specialCells, result.voidCells);

          // 畫面色塊跳出與「答答答」連線音效完全同步觸發
          if (result.winCells.size > 0) {
            playConnectDaDaDaSound(result.winCells.size);
          }
          if (result.voidedByEightBall) {
            eightBallLayerEl.innerHTML = `<div class="eightball-drop"><svg class="eightball-drop-svg" viewBox="0 0 64 64" aria-hidden="true"><use href="#sym-eightball"/></svg></div>`;
            playEightBallDropSound();
            setTimeout(() => {
              eightBallLayerEl.innerHTML = "";
            }, 1800);
          }
          if (result.isJackpot) {
            machine.jackpot = machine.initialJackpot;
            machine.updateJackpotUI();
          }
          if (result.isUltraJackpot) {
            state.ultraJackpot = INITIAL_ULTRA_JACKPOT;
          }
          machine.isSpinning = false;
          section.classList.remove("spinning-active");

          if (result.netResult > 0) {
            machine.setStatus(`${result.label}（+${result.netResult.toLocaleString()}）`, result.mode);
          } else if (result.bombCount > 0) {
            machine.setStatus(result.label, "penalty");
          } else {
            machine.setStatus(result.label);
          }
          return result;
        });
      }
    };

    miniSpinBtn.addEventListener("click", () => runSpin([machine]));
    miniAllInBtn.addEventListener("click", () => {
      if (anySpinning() || anyAutoActive() || state.credits <= 0) return;
      stopAutoAndBurst();
      runSpin([machine], { isAllIn: true });
    });

    // 本台獨立加減注與鍵盤輸入（超過動態上限自動修正為最高可賭額度）
    betMinusBtn.addEventListener("click", () => {
      if (machine.isSpinning || state.betMode !== "normal") return;
      const step = getBetStep(getDynamicMaxBet(machines.length));
      machine.bet = clampBetValue(machine.bet - step);
      updateUI();
    });

    betPlusBtn.addEventListener("click", () => {
      if (machine.isSpinning || state.betMode !== "normal") return;
      const step = getBetStep(getDynamicMaxBet(machines.length));
      machine.bet = clampBetValue(machine.bet + step);
      updateUI();
    });

    betInputEl.addEventListener("input", () => {
      if (machine.isSpinning || state.betMode !== "normal") return;
      const raw = parseInt(betInputEl.value, 10);
      if (Number.isNaN(raw)) return;
      const maxBet = getDynamicMaxBet(machines.length);
      if (raw > maxBet) {
        machine.bet = maxBet;
        betInputEl.value = String(maxBet);
      } else if (raw >= 1) {
        machine.bet = raw;
      }
      updateUI({ skipInputSyncFor: machine });
    });

    betInputEl.addEventListener("blur", () => {
      const raw = parseInt(betInputEl.value, 10);
      machine.bet = clampBetValue(raw);
      betInputEl.value = String(machine.bet);
      updateUI();
    });

    miniAutoBtn.addEventListener("click", () => {
      if (state.autoSpin || state.autoSpinPendingDual || state.isBurstSession) return;
      machine.autoSpin = !machine.autoSpin;
      if (!machine.autoSpin && machine.autoTimer) {
        clearTimeout(machine.autoTimer);
        machine.autoTimer = null;
      }

      // 若兩台單機 AUTO 同時被按下啟用，自動切換為「雙機 AUTO」
      if (machines.every((m) => m.autoSpin)) {
        machines.forEach((m) => {
          if (m.autoTimer) {
            clearTimeout(m.autoTimer);
            m.autoTimer = null;
          }
        });
        if (anySpinning()) {
          state.autoSpinPendingDual = true;
        } else {
          machines.forEach((m) => { m.autoSpin = false; });
          state.autoSpin = true;
          updateUI();
          runSpin(machines);
          return;
        }
      }

      updateUI();
      if (machine.autoSpin && !machine.isSpinning && !state.autoSpinPendingDual) {
        runSpin([machine]);
      }
    });
    machine.renderStatic();
    return machine;
  }

  const machines = [
    createMachine("A", "🎰 拉機 A", 8888, autoMachineABtn),
    createMachine("B", "🎰 拉機 B", 8888, autoMachineBBtn)
  ];

  function anySpinning() {
    return machines.some((m) => m.isSpinning);
  }

  function anyAutoActive() {
    return state.autoSpin || state.autoSpinPendingDual || machines.some((m) => m.autoSpin);
  }

  function getDiscountedTotalBet(betPerMachine, machineCount, isBurst = false) {
    const rawTotal = betPerMachine * machineCount;
    if (isBurst) return Math.max(1, Math.round(rawTotal * 0.9));
    if (machineCount >= 2) return Math.max(1, Math.round(rawTotal * 0.95));
    return rawTotal;
  }

  function showSpendTag(amount) {
    const tag = document.createElement("span");
    tag.className = "spend-float";
    tag.textContent = `-${amount.toLocaleString()}$`;
    creditsSpendStackEl.prepend(tag);

    setTimeout(() => {
      tag.remove();
    }, 3000);
  }

  function getDiscountedSum(rawTotal, machineCount, isBurst = false) {
    if (isBurst) return Math.max(1, Math.round(rawTotal * 0.9));
    if (machineCount >= 2) return Math.max(1, Math.round(rawTotal * 0.95));
    return rawTotal;
  }

  function updateUI({ skipInputSyncFor = null } = {}) {
    clampAllMachineBets();
    const isSingleAllIn = state.betMode === "single_allin";
    const isSecondAllIn = state.betMode === "second_allin";
    const isSingleAllInAny = isSingleAllIn || isSecondAllIn;
    const isDualAllIn = state.betMode === "dual_allin";
    const isMaxMode = state.betMode === "max";
    const dynamicMax = getDynamicMaxBet(machines.length);

    if (isMaxMode) {
      machines.forEach((m) => {
        m.bet = dynamicMax;
      });
    }

    const spinning = anySpinning();
    const rawDualSum = machines.reduce((sum, m) => sum + m.bet, 0);
    const dualCost = getDiscountedSum(rawDualSum, machines.length, false);
    const burstCost = getDiscountedSum(rawDualSum, machines.length, true);
    const autoLocked = anyAutoActive();

    const displayBetText = isSingleAllIn
      ? `A:${state.credits.toLocaleString()} / B:停用`
      : isSecondAllIn
        ? `A:停用 / B:${state.credits.toLocaleString()}`
        : isDualAllIn
          ? `A:${Math.floor(state.credits / 2).toLocaleString()} / B:${Math.floor(state.credits / 2).toLocaleString()}`
          : `A:${machines[0].bet.toLocaleString()} / B:${machines[1].bet.toLocaleString()}`;

    creditsEl.textContent = state.credits.toLocaleString();
    bombRateLabelEl.textContent = `${getBombRatePercent()}%`;
    betEl.textContent = displayBetText;
    maxBetLabelEl.textContent = dynamicMax.toLocaleString();
    winEl.textContent = state.lastNetWin.toLocaleString();
    ultraJackpotEl.textContent = state.ultraJackpot.toLocaleString();
    spinCountEl.textContent = `總轉數：${state.spinCount}`;

    const spinMainEl = spinAllBtn.querySelector(".spin-main");
    const spinSubEl = spinAllBtn.querySelector(".spin-sub");
    if (isSingleAllIn) {
      spinMainEl.textContent = "第一台 ALL IN";
      spinSubEl.textContent = "關閉第二台 • SPACE";
    } else if (isSecondAllIn) {
      spinMainEl.textContent = "第二台 ALL IN";
      spinSubEl.textContent = "關閉第一台 • SPACE";
    } else if (isDualAllIn) {
      spinMainEl.textContent = "雙台 ALL IN";
      spinSubEl.textContent = "餘額/2 • SPACE";
    } else {
      spinMainEl.textContent = "雙機齊發";
      spinSubEl.textContent = "省 5% • SPACE";
    }

    const minDualNeed = state.devNoZeroEnd ? 0 : (isDualAllIn ? 2 : isSingleAllInAny ? 1 : dualCost);
    spinAllBtn.disabled = spinning || autoLocked || state.credits < minDualNeed || (!state.devNoZeroEnd && !isSingleAllInAny && !isDualAllIn && rawDualSum <= 0);
    burstSpinBtn.disabled = spinning || autoLocked || isSingleAllInAny || isDualAllIn || (!state.devNoZeroEnd && (state.credits < burstCost || rawDualSum <= 0));
    betDownBtn.disabled = spinning || isMaxMode || isSingleAllInAny || isDualAllIn || machines.every((m) => m.bet <= 1);
    betUpBtn.disabled = spinning || isMaxMode || isSingleAllInAny || isDualAllIn || machines.every((m) => m.bet >= dynamicMax);
    maxBetBtn.disabled = spinning || isMaxMode || isSingleAllInAny || isDualAllIn || machines.every((m) => m.bet >= dynamicMax);

    betModeBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.betMode === state.betMode);
      btn.disabled = spinning;
    });

    autoSpinBtn.classList.toggle("active", state.autoSpin || state.autoSpinPendingDual);
    autoSpinBtn.setAttribute("aria-pressed", String(state.autoSpin || state.autoSpinPendingDual));
    autoSpinBtn.textContent = state.autoSpinPendingDual ? "⏳ 同步中..." : "雙機 AUTO";
    autoSpinBtn.disabled = isSingleAllInAny || state.isBurstSession;

    machines.forEach((m, idx) => {
      const disabledBySingleAllIn = (isSingleAllIn && idx === 1) || (isSecondAllIn && idx === 0);
      m.section.classList.toggle("cabinet-disabled", disabledBySingleAllIn);

      const effectiveDisplayBet = isSingleAllIn
        ? (idx === 0 ? state.credits : 0)
        : isSecondAllIn
          ? (idx === 1 ? state.credits : 0)
          : isDualAllIn
            ? Math.floor(state.credits / 2)
            : m.bet;

      if (m !== skipInputSyncFor) {
        m.betInputEl.value = String(effectiveDisplayBet);
      }
      const lockBetEdit = m.isSpinning || disabledBySingleAllIn || isMaxMode || isSingleAllInAny || isDualAllIn;
      m.betInputEl.disabled = lockBetEdit;
      m.betMinusBtn.disabled = lockBetEdit || m.bet <= 1;
      m.betPlusBtn.disabled = lockBetEdit || m.bet >= dynamicMax;

      const anyAllInMode = isSingleAllInAny || isDualAllIn;
      const singleBet = Math.min(m.bet, dynamicMax);
      m.miniSpinBtn.disabled = anyAllInMode || disabledBySingleAllIn || m.isSpinning || m.autoSpin || state.autoSpin || state.autoSpinPendingDual || (!state.devNoZeroEnd && (state.credits < singleBet || singleBet <= 0));
      m.miniAllInBtn.disabled = anyAllInMode || isMaxMode || disabledBySingleAllIn || spinning || autoLocked || state.credits <= 0;
      m.miniAutoBtn.classList.toggle("active", m.autoSpin);
      m.miniAutoBtn.setAttribute("aria-pressed", String(m.autoSpin));
      m.miniAutoBtn.disabled = isDualAllIn || disabledBySingleAllIn || state.autoSpin || state.autoSpinPendingDual || state.isBurstSession;
    });

    burstSpinBtn.textContent = state.burstRemaining > 0
      ? `🔥 連轉剩 ${state.burstRemaining} 輪（省10%）`
      : "🔥 連轉 ×5（省10%）";
  }

  function pushHistory(label, totalBet, netDelta, isJackpot, hasBomb) {
    const emptyItem = historyListEl.querySelector(".history-empty");
    if (emptyItem) emptyItem.remove();

    const li = document.createElement("li");
    const cls = netDelta > 0 ? " win" : hasBomb ? " penalty" : "";
    li.className = `history-item${cls}`;
    const deltaText = netDelta >= 0 ? `+${netDelta.toLocaleString()}` : `${(netDelta - totalBet).toLocaleString()}`;

    li.innerHTML = `
      <span>#${state.spinCount} &nbsp; ${isJackpot ? "🎉 " : ""}${label}</span>
      <strong>${deltaText}</strong>
    `;
    historyListEl.prepend(li);

    while (historyListEl.children.length > 20) {
      historyListEl.lastElementChild.remove();
    }
  }

  function stopAutoAndBurst() {
    stopSpinLoopSound();
    state.autoSpin = false;
    state.autoSpinPendingDual = false;
    state.burstRemaining = 0;
    state.isBurstSession = false;
    machines.forEach((m) => {
      m.autoSpin = false;
      if (m.autoTimer) {
        clearTimeout(m.autoTimer);
        m.autoTimer = null;
      }
    });
    autoSpinBtn.classList.remove("active");
    autoSpinBtn.setAttribute("aria-pressed", "false");
  }

  const SECRET_CODES = [
    {
      code: "TAIWAN",
      desc: "下一轉拉機 A 強制相連雙 🇹🇼（直奪 ULTRA）",
      run: () => { state.secretTaiwanPending = true; }
    },
    {
      code: "MAHJONG",
      desc: "下一轉拉機 A 必出 🀄 紅中大紅包",
      run: () => { state.secretMahjongPending = true; }
    },
    {
      code: "SEVENS",
      desc: "下一轉拉機 A 必出 5 連 7️⃣（中該台 GRAND）",
      run: () => { state.secretFiveSevensPending = true; }
    },
    {
      code: "NUKE",
      desc: "下一轉拉機 A 強制出現 💣 炸彈連線",
      run: () => { state.secretNukePending = true; }
    },
    {
      code: "BLACK",
      desc: "下一轉兩台各出現 1 顆 🎱 黑八",
      run: () => { state.secretBlackPending = true; }
    },
    {
      code: "DOUBLEBLACK",
      desc: "下一轉拉機 A 出現相連 2 顆 🎱（觸發即死）",
      run: () => { state.secretDoubleBlackPending = true; }
    },
    {
      code: "SPLITBLACK",
      desc: "下一轉拉機 A 出現分開 2 顆 🎱（留下最後 1 元）",
      run: () => { state.secretSplitBlackPending = true; }
    },
    {
      code: "MONEY",
      desc: "立即獲得 +50,000 餘額",
      run: () => { state.credits += 50000; updateUI(); }
    },
    {
      code: "ZERO",
      desc: "立即將餘額設為 1（測試極限）",
      run: () => { state.credits = 1; updateUI(); }
    },
    {
      code: "STARFALL",
      desc: "下一轉運作機台強制全盤 ⭐ 星星",
      run: () => { state.secretStarfallPending = true; }
    },
    {
      code: "UNLIMIT",
      desc: "下一轉解除 8 連上限，最高算至 16 連",
      run: () => { state.secretUnlimitPending = true; }
    },
    {
      code: "SUPERHERO",
      desc: "解鎖並開啟開發人員面板",
      hideActivate: true,
      run: () => { unlockDevPanel(); }
    }
  ];

  function isTestModeActive() {
    return state.devUnlocked || state.cheatUsed;
  }

  function markCheatActivated() {
    state.cheatUsed = true;
    menuSettleBtn.disabled = true;
    menuSettleBtn.textContent = state.devUnlocked ? "🏁 結算（開發者模式鎖定）" : "🏁 結算（已鎖定）";
  }

  function renderDevCodesList() {
    devCodesList.innerHTML = SECRET_CODES.map((item) => `
      <div class="dev-code-row">
        <div class="dev-code-info">
          <span class="dev-code-key">${item.code}</span>
          <span class="dev-code-desc">${formatTwFlags(item.desc)}</span>
        </div>
        ${item.hideActivate ? "" : `<button class="ctrl-btn dev-activate-btn" type="button" data-code="${item.code}">⚡ 激活</button>`}
      </div>
    `).join("");
  }

  const CHANGELOG_ENTRIES = [
    { ver: "v26.01.046", time: "2026-11-27 19:31", desc: "優化新手教學模式：點選後直接進入遊戲無需再按開始，並自動偵測 Xbox 搖桿與手機模式顯示專屬操作導覽。" },
    { ver: "v26.01.045", time: "2026-11-27 19:28", desc: "新增 5 步驟互動式「📖 新手教學模式」，可於開始畫面與右上角選單隨時開啟。" },
    { ver: "v26.01.044", time: "2026-11-27 19:22", desc: "將音效開關整合至選單設定，並於電腦模式隱藏手機震動選項。" },
    { ver: "v26.01.043", time: "2026-11-27 19:09", desc: "介面精簡與設定選項整合最佳化。" },
    { ver: "v26.01.042", time: "2026-11-27 19:08", desc: "選單新增「⚙️ 設定與選項」（含靜音、手機震動與手把震動開關），並加入轉輪停止震動回饋。" },
    { ver: "v26.01.041", time: "2026-11-27 19:06", desc: "新增 Xbox 搖桿相容模式，支援全按鈕操作與雙馬達震動回饋。" },
    { ver: "v26.01.040", time: "2026-11-27 19:03", desc: "優化手機版觸控震動回饋觸發時機，操作手感更即時。" },
    { ver: "v26.01.039", time: "2026-11-27 18:49", desc: "介面精簡與系統體驗最佳化。" },
    { ver: "v26.01.038", time: "2026-11-27 18:45", desc: "排行榜新增玩家隨機識別碼（#XXXX）與前 30 名自動清理機制最佳化。" },
    { ver: "v26.01.037", time: "2026-11-27 18:38", desc: "系統安全性強化與後端管理維護工具更新。" },
    { ver: "v26.01.036", time: "2026-11-27 18:27", desc: "選單新增「🏆 全球排行榜」，遊戲中可隨時查看 TOP 10。" },
    { ver: "v26.01.035", time: "2026-11-27 18:20", desc: "新增 Supabase 全球排行榜 TOP 10 與結算成績上傳功能。" },
    { ver: "v26.01.034", time: "2026-11-27 18:00", desc: "調整重複觸發 JACKPOT 規則：首個領取完整獎池，其餘重複次數給予初始獎池金額。" },
    { ver: "v26.01.033", time: "2026-11-27 17:30", desc: "完善結算與通關規範機制，並新增重開局選項。" },
    { ver: "v26.01.032", time: "2026-11-27 17:28", desc: "系統體驗最佳化與問題修正。" },
    { ver: "v26.01.031", time: "2026-11-27 17:18", desc: "新增神祕彩蛋機制與系統體驗最佳化。" },
    { ver: "v26.01.030", time: "2026-11-27 17:14", desc: "新增遊戲中期（滿 8 轉或 5,000 點以上）幸運 7 加成，提高 777 與 77777 連線出線機率。" },
    { ver: "v26.01.029", time: "2026-11-27 16:12", desc: "轉盤全面高清化：升級 11 種街機向量 SVG 符號、放大盤面尺寸並移除滾動模糊。" },
    { ver: "v26.01.028", time: "2026-11-27 15:42", desc: "調整 🎱 雙黑八規則：分開保留最後 1 元、相連直接遊戲結束。" },
    { ver: "v26.01.027", time: "2026-11-27 15:35", desc: "優化更新日誌分類與系統體驗調校。" },
    { ver: "v26.01.026", time: "2026-11-27 15:13", desc: "新增神祕彩蛋機制與極限數值安全防護。" },
    { ver: "v26.01.025", time: "2026-11-27 03:23", desc: "Bug 修復（系統穩定性與效能調校）。" },
    { ver: "v26.01.024", time: "2026-11-27 03:22", desc: "改名為「更新日誌」並加入日期時間；開始畫面下方新增最新更新。" },
    { ver: "v26.01.023", time: "2026-11-27 03:19", desc: "Bug 修復（系統穩定性與效能調校）。" },
    { ver: "v26.01.022", time: "2026-11-27 03:16", desc: "Bug 修復（系統穩定性與效能調校）。" },
    { ver: "v26.01.021", time: "2026-11-27 03:15", desc: "新增進階系統機制與防呆保護。" },
    { ver: "v26.01.020", time: "2026-11-27 03:12", desc: "選單新增「更新日誌」與介面顯示最佳化。" },
    { ver: "v26.01.019", time: "2026-11-27 02:55", desc: "Bug 修復（系統穩定性與效能調校）。" },
    { ver: "v26.01.018", time: "2026-11-27 02:52", desc: "調整國旗圖示等比例大小，與其他 Emoji 高度一致。" },
    { ver: "v26.01.017", time: "2026-11-27 02:50", desc: "全站國旗圖示相容性最佳化。" },
    { ver: "v26.01.016", time: "2026-11-27 02:37", desc: "調整 🎱 黑八同時出現機率。" },
    { ver: "v26.01.015", time: "2026-11-27 02:29", desc: "機台名稱更新為「🎰 拉機 A」與「🎰 拉機 B」。" },
    { ver: "v26.01.014", time: "2026-11-27 02:27", desc: "新增總餘額達 3,000,000,000,000,000 點終極通關結束機制。" },
    { ver: "v26.01.013", time: "2026-11-27 02:22", desc: "Bug 修復（系統穩定性與效能調校）。" },
    { ver: "v26.01.012", time: "2026-11-27 02:16", desc: "調整最高炸彈出現率上限為 50%。" },
    { ver: "v26.01.011", time: "2026-11-27 02:13", desc: "結算、失敗畫面與分享文案改為顯示「累計總贏分」。" },
    { ver: "v26.01.010", time: "2026-11-27 02:06", desc: "Bug 修復（系統穩定性與效能調校）。" },
    { ver: "v26.01.007", time: "2026-11-27 01:50", desc: "新增非賭博免責聲明與相關連結。" },
    { ver: "v26.01.006", time: "2026-11-27 01:48", desc: "新增手機全螢幕按鈕與介面最佳化。" },
    { ver: "v26.01.004", time: "2026-11-27 01:42", desc: "新增手機橫向雙機並排專用排版。" },
    { ver: "v26.01.001", time: "2026-11-27 01:35", desc: "導入 00.00.000 版本號系統。" }
  ];

  function renderChangelog() {
    changelogList.innerHTML = CHANGELOG_ENTRIES.map((item) => `
      <div class="changelog-item">
        <div class="changelog-head">
          <span class="changelog-ver">${item.ver}</span>
          <span class="changelog-time">${item.time}</span>
        </div>
        <span class="changelog-desc">${formatTwFlags(item.desc)}</span>
      </div>
    `).join("");
  }

  function renderStartLatestUpdates() {
    if (!startLatestUpdates) return;
    startLatestUpdates.innerHTML = CHANGELOG_ENTRIES.slice(0, 3).map((item) => `
      <div class="start-changelog-row">
        <span class="changelog-ver">${item.ver}</span>
        <span class="changelog-time">${item.time}</span>
        <span>${formatTwFlags(item.desc)}</span>
      </div>
    `).join("");
  }

  function refreshDevPanel() {
    if (!state.devUnlocked) return;
    const fullBoardSym = state.secretFullBoardRemaining > 0 && state.secretFullBoardSymbol
      ? (state.secretFullBoardSymbol === "random"
        ? { icon: "🎲", name: "隨機(除🇹🇼/🀄)" }
        : FULL_BOARD_ALLOWED_SYMBOLS.find((s) => s.id === state.secretFullBoardSymbol))
      : null;

    const pendingList = [
      state.secretStarfallPending && "⭐ 強制全盤星星 (STARFALL)",
      fullBoardSym && `🌌 強制全盤 ×${state.secretFullBoardRemaining} 轉 (${fullBoardSym.icon} ${fullBoardSym.name})`,
      state.secretUnlimitPending && "♾️ 單次連線無上限 (UNLIMIT)",
      state.secretTaiwanPending && "🇹🇼 雙國旗相連",
      state.secretMahjongPending && "🀄 必出紅中",
      state.secretFiveSevensPending && "7️⃣ 5連7",
      state.secretNukePending && "💣 炸彈連線",
      state.secretBlackPending && "🎱 雙機各1黑八",
      state.secretDoubleBlackPending && "🎱🎱 雙黑八相連",
      state.secretSplitBlackPending && "🎱 雙黑八分開(留1元)"
    ].filter(Boolean);

    const netProfit = state.credits - INITIAL_CREDITS;
    const netText = `${netProfit >= 0 ? "+" : ""}${netProfit.toLocaleString()}`;
    const autoFlags = [
      state.autoSpin && "雙機AUTO",
      state.autoSpinPendingDual && "同步中",
      machines[0].autoSpin && "A-AUTO",
      machines[1].autoSpin && "B-AUTO",
      state.burstRemaining > 0 && `連轉剩${state.burstRemaining}`
    ].filter(Boolean);

    const midProfile = getMidgameSevenProfile();
    const midSevenText = midProfile.active
      ? `啟動中（權重 ×${midProfile.weightMult.toFixed(2)}｜777 ${(midProfile.threeSevensChance * 100).toFixed(1)}%｜77777 ${(midProfile.fiveSevensChance * 100).toFixed(1)}%）`
      : "未啟動（需滿 8 轉或 5,000 點）";

    devStatsBox.innerHTML = formatTwFlags(`
      版本：<strong>v${APP_VERSION}</strong> ｜ 模式：<strong>${state.betMode}</strong> ｜ 狀態：<strong>${state.isSettled ? "已結算" : anySpinning() ? "轉動中" : "待機"}</strong><br>
      餘額：<strong>${state.credits.toLocaleString()}</strong>（最高 <strong>${state.peakCredits.toLocaleString()}</strong>）｜ 淨損益：<strong>${netText}</strong><br>
      動態上限：<strong>${getDynamicMaxBet(machines.length)}</strong> ｜ 押注 A/B：<strong>${machines[0].bet} / ${machines[1].bet}</strong><br>
      獎池 A/B：<strong>${machines[0].jackpot.toLocaleString()} / ${machines[1].jackpot.toLocaleString()}</strong> ｜ ULTRA：<strong>${state.ultraJackpot.toLocaleString()}</strong><br>
      💣 炸彈權重：<strong>${getDynamicBombWeight()}</strong>（${getBombRatePercent()}% / 上限50%）<br>
      7️⃣ 中期加成：<strong>${midSevenText}</strong><br>
      累計總押：<strong>${state.totalBetSpent.toLocaleString()}</strong> ｜ 累計總贏：<strong>${state.totalGrossWon.toLocaleString()}</strong><br>
      總轉數：<strong>${state.spinCount}</strong> ｜ GRAND/ULTRA：<strong>${state.jackpotHits}/${state.ultraHits}</strong> ｜ 🀄/🎱：<strong>${state.mahjongHits}/${state.eightBallHits}</strong><br>
      自動/護盾：<strong>${autoFlags.length ? autoFlags.join("、") : "無"}</strong> ｜ 極速:${state.devFastSpin ? "開" : "關"} 防黑八:${state.devGodMode ? "開" : "關"} 炸彈盾:${state.devBombShield ? "開" : "關"}<br>
      下一轉強制項目：<strong>${pendingList.length ? pendingList.join("、") : "無"}</strong>
    `);

    devFastSpinBtn.classList.toggle("active", state.devFastSpin);
    devFastSpinBtn.textContent = state.devFastSpin ? "⚡ 極速轉輪：開" : "⚡ 極速轉輪：關";
    devGodModeBtn.classList.toggle("active", state.devGodMode);
    devGodModeBtn.textContent = state.devGodMode ? "🛡️ 防黑八護盾：開" : "🛡️ 防黑八護盾：關";
    devBombShieldBtn.classList.toggle("active", state.devBombShield);
    devBombShieldBtn.textContent = state.devBombShield ? "🛡️ 炸彈護盾：開" : "🛡️ 炸彈護盾：關";
    devNoZeroEndBtn.classList.toggle("active", state.devNoZeroEnd);
    devNoZeroEndBtn.textContent = state.devNoZeroEnd ? "♾️ 0元不結束：開" : "♾️ 0元不結束：關";
    devMobileBigBtn.classList.toggle("active", state.devMobileBigBtn);
    devMobileBigBtn.textContent = state.devMobileBigBtn ? "🖐️ 單手大按鈕：開" : "🖐️ 單手大按鈕：關";
    devMobileCompactBtn.classList.toggle("active", state.devMobileCompact);
    devMobileCompactBtn.textContent = state.devMobileCompact ? "📐 緊湊盤面：開" : "📐 緊湊盤面：關";
    document.body.classList.toggle("mobile-big-controls", state.devMobileBigBtn);
    document.body.classList.toggle("mobile-compact-grid", state.devMobileCompact);
  }

  function unlockDevPanel() {
    state.devUnlocked = true;
    devPanelBtn.hidden = false;
    if (menuDisableDevRestartBtn) menuDisableDevRestartBtn.hidden = false;
    menuSettleBtn.disabled = true;
    menuSettleBtn.textContent = "🏁 結算（開發者模式鎖定）";
    closeMenu();
    renderDevCodesList();
    refreshDevPanel();
    devPanelModal.hidden = false;
  }

  function closeMenu() {
    gameMenu.hidden = true;
    menuBtn.setAttribute("aria-expanded", "false");
  }

  function openStartScreen({ canResume = false } = {}) {
    closeMenu();
    resumeGameBtn.hidden = !canResume;
    startScreen.hidden = false;
  }

  function restartGame({ showStart = false } = {}) {
    if (anySpinning()) return;
    stopAutoAndBurst();
    closeMenu();

    state.credits = INITIAL_CREDITS;
    state.peakCredits = INITIAL_CREDITS;
    state.maxSingleWin = 0;
    state.totalBetSpent = 0;
    state.totalGrossWon = 0;
    state.jackpotHits = 0;
    state.ultraHits = 0;
    state.mahjongHits = 0;
    state.eightBallHits = 0;
    state.isSettled = false;
    state.cheatUsed = state.devUnlocked;
    menuSettleBtn.disabled = state.devUnlocked;
    menuSettleBtn.textContent = state.devUnlocked ? "🏁 結算（開發者模式鎖定）" : "🏁 結算並結束本局";
    state.currentBet = 25;
    state.lastNetWin = 0;
    state.ultraJackpot = INITIAL_ULTRA_JACKPOT;
    state.spinCount = 0;

    historyListEl.innerHTML = `<li class="history-empty">尚無遊玩紀錄，點擊「雙機齊發」或單台拉桿開始！</li>`;
    machines.forEach((m) => {
      m.bet = 25;
      m.jackpot = m.initialJackpot;
      m.updateJackpotUI();
      m.currentCols = Array.from({ length: GRID_COLS }, () => createRandomCol());
      m.renderStatic();
      m.setStatus("準備就緒！（已重啟為 2,000 點）");
    });

    gameOverScreen.hidden = true;
    settlementScreen.hidden = true;
    resumeGameBtn.hidden = true;
    startScreen.hidden = !showStart;
    updateUI();
  }

  function disableDevAndRestart() {
    state.devUnlocked = false;
    state.devFastSpin = false;
    state.devGodMode = false;
    state.devBombShield = false;
    state.devNoZeroEnd = false;
    state.secretTaiwanPending = false;
    state.secretBlackPending = false;
    state.secretDoubleBlackPending = false;
    state.secretSplitBlackPending = false;
    state.secretMahjongPending = false;
    state.secretFiveSevensPending = false;
    state.secretNukePending = false;
    state.secretStarfallPending = false;
    state.secretUnlimitPending = false;
    state.secretFullBoardSymbol = null;
    state.secretFullBoardRemaining = 0;
    state.adminSessionPass = null;
    if (adminModal) adminModal.hidden = true;
    devPanelBtn.hidden = true;
    if (menuDisableDevRestartBtn) menuDisableDevRestartBtn.hidden = true;
    devPanelModal.hidden = true;
    restartGame({ showStart: false });
  }

  function checkGameOver(instantReason = null) {
    if (!anySpinning() && ((state.credits <= 0 && !state.devNoZeroEnd) || instantReason)) {
      stopAutoAndBurst();
      const baseText = instantReason || `本局共進行 ${state.spinCount} 輪轉動，餘額已歸零。`;
      const blockedRecord = isTestModeActive();
      if (blockedRecord) {
        gameOverStats.innerHTML = `${baseText}<br>⚠️ <strong>測試／開發者模式已啟用：本局成績不列入紀錄，且無法分享。</strong>`;
      } else {
        gameOverStats.innerHTML = `${baseText}<br>曾經賺過的最高餘額：<strong>${state.peakCredits.toLocaleString()}</strong> 點｜累計總贏分：<strong>${state.totalGrossWon.toLocaleString()}</strong> 點`;
      }
      gameOverShareXBtn.hidden = blockedRecord;
      gameOverShareThreadsBtn.hidden = blockedRecord;
      gameOverShareOtherBtn.hidden = blockedRecord;
      gameOverDisableDevRestartBtn.hidden = !state.devUnlocked;
      gameOverScreen.hidden = false;
      return true;
    }
    return false;
  }

  function getSettlementRows() {
    const netProfit = state.credits - INITIAL_CREDITS;
    const netText = `${netProfit >= 0 ? "+" : ""}${netProfit.toLocaleString()} 點`;
    return [
      { label: "最終餘額", value: `${state.credits.toLocaleString()} 點` },
      { label: "賺過最高金額", value: `${state.peakCredits.toLocaleString()} 點` },
      { label: "本局淨損益", value: netText },
      { label: "累計總贏分", value: `${state.totalGrossWon.toLocaleString()} 點` },
      { label: "總轉動次數", value: `${state.spinCount.toLocaleString()} 輪` },
      { label: "累計總押注", value: `${state.totalBetSpent.toLocaleString()} 點` },
      { label: "GRAND / ULTRA 大獎", value: `${state.jackpotHits} 次 / ${state.ultraHits} 次` },
      { label: "🀄 紅中 / 🎱 黑八", value: `${state.mahjongHits} 次 / ${state.eightBallHits} 次` }
    ];
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function renderLeaderboardTargets(html) {
    if (startLeaderboardList) startLeaderboardList.innerHTML = html;
    if (settleLeaderboardList) settleLeaderboardList.innerHTML = html;
    if (modalLeaderboardList) modalLeaderboardList.innerHTML = html;
  }

  async function fetchAndRenderLeaderboard() {
    if (!supabaseClient) {
      renderLeaderboardTargets(`<div class="leaderboard-empty">⚠️ 尚未連線至排行榜服務</div>`);
      return;
    }
    renderLeaderboardTargets(`<div class="leaderboard-empty">全球排行榜讀取中...</div>`);
    try {
      const { data, error } = await supabaseClient
        .from("leaderboard")
        .select("player_name, score")
        .order("score", { ascending: false })
        .limit(10);

      if (error) throw error;
      if (!data || data.length === 0) {
        renderLeaderboardTargets(`<div class="leaderboard-empty">目前尚無排行榜紀錄，搶下第一名吧！</div>`);
        return;
      }

      const html = data.map((row, index) => {
        const rank = index + 1;
        const rankLabel = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
        const rankClass = rank <= 3 ? ` rank-${rank}` : "";
        const safeName = escapeHtml(row.player_name || "匿名玩家");
        const safeScore = Number(row.score || 0).toLocaleString();
        return `
          <div class="leaderboard-row${rankClass}">
            <span class="leaderboard-rank">${rankLabel}</span>
            <span class="leaderboard-name">${safeName}</span>
            <span class="leaderboard-score">${safeScore}</span>
          </div>
        `;
      }).join("");
      renderLeaderboardTargets(html);
    } catch (err) {
      console.error("讀取排行榜失敗：", err);
      renderLeaderboardTargets(`<div class="leaderboard-empty">⚠️ 無法載入排行榜，請稍後再試</div>`);
    }
  }

  function formatTaggedPlayerName(rawName) {
    const cleanBase = String(rawName || "").trim().slice(0, 15);
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let suffix = "";
    for (let i = 0; i < 4; i++) {
      suffix += chars[Math.floor(Math.random() * chars.length)];
    }
    return `${cleanBase}#${suffix}`;
  }

  async function submitLeaderboardScore() {
    if (isTestModeActive()) {
      leaderboardSubmitFeedback.textContent = "⚠️ 測試／開發者模式下無法上傳至全球排行榜。";
      leaderboardSubmitFeedback.className = "leaderboard-feedback error";
      return;
    }
    if (state.isUploadingLeaderboard || state.hasUploadedCurrentSettlement) return;
    if (!supabaseClient) {
      leaderboardSubmitFeedback.textContent = "⚠️ 尚未連線至排行榜服務，請確認網路連線。";
      leaderboardSubmitFeedback.className = "leaderboard-feedback error";
      return;
    }

    const trimmedName = leaderboardNameInput.value.trim();
    if (!trimmedName) {
      leaderboardSubmitFeedback.textContent = "⚠️ 請先輸入玩家暱稱（不可空白）。";
      leaderboardSubmitFeedback.className = "leaderboard-feedback error";
      leaderboardNameInput.focus();
      return;
    }
    if (trimmedName.length > 15) {
      leaderboardSubmitFeedback.textContent = "⚠️ 玩家暱稱請限制在 15 字以內（系統會自動加上 #XXXX）。";
      leaderboardSubmitFeedback.className = "leaderboard-feedback error";
      leaderboardNameInput.focus();
      return;
    }

    const taggedName = formatTaggedPlayerName(trimmedName);
    const scoreToUpload = Math.max(0, Math.floor(state.credits));
    state.isUploadingLeaderboard = true;
    leaderboardSubmitBtn.disabled = true;
    leaderboardSubmitBtn.textContent = "上傳中...";
    leaderboardSubmitFeedback.textContent = "正在寫入全球排行榜...";
    leaderboardSubmitFeedback.className = "leaderboard-feedback";

    try {
      const { error } = await supabaseClient
        .from("leaderboard")
        .insert([{ player_name: taggedName, score: scoreToUpload }]);

      if (error) throw error;

      state.hasUploadedCurrentSettlement = true;
      leaderboardSubmitBtn.textContent = "✅ 已上傳";
      leaderboardNameInput.disabled = true;
      leaderboardSubmitFeedback.textContent = `✅ 已成功上傳 ${taggedName}（${scoreToUpload.toLocaleString()} 點）！`;
      leaderboardSubmitFeedback.className = "leaderboard-feedback success";
      await fetchAndRenderLeaderboard();
    } catch (err) {
      console.error("上傳排行榜失敗：", err);
      leaderboardSubmitBtn.disabled = false;
      leaderboardSubmitBtn.textContent = "🏆 上傳分數";
      leaderboardSubmitFeedback.textContent = "⚠️ 上傳失敗，請稍後再試。";
      leaderboardSubmitFeedback.className = "leaderboard-feedback error";
    } finally {
      state.isUploadingLeaderboard = false;
    }
  }

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const digest = await window.crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function renderAdminView() {
    const authed = Boolean(state.adminSessionPass);
    adminLoginView.hidden = authed;
    adminDashboardView.hidden = !authed;
    if (!authed) {
      adminPasswordInput.value = "";
      adminLoginFeedback.textContent = "";
      adminLoginFeedback.className = "leaderboard-feedback";
    }
  }

  async function loadAdminLeaderboard() {
    if (!state.devUnlocked || !state.adminSessionPass) return;
    if (!supabaseClient) {
      adminLeaderboardList.innerHTML = `<div class="leaderboard-empty">⚠️ 尚未連線至 Supabase</div>`;
      return;
    }
    adminLeaderboardList.innerHTML = `<div class="leaderboard-empty">讀取完整排行榜中...</div>`;
    try {
      const { data, error } = await supabaseClient
        .from("leaderboard")
        .select("id, player_name, score, created_at")
        .order("score", { ascending: false })
        .limit(100);
      if (error) throw error;

      const rows = data || [];
      state.adminCachedRows = rows;
      const topScore = rows.length ? Number(rows[0].score || 0) : 0;
      const top10Slice = rows.slice(0, 10);
      const top10Avg = top10Slice.length
        ? Math.round(top10Slice.reduce((sum, r) => sum + Number(r.score || 0), 0) / top10Slice.length)
        : 0;

      adminSummaryBox.innerHTML = `
        <div class="admin-stat-box">
          <span class="admin-stat-label">排行榜總筆數</span>
          <span class="admin-stat-val">${rows.length}${rows.length === 100 ? "+" : ""}</span>
        </div>
        <div class="admin-stat-box">
          <span class="admin-stat-label">最高分紀錄</span>
          <span class="admin-stat-val">${topScore.toLocaleString()}</span>
        </div>
        <div class="admin-stat-box">
          <span class="admin-stat-label">前 10 名均分</span>
          <span class="admin-stat-val">${top10Avg.toLocaleString()}</span>
        </div>
      `;

      if (rows.length === 0) {
        adminLeaderboardList.innerHTML = `<div class="leaderboard-empty">目前排行榜尚無資料</div>`;
        return;
      }

      adminLeaderboardList.innerHTML = rows.map((row, idx) => {
        const timeStr = row.created_at
          ? new Date(row.created_at).toLocaleString("zh-TW", { hour12: false })
          : "";
        return `
          <div class="admin-row">
            <span class="leaderboard-rank">#${idx + 1}</span>
            <div class="admin-row-main">
              <span class="admin-row-name">${escapeHtml(row.player_name)}</span>
              <span class="admin-row-meta">ID:${row.id} • ${escapeHtml(timeStr)}</span>
            </div>
            <span class="leaderboard-score">${Number(row.score || 0).toLocaleString()}</span>
            <div class="admin-row-actions">
              <button class="ctrl-btn admin-mini-btn" type="button" data-admin-edit="${row.id}">✏️</button>
              <button class="ctrl-btn admin-mini-btn danger" type="button" data-admin-del="${row.id}">🗑️</button>
            </div>
          </div>
        `;
      }).join("");
    } catch (err) {
      console.error("管理員讀取排行榜失敗：", err);
      adminLeaderboardList.innerHTML = `<div class="leaderboard-empty">⚠️ 讀取失敗，請稍後再試</div>`;
    }
  }

  async function handleAdminLogin() {
    if (!state.devUnlocked) return;
    const rawPass = adminPasswordInput.value;
    if (!rawPass) {
      adminLoginFeedback.textContent = "⚠️ 請輸入密碼。";
      adminLoginFeedback.className = "leaderboard-feedback error";
      return;
    }
    try {
      const hash = await sha256Hex(rawPass);
      if (hash !== ADMIN_PASS_HASH) {
        adminLoginFeedback.textContent = "❌ 密碼錯誤，請再試一次。";
        adminLoginFeedback.className = "leaderboard-feedback error";
        adminPasswordInput.select();
        return;
      }
      state.adminSessionPass = rawPass;
      adminActionFeedback.textContent = "";
      renderAdminView();
      await loadAdminLeaderboard();
    } catch (err) {
      console.error("密碼驗證失敗：", err);
      adminLoginFeedback.textContent = "⚠️ 瀏覽器不支援加密驗證。";
      adminLoginFeedback.className = "leaderboard-feedback error";
    }
  }

  function openAdminModal() {
    if (!state.devUnlocked) return;
    renderAdminView();
    adminModal.hidden = false;
    if (state.adminSessionPass) {
      loadAdminLeaderboard();
    } else {
      setTimeout(() => adminPasswordInput.focus(), 40);
    }
  }

  function openSettlement(customTitle = "本局結算報告", { allowOnMaxWin = false } = {}) {
    if (anySpinning()) return;
    if (isTestModeActive() && !allowOnMaxWin) return;
    stopAutoAndBurst();
    closeMenu();
    state.isSettled = true;
    settleTitle.textContent = customTitle;
    const hideShare = isTestModeActive();
    if (hideShare) {
      settleStatsGrid.innerHTML = `
        <div class="settle-stat-item" style="grid-column: 1 / -1;">
          <span class="settle-stat-label">測試／開發者模式保護</span>
          <span class="settle-stat-val">⚠️ 本局已啟用開發者或測試密技，成績不列入紀錄，且無法分享或下載圖片。</span>
        </div>
      `;
    } else {
      const rows = getSettlementRows();
      settleStatsGrid.innerHTML = rows.map((r) => `
        <div class="settle-stat-item">
          <span class="settle-stat-label">${r.label}</span>
          <span class="settle-stat-val">${r.value}</span>
        </div>
      `).join("");
    }
    downloadSettleImgBtn.hidden = hideShare;
    settleShareXBtn.hidden = hideShare;
    settleShareThreadsBtn.hidden = hideShare;
    shareSettleBtn.hidden = hideShare;
    settleDisableDevRestartBtn.hidden = !state.devUnlocked;

    state.isUploadingLeaderboard = false;
    state.hasUploadedCurrentSettlement = false;
    if (leaderboardUploadBox) {
      leaderboardUploadBox.hidden = hideShare;
    }
    if (!hideShare && leaderboardNameInput && leaderboardSubmitBtn && leaderboardSubmitFeedback) {
      leaderboardNameInput.disabled = false;
      leaderboardNameInput.value = "";
      leaderboardSubmitBtn.disabled = false;
      leaderboardSubmitBtn.textContent = "🏆 上傳分數";
      leaderboardSubmitFeedback.textContent = `本次將上傳最終餘額：${Math.max(0, Math.floor(state.credits)).toLocaleString()} 點`;
      leaderboardSubmitFeedback.className = "leaderboard-feedback";
    }
    fetchAndRenderLeaderboard();

    settlementScreen.hidden = false;
    updateUI();
  }

  function checkMaxWinEnding() {
    if (!anySpinning() && state.credits >= MAX_WIN_CREDITS) {
      openSettlement("🏆 達成 3,000,000,000,000,000 傳說通關！", { allowOnMaxWin: true });
      return true;
    }
    return false;
  }

  function downloadSettlementImage() {
    if (isTestModeActive()) return;
    const canvas = document.createElement("canvas");
    canvas.width = 920;
    canvas.height = 640;
    const ctx = canvas.getContext("2d");

    // 背景漸層
    const bg = ctx.createLinearGradient(0, 0, 920, 640);
    bg.addColorStop(0, "#101426");
    bg.addColorStop(1, "#1b223d");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 920, 640);

    // 金色邊框
    ctx.strokeStyle = "#f5c542";
    ctx.lineWidth = 4;
    ctx.strokeRect(20, 20, 880, 600);

    // 標題
    ctx.fillStyle = "#ffe17d";
    ctx.font = "bold 36px 'Segoe UI', 'Noto Sans TC', sans-serif";
    ctx.fillText("街霸拉機NEON777 — 本局結算報告", 52, 82);

    ctx.fillStyle = "#939bb8";
    ctx.font = "16px 'Segoe UI', 'Noto Sans TC', sans-serif";
    ctx.fillText(`結算時間：${new Date().toLocaleString("zh-TW")}`, 52, 114);

    // 結算格線資料
    const rows = getSettlementRows();
    rows.forEach((row, idx) => {
      const col = idx % 2;
      const r = Math.floor(idx / 2);
      const x = 52 + col * 416;
      const y = 148 + r * 104;

      ctx.fillStyle = "rgba(11, 13, 23, 0.8)";
      ctx.fillRect(x, y, 396, 86);
      ctx.strokeStyle = "rgba(45, 226, 230, 0.35)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, 396, 86);

      ctx.fillStyle = "#939bb8";
      ctx.font = "16px 'Segoe UI', 'Noto Sans TC', sans-serif";
      ctx.fillText(row.label, x + 18, y + 32);

      ctx.fillStyle = "#ffe17d";
      ctx.font = "bold 24px 'Segoe UI', 'Noto Sans TC', sans-serif";
      ctx.fillText(row.value, x + 18, y + 66);
    });

    const link = document.createElement("a");
    link.download = `NEON777-結算報告-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  function triggerGamepadRumble(durationMs = 80, weak = 0.25, strong = 0.45) {
    if (!state.gamepadEnabled || !state.gamepadRumbleEnabled || typeof navigator === "undefined" || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    for (const pad of pads) {
      if (pad && pad.connected && pad.vibrationActuator && typeof pad.vibrationActuator.playEffect === "function") {
        try {
          pad.vibrationActuator.playEffect("dual-rumble", {
            startDelay: 0,
            duration: durationMs,
            weakMagnitude: weak,
            strongMagnitude: strong
          });
        } catch (_) {
          // 忽略部分瀏覽器或手把不支援 playEffect 之例外
        }
      }
    }
  }

  function triggerHaptic(pattern = 20) {
    if (state.gamepadConnected) {
      const isStrong = Array.isArray(pattern) && pattern.length >= 3;
      triggerGamepadRumble(isStrong ? 180 : 65, isStrong ? 0.45 : 0.2, isStrong ? 0.85 : 0.35);
    }
    if (!state.devMobileVibrate || typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    try {
      navigator.vibrate(pattern);
    } catch (_) {
      // 忽略部分行動瀏覽器未授權時之例外
    }
  }

  function triggerReelStopHaptic(colIdx) {
    const isLastCol = colIdx === GRID_COLS - 1;
    if (state.gamepadConnected && state.gamepadRumbleEnabled) {
      triggerGamepadRumble(isLastCol ? 60 : 28, isLastCol ? 0.25 : 0.12, isLastCol ? 0.45 : 0.22);
    }
    if (!state.devMobileVibrate || typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    try {
      navigator.vibrate(isLastCol ? 20 : 10);
    } catch (_) {
      // 忽略部分行動瀏覽器未授權時之例外
    }
  }

  async function runSpin(targetMachines = machines, { isAllIn = false } = {}) {
    if (state.isSettled) return;
    // 依據強制押注模式自動調整目標機台與押注金額
    if (state.betMode === "single_allin") {
      targetMachines = [machines[0]];
      isAllIn = true;
    } else if (state.betMode === "second_allin") {
      targetMachines = [machines[1]];
      isAllIn = true;
    } else if (state.betMode === "dual_allin") {
      targetMachines = machines;
      isAllIn = true;
    }

    if (targetMachines.some((m) => m.isSpinning)) return;

    clampAllMachineBets();
    const isBurst = state.burstRemaining > 0;
    triggerHaptic(isBurst ? [18, 28, 18] : 22);
    const maxForTargets = getDynamicMaxBet(machines.length);
    const machineBets = targetMachines.map((m) => {
      if (isAllIn) {
        return targetMachines.length === 2 ? Math.floor(state.credits / 2) : state.credits;
      }
      if (state.betMode === "max") {
        return maxForTargets;
      }
      return Math.min(m.bet, maxForTargets);
    });

    const rawTotal = machineBets.reduce((sum, b) => sum + b, 0);
    const totalBet = isAllIn
      ? rawTotal
      : getDiscountedSum(rawTotal, targetMachines.length, isBurst);

    if (state.devNoZeroEnd && state.credits < totalBet) {
      totalBet = Math.max(0, state.credits);
      machineBets.forEach((_, idx) => {
        machineBets[idx] = totalBet > 0 ? Math.floor(totalBet / targetMachines.length) : 0;
      });
    } else if (machineBets.some((b) => b <= 0) || state.credits < totalBet) {
      if (state.isBurstSession) {
        state.credits = Math.max(0, state.credits + state.lastNetWin);
      }
      stopAutoAndBurst();
      targetMachines.forEach((m) => m.setStatus("餘額不足，請點擊「重啟 2,000」！"));
      updateUI();
      checkGameOver();
      return;
    }

    // 鎖定本局開轉前的炸彈權重，避免 ALL IN 扣款後餘額歸零導致沒吃到原本的炸彈%
    state.activeSpinBombWeight = getDynamicBombWeight();
    state.credits -= totalBet;
    if (!isTestModeActive()) {
      state.totalBetSpent = Math.min(Number.MAX_SAFE_INTEGER, state.totalBetSpent + totalBet);
    }
    if (totalBet > 0) showSpendTag(totalBet);
    if (!state.isBurstSession) {
      state.lastNetWin = 0;
    }
    state.spinCount += 1;
    // 任意一台開賭時都會累積全場共用的超終極大獎獎池
    state.ultraJackpot = Math.min(Number.MAX_SAFE_INTEGER, state.ultraJackpot + Math.max(10, Math.round(totalBet * 0.3)));

    startSpinLoopSound();
    updateUI();

    // 預先生成各台盤面，並強制保證兩台不可能同時各出現 2 顆 🇹🇼
    const triggerSecretTaiwan = state.secretTaiwanPending;
    const triggerSecretBlack = state.secretBlackPending;
    const triggerDoubleBlack = state.secretDoubleBlackPending;
    const triggerSplitBlack = state.secretSplitBlackPending;
    const triggerMahjong = state.secretMahjongPending;
    const triggerFiveSevens = state.secretFiveSevensPending;
    const triggerNuke = state.secretNukePending;
    const triggerStarfall = state.secretStarfallPending;
    const triggerFullBoardSymbol = state.secretFullBoardRemaining > 0 ? state.secretFullBoardSymbol : null;
    const activeChainCap = state.secretUnlimitPending ? GRID_COLS : MAX_CHAIN_CAP;

    state.secretTaiwanPending = false;
    state.secretBlackPending = false;
    state.secretDoubleBlackPending = false;
    state.secretSplitBlackPending = false;
    state.secretMahjongPending = false;
    state.secretFiveSevensPending = false;
    state.secretNukePending = false;
    state.secretStarfallPending = false;
    state.secretUnlimitPending = false;
    if (state.secretFullBoardRemaining > 0) {
      state.secretFullBoardRemaining -= 1;
      if (state.secretFullBoardRemaining <= 0) {
        state.secretFullBoardRemaining = 0;
        state.secretFullBoardSymbol = null;
      }
    }

    const hasAnyForcedEvent =
      triggerSecretTaiwan ||
      triggerSecretBlack ||
      triggerDoubleBlack ||
      triggerSplitBlack ||
      triggerMahjong ||
      triggerFiveSevens ||
      triggerNuke ||
      triggerStarfall ||
      Boolean(triggerFullBoardSymbol);

    const naturalMiracleSym = !hasAnyForcedEvent && Math.random() < SECRET_MIRACLE_CHANCE
      ? pickSecretFullBoardSymbol("random")
      : null;
    const naturalMiracleMachineIdx = naturalMiracleSym
      ? Math.floor(Math.random() * targetMachines.length)
      : -1;

    let alreadyHasTwoTw = false;
    const preparedBoards = targetMachines.map((_, idx) => {
      if (triggerStarfall) {
        const starSym = SYMBOLS.find((s) => s.id === "star");
        return Array.from({ length: GRID_COLS }, () => Array.from({ length: GRID_ROWS }, () => starSym));
      }
      if (triggerFullBoardSymbol) {
        const chosenSym = pickSecretFullBoardSymbol(triggerFullBoardSymbol);
        return Array.from({ length: GRID_COLS }, () => Array.from({ length: GRID_ROWS }, () => chosenSym));
      }
      if (naturalMiracleSym && idx === naturalMiracleMachineIdx) {
        return Array.from({ length: GRID_COLS }, () => Array.from({ length: GRID_ROWS }, () => naturalMiracleSym));
      }
      const board = enforceExclusiveJackpot(
        Array.from({ length: GRID_COLS }, () => createRandomCol()),
        alreadyHasTwoTw ? 1 : 3
      );

      // 額外降低自然開局同時出現 2 顆以上 🎱 的機率（85% 機率只保留第 1 顆 🎱）
      if (!triggerDoubleBlack && !triggerSplitBlack) {
        let seenEight = 0;
        const keepMultiEight = Math.random() < 0.15;
        const lemonSym = SYMBOLS.find((s) => s.id === "lemon");
        for (let c = 0; c < GRID_COLS; c++) {
          for (let r = 0; r < GRID_ROWS; r++) {
            if (board[c][r].id === "eightball") {
              seenEight += 1;
              if (seenEight > 1 && !keepMultiEight) {
                board[c][r] = lemonSym;
              }
            }
          }
        }
      }

      // 若輸入了秘密代碼 TAIWAN，下次賭時在第一台強制放入相連的 2 顆 🇹🇼
      if (triggerSecretTaiwan && idx === 0) {
        const twSym = SYMBOLS.find((s) => s.id === "tw");
        const fallbackSym = SYMBOLS.find((s) => s.id === "star");
        replaceExtraTw(board, 0);
        if (hasFiveSevens(board)) {
          for (let c = 0; c < GRID_COLS; c++) {
            for (let r = 0; r < GRID_ROWS; r++) {
              if (board[c][r].id === "seven") board[c][r] = fallbackSym;
            }
          }
        }
        const c1 = Math.floor(Math.random() * (GRID_COLS - 1));
        const r1 = Math.floor(Math.random() * GRID_ROWS);
        board[c1][r1] = twSym;
        board[c1 + 1][r1] = twSym;
      }

      if (triggerMahjong && idx === 0) {
        const mahjongSym = SYMBOLS.find((s) => s.id === "mahjong");
        board[Math.floor(Math.random() * GRID_COLS)][Math.floor(Math.random() * GRID_ROWS)] = mahjongSym;
      }

      if (triggerFiveSevens && idx === 0) {
        const sevenSym = SYMBOLS.find((s) => s.id === "seven");
        replaceExtraTw(board, 0);
        const r = Math.floor(Math.random() * GRID_ROWS);
        const startC = Math.floor(Math.random() * (GRID_COLS - 5));
        for (let k = 0; k < 5; k++) {
          board[startC + k][r] = sevenSym;
        }
      }

      // 若輸入了秘密代碼 BLACK，下次賭時讓每台都出現剛好 1 顆 🎱
      if (triggerSecretBlack) {
        const eightSym = SYMBOLS.find((s) => s.id === "eightball");
        const fallbackSym = SYMBOLS.find((s) => s.id === "lemon");
        for (let c = 0; c < GRID_COLS; c++) {
          for (let r = 0; r < GRID_ROWS; r++) {
            if (board[c][r].id === "eightball") board[c][r] = fallbackSym;
          }
        }
        let bc = Math.floor(Math.random() * GRID_COLS);
        let br = Math.floor(Math.random() * GRID_ROWS);
        while (board[bc][br].id === "tw") {
          bc = Math.floor(Math.random() * GRID_COLS);
          br = Math.floor(Math.random() * GRID_ROWS);
        }
        board[bc][br] = eightSym;
      }

      if (triggerDoubleBlack && idx === 0) {
        const eightSym = SYMBOLS.find((s) => s.id === "eightball");
        board[5][6] = eightSym;
        board[6][6] = eightSym;
      }

      if (triggerSplitBlack && idx === 0) {
        const eightSym = SYMBOLS.find((s) => s.id === "eightball");
        const lemonSym = SYMBOLS.find((s) => s.id === "lemon");
        for (let c = 0; c < GRID_COLS; c++) {
          for (let r = 0; r < GRID_ROWS; r++) {
            if (board[c][r].id === "eightball") board[c][r] = lemonSym;
          }
        }
        board[2][2] = eightSym;
        board[12][12] = eightSym;
      }

      if (triggerNuke && idx === 0 && !state.devBombShield) {
        const bombSym = SYMBOLS.find((s) => s.id === "bomb");
        const r = Math.floor(Math.random() * GRID_ROWS);
        for (let k = 0; k < 6; k++) {
          board[3 + k][r] = bombSym;
        }
      }

      // 遊戲中期（滿 8 轉或 5,000 點以上）自然提高 777 與 77777 連線機率
      const midSevenProfile = getMidgameSevenProfile();
      if (
        midSevenProfile.active &&
        !triggerSecretTaiwan &&
        !triggerFiveSevens &&
        !triggerNuke &&
        !triggerDoubleBlack &&
        !triggerSplitBlack &&
        !triggerSecretBlack &&
        countTw(board) === 0
      ) {
        const sevenRoll = Math.random();
        if (sevenRoll < midSevenProfile.fiveSevensChance && !hasFiveSevens(board)) {
          placeSevenLine(board, 5);
        } else if (sevenRoll < midSevenProfile.fiveSevensChance + midSevenProfile.threeSevensChance) {
          placeSevenLine(board, 3);
        }
      }

      if (countTw(board) >= 2) {
        alreadyHasTwoTw = true;
      }
      return board;
    });

    const results = await Promise.all(
      targetMachines.map((m, idx) => m.spinOne(machineBets[idx], idx * 160, preparedBoards[idx], activeChainCap))
    );
    state.activeSpinBombWeight = null;
    stopSpinLoopSound();

    const validResults = results.filter(Boolean);
    const combinedNet = Math.min(
      Number.MAX_SAFE_INTEGER,
      validResults.reduce((sum, r) => sum + r.netResult, 0)
    );
    const anyUltraJackpot = validResults.some((r) => r.isUltraJackpot);
    const anyJackpot = validResults.some((r) => r.isJackpot);
    const anyMahjong = validResults.some((r) => r.mahjongCount > 0);
    const anyBomb = validResults.some((r) => r.bombCount > 0);
    const anyLeaveOne = validResults.some((r) => r.leaveOneCredit);
    const anyInstantGameOver = validResults.some((r) => r.instantGameOver);
    const totalLines = validResults.reduce((sum, r) => sum + r.lineCount, 0);
    const maxWinCells = validResults.reduce((max, r) => Math.max(max, r.winCells.size), 0);

    if (!isTestModeActive()) {
      state.totalGrossWon = Math.min(Number.MAX_SAFE_INTEGER, state.totalGrossWon + combinedNet);
      state.maxSingleWin = Math.min(Number.MAX_SAFE_INTEGER, Math.max(state.maxSingleWin, combinedNet));
      state.jackpotHits += validResults.filter((r) => r.isJackpot && !r.isUltraJackpot).length;
      state.ultraHits += validResults.filter((r) => r.isUltraJackpot).length;
      state.mahjongHits += validResults.reduce((sum, r) => sum + r.mahjongCount, 0);
      state.eightBallHits += validResults.reduce((sum, r) => sum + r.eightBallCount, 0);
    }

    if (anyUltraJackpot) {
      state.ultraJackpot = INITIAL_ULTRA_JACKPOT;
    }

    if (state.isBurstSession) {
      state.lastNetWin = Math.min(Number.MAX_SAFE_INTEGER, state.lastNetWin + combinedNet);
    } else {
      state.credits = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, state.credits + combinedNet));
      if (!isTestModeActive()) {
        state.peakCredits = Math.max(state.peakCredits, state.credits);
      }
      state.lastNetWin = combinedNet;
    }

    if (anyLeaveOne && !anyInstantGameOver) {
      state.credits = 1;
    }

    if (maxWinCells > 0) {
      triggerHaptic(anyJackpot || anyUltraJackpot ? [60, 40, 120] : 40);
    } else if (anyInstantGameOver || anyLeaveOne) {
      triggerHaptic([80, 40, 80]);
    }

    if (anyMahjong || anyUltraJackpot) {
      setTimeout(() => playSpecialSound(), Math.min(maxWinCells * CONNECT_STEP_MS, 600));
    } else if (combinedNet > 0 && maxWinCells === 0) {
      playWinSound(anyJackpot);
    } else if (anyBomb && combinedNet <= 0) {
      playBombSound();
    }

    const scopeLabel = targetMachines.length === machines.length ? "雙機齊發" : targetMachines[0].title;
    const summaryLabel = `${scopeLabel}｜命中 ${totalLines} 條${anyMahjong ? "｜🀄紅中" : ""}${anyBomb ? "｜💣炸彈" : ""}`;
    pushHistory(summaryLabel, totalBet, combinedNet, anyJackpot || anyMahjong, anyBomb);

    if (state.burstRemaining > 0) {
      state.burstRemaining -= 1;
    }

    // 連轉 ×5 跑完五次後才徹底結算入總餘額，並保留 NET 顯示直到下次再賭才重製
    if (state.isBurstSession && state.burstRemaining === 0) {
      state.credits = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, state.credits + state.lastNetWin));
      if (!isTestModeActive()) {
        state.peakCredits = Math.max(state.peakCredits, state.credits);
        state.maxSingleWin = Math.max(state.maxSingleWin, state.lastNetWin);
      }
      state.isBurstSession = false;
      machines.forEach((m) => {
        m.setStatus(
          `🔥 連轉 ×5 結算完成！本輪總淨贏：${state.lastNetWin >= 0 ? "+" : ""}${state.lastNetWin.toLocaleString()}`,
          state.lastNetWin >= 0 ? "win" : "penalty"
        );
      });
    }

    updateUI();

    if (anyInstantGameOver) {
      checkGameOver(`本局共進行 ${state.spinCount} 輪，因單台同時出現相連 2 顆 🎱 黑八直接判定遊戲結束！`);
      return;
    }

    if (checkMaxWinEnding()) return;

    if (!state.isBurstSession && checkGameOver()) return;

    // 若單台 AUTO 正在轉動中且玩家開啟了雙 AUTO，等該台這輪跑完後切換為兩台一起 AUTO
    if (state.autoSpinPendingDual && !anySpinning()) {
      state.autoSpinPendingDual = false;
      state.autoSpin = true;
      machines.forEach((m) => {
        m.autoSpin = false;
        if (m.autoTimer) {
          clearTimeout(m.autoTimer);
          m.autoTimer = null;
        }
      });
      updateUI();
      setTimeout(() => {
        if (state.autoSpin && !anySpinning()) {
          runSpin(machines);
        }
      }, 1000);
      return;
    }

    if (state.burstRemaining > 0 || state.autoSpin) {
      setTimeout(() => {
        if ((state.burstRemaining > 0 || state.autoSpin) && !anySpinning()) {
          runSpin(machines);
        }
      }, 1000);
    } else if (targetMachines.length === 1) {
      const singleM = targetMachines[0];
      if (singleM.autoSpin) {
        singleM.autoTimer = setTimeout(() => {
          singleM.autoTimer = null;
          if (singleM.autoSpin && !singleM.isSpinning && !state.autoSpin && !state.autoSpinPendingDual) {
            runSpin([singleM]);
          }
        }, 1000);
      }
    }
  }

  function renderPaytable() {
    const rows = SYMBOLS.map((s) => {
      const m3 = s.baseMult;
      const m5 = +(s.baseMult * 4).toFixed(1);
      const m8 = +(s.baseMult * Math.pow(2, MAX_CHAIN_CAP - 3)).toFixed(1);
      const multText = s.isTopJackpot
        ? `1顆 GRAND / 2顆分開 GRAND+10% / 2顆相連 ULTRA / 3顆再+GRAND 50%`
        : s.isVoid
          ? `1顆失去該台獎金；2顆分開留最後1元；2顆相連直接遊戲結束`
          : s.isSpecial
            ? `極稀有！出現即送 max(1,000, 當前押注上限)`
            : s.isPenalty
              ? `懲罰：3連 −×${m3} ～ ${MAX_CHAIN_CAP}連 −×${m8}`
              : `3連 ×${m3} / 5連 ×${m5} / ${MAX_CHAIN_CAP}連(上限) ×${m8}`;
      const iconHtml = renderSymbolIcon(s);
      const comboText = (s.isSpecial || s.isTopJackpot || s.isVoid) ? iconHtml : `${iconHtml}${iconHtml}${iconHtml}`;
      return `
        <div class="paytable-row">
          <span class="paytable-combo">${comboText}</span>
          <span>${s.name}</span>
          <span class="paytable-mult">${multText}</span>
        </div>
      `;
    }).join("");
    paytableBody.innerHTML = rows;
  }

  // 事件綁定
  spinAllBtn.addEventListener("click", () => runSpin(machines));

  burstSpinBtn.addEventListener("click", () => {
    if (anySpinning()) return;
    state.lastNetWin = 0;
    state.burstRemaining = 5;
    state.isBurstSession = true;
    runSpin(machines);
  });

  betDownBtn.addEventListener("click", () => {
    const maxBet = getDynamicMaxBet(machines.length);
    const step = getBetStep(maxBet);
    machines.forEach((m) => {
      m.bet = clampBetValue(m.bet - step);
    });
    triggerHaptic(12);
    updateUI();
  });

  betUpBtn.addEventListener("click", () => {
    const maxBet = getDynamicMaxBet(machines.length);
    const step = getBetStep(maxBet);
    machines.forEach((m) => {
      m.bet = clampBetValue(m.bet + step);
    });
    triggerHaptic(12);
    updateUI();
  });

  maxBetBtn.addEventListener("click", () => {
    const maxBet = getDynamicMaxBet(machines.length);
    machines.forEach((m) => {
      m.bet = maxBet;
    });
    triggerHaptic(16);
    updateUI();
  });

  betModeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (anySpinning()) return;
      state.betMode = btn.dataset.betMode;
      if (state.betMode === "single_allin" || state.betMode === "second_allin") {
        state.autoSpin = false;
        state.autoSpinPendingDual = false;
        const disabledIdx = state.betMode === "single_allin" ? 1 : 0;
        machines[disabledIdx].autoSpin = false;
        if (machines[disabledIdx].autoTimer) {
          clearTimeout(machines[disabledIdx].autoTimer);
          machines[disabledIdx].autoTimer = null;
        }
      } else if (state.betMode === "dual_allin") {
        machines.forEach((m) => {
          m.autoSpin = false;
          if (m.autoTimer) {
            clearTimeout(m.autoTimer);
            m.autoTimer = null;
          }
        });
      }
      updateUI();
    });
  });

  autoSpinBtn.addEventListener("click", () => {
    if (state.isBurstSession) return;

    // 若已經在雙 AUTO 或等待同步中，再按一次即取消
    if (state.autoSpin || state.autoSpinPendingDual) {
      state.autoSpin = false;
      state.autoSpinPendingDual = false;
      updateUI();
      return;
    }

    const anySingleAuto = machines.some((m) => m.autoSpin);
    // 若有單台 AUTO 正在轉動中，先進入等待同步狀態，等那台循環完畢再兩台一起 AUTO
    if (anySingleAuto && anySpinning()) {
      state.autoSpinPendingDual = true;
      machines.forEach((m) => {
        if (m.autoTimer) {
          clearTimeout(m.autoTimer);
          m.autoTimer = null;
        }
      });
      updateUI();
      return;
    }

    // 否則直接關閉單台 AUTO 並啟動雙 AUTO
    machines.forEach((m) => {
      m.autoSpin = false;
      if (m.autoTimer) {
        clearTimeout(m.autoTimer);
        m.autoTimer = null;
      }
    });
    state.autoSpin = true;
    updateUI();
    if (!anySpinning()) {
      runSpin(machines);
    }
  });

  resumeGameBtn.addEventListener("click", () => {
    startScreen.hidden = true;
  });

  startGameBtn.addEventListener("click", () => {
    restartGame({ showStart: false });
  });

  gameOverRestartBtn.addEventListener("click", () => {
    restartGame({ showStart: false });
  });

  gameOverHomeBtn.addEventListener("click", () => {
    restartGame({ showStart: true });
  });

  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const nextHidden = !gameMenu.hidden;
    gameMenu.hidden = nextHidden;
    menuBtn.setAttribute("aria-expanded", String(!nextHidden));
  });

  const GAME_SHARE_URL = "https://markstar-tw.github.io/neon777-slot/";

  function buildShareBodyText() {
    const netProfit = state.credits - INITIAL_CREDITS;
    const netText = `${netProfit >= 0 ? "+" : ""}${netProfit.toLocaleString()}`;
    const headerTitle = !gameOverScreen.hidden
      ? "🎰 街霸拉機NEON777 — 挑戰失敗戰績"
      : "🎰 街霸拉機NEON777 — 本局結算成績";
    return [
      headerTitle,
      `💰 最終餘額：${state.credits.toLocaleString()} 點（淨損益 ${netText} 點）`,
      `🏆 賺過最高金額：${state.peakCredits.toLocaleString()} 點｜累計總贏分：${state.totalGrossWon.toLocaleString()} 點`,
      `🎲 總轉數：${state.spinCount} 輪｜GRAND ${state.jackpotHits} 次 / ULTRA ${state.ultraHits} 次`,
      `✨ 快來加入我一起玩轉盤！`
    ].join("\n");
  }

  function shareToX() {
    const bodyText = buildShareBodyText();
    const xUrl = `https://x.com/intent/post?url=${encodeURIComponent(GAME_SHARE_URL)}&text=${encodeURIComponent("\n" + bodyText)}`;
    window.open(xUrl, "_blank", "noopener,noreferrer");
  }

  function shareToThreads() {
    const fullText = `${GAME_SHARE_URL}\n${buildShareBodyText()}`;
    // 直接使用 threads.com 避免 threads.net 跳轉時造成 UTF-8 Emoji 亂碼
    const threadsUrl = `https://www.threads.com/intent/post?text=${encodeURIComponent(fullText)}`;
    window.open(threadsUrl, "_blank", "noopener,noreferrer");
  }

  async function shareSettlementToSocial(triggerBtn = shareSettleBtn) {
    const shareText = `${GAME_SHARE_URL}\n${buildShareBodyText()}`;

    // 先將「連結 + 完整成績文案」複製到剪貼簿，確保就算目標平台只吃 url 也能直接 Ctrl+V 貼上成績
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(shareText);
        triggerBtn.textContent = "✅ 已複製完整成績！";
        setTimeout(() => {
          triggerBtn.textContent = "📤 其他分享";
        }, 2500);
      } catch (_) {
        // ignore clipboard error if blocked
      }
    }

    if (navigator.share) {
      try {
        await navigator.share({
          title: "街霸拉機NEON777 — 本局戰績",
          text: shareText,
          url: GAME_SHARE_URL
        });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }

    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      window.prompt("複製以下戰績分享至社群平台：", shareText);
    }
  }

  menuSettleBtn.addEventListener("click", () => openSettlement());

  downloadSettleImgBtn.addEventListener("click", downloadSettlementImage);

  settleShareXBtn.addEventListener("click", shareToX);

  settleShareThreadsBtn.addEventListener("click", shareToThreads);

  shareSettleBtn.addEventListener("click", () => shareSettlementToSocial(shareSettleBtn));

  gameOverShareXBtn.addEventListener("click", shareToX);

  gameOverShareThreadsBtn.addEventListener("click", shareToThreads);

  gameOverShareOtherBtn.addEventListener("click", () => shareSettlementToSocial(gameOverShareOtherBtn));

  settleRestartBtn.addEventListener("click", () => {
    restartGame({ showStart: false });
  });

  if (leaderboardSubmitBtn) {
    leaderboardSubmitBtn.addEventListener("click", submitLeaderboardScore);
  }
  if (leaderboardNameInput) {
    leaderboardNameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitLeaderboardScore();
      }
    });
  }
  if (startLeaderboardRefreshBtn) {
    startLeaderboardRefreshBtn.addEventListener("click", fetchAndRenderLeaderboard);
  }
  if (settleLeaderboardRefreshBtn) {
    settleLeaderboardRefreshBtn.addEventListener("click", fetchAndRenderLeaderboard);
  }
  if (menuLeaderboardBtn) {
    menuLeaderboardBtn.addEventListener("click", () => {
      closeMenu();
      leaderboardModal.hidden = false;
      fetchAndRenderLeaderboard();
    });
  }
  if (closeLeaderboardModalBtn) {
    closeLeaderboardModalBtn.addEventListener("click", () => {
      leaderboardModal.hidden = true;
    });
  }
  if (leaderboardModal) {
    leaderboardModal.addEventListener("click", (e) => {
      if (e.target === leaderboardModal) leaderboardModal.hidden = true;
    });
  }
  if (modalLeaderboardRefreshBtn) {
    modalLeaderboardRefreshBtn.addEventListener("click", fetchAndRenderLeaderboard);
  }
  if (devOpenAdminBtn) {
    devOpenAdminBtn.addEventListener("click", openAdminModal);
  }
  if (closeAdminModalBtn) {
    closeAdminModalBtn.addEventListener("click", () => {
      adminModal.hidden = true;
    });
  }
  if (adminModal) {
    adminModal.addEventListener("click", (e) => {
      if (e.target === adminModal) adminModal.hidden = true;
    });
  }
  if (adminLoginBtn) {
    adminLoginBtn.addEventListener("click", handleAdminLogin);
  }
  if (adminPasswordInput) {
    adminPasswordInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAdminLogin();
      }
    });
  }
  if (adminLogoutBtn) {
    adminLogoutBtn.addEventListener("click", () => {
      state.adminSessionPass = null;
      renderAdminView();
    });
  }
  if (adminRefreshBtn) {
    adminRefreshBtn.addEventListener("click", loadAdminLeaderboard);
  }
  if (adminAddRowBtn) {
    adminAddRowBtn.addEventListener("click", async () => {
      if (!state.devUnlocked || !state.adminSessionPass || !supabaseClient) return;
      const rawName = (window.prompt("請輸入玩家暱稱（最多 15 字，系統自動加 #XXXX）：") || "").trim();
      if (!rawName || rawName.length > 15) return;
      const name = formatTaggedPlayerName(rawName);
      const scoreRaw = window.prompt("請輸入分數（大於等於 0 的整數）：");
      if (scoreRaw === null) return;
      const score = Math.floor(Number(scoreRaw));
      if (!Number.isFinite(score) || score < 0) return;
      const { error } = await supabaseClient
        .from("leaderboard")
        .insert([{ player_name: name, score }]);
      if (error) {
        adminActionFeedback.textContent = `⚠️ 新增失敗：${error.message}`;
        adminActionFeedback.className = "leaderboard-feedback error";
        return;
      }
      adminActionFeedback.textContent = `✅ 已新增 ${name}（${score.toLocaleString()}）`;
      adminActionFeedback.className = "leaderboard-feedback success";
      await Promise.all([loadAdminLeaderboard(), fetchAndRenderLeaderboard()]);
    });
  }
  if (adminExportCsvBtn) {
    adminExportCsvBtn.addEventListener("click", () => {
      if (!state.devUnlocked || !state.adminSessionPass) return;
      const header = "rank,id,player_name,score,created_at\n";
      const lines = state.adminCachedRows.map((r, i) => {
        const safeName = `"${String(r.player_name || "").replaceAll('"', '""')}"`;
        return `${i + 1},${r.id},${safeName},${r.score},${r.created_at || ""}`;
      });
      const blob = new Blob(["\uFEFF" + header + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `neon777-leaderboard-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
  if (adminLeaderboardList) {
    adminLeaderboardList.addEventListener("click", async (e) => {
      if (!state.devUnlocked || !state.adminSessionPass || !supabaseClient) return;
      const editBtn = e.target.closest("[data-admin-edit]");
      const delBtn = e.target.closest("[data-admin-del]");
      if (editBtn) {
        const id = Number(editBtn.dataset.adminEdit);
        const targetRow = state.adminCachedRows.find((r) => r.id === id);
        if (!targetRow) return;
        const nextName = (window.prompt("修改玩家暱稱（最多 20 字）：", targetRow.player_name) || "").trim();
        if (!nextName || nextName.length > 20) return;
        const nextScoreRaw = window.prompt("修改分數：", String(targetRow.score));
        if (nextScoreRaw === null) return;
        const nextScore = Math.floor(Number(nextScoreRaw));
        if (!Number.isFinite(nextScore) || nextScore < 0) return;
        const { error } = await supabaseClient.rpc("admin_update_leaderboard", {
          admin_pass: state.adminSessionPass,
          row_id: id,
          new_name: nextName,
          new_score: nextScore
        });
        if (error) {
          adminActionFeedback.textContent = `⚠️ 修改失敗：${error.message}（需先於 Supabase 建立管理員 RPC 函式）`;
          adminActionFeedback.className = "leaderboard-feedback error";
          return;
        }
        adminActionFeedback.textContent = `✅ 已更新 ID:${id}`;
        adminActionFeedback.className = "leaderboard-feedback success";
        await Promise.all([loadAdminLeaderboard(), fetchAndRenderLeaderboard()]);
      } else if (delBtn) {
        const id = Number(delBtn.dataset.adminDel);
        if (!window.confirm(`確定要刪除排行榜 ID:${id} 的紀錄嗎？`)) return;
        const { error } = await supabaseClient.rpc("admin_delete_leaderboard", {
          admin_pass: state.adminSessionPass,
          row_id: id
        });
        if (error) {
          adminActionFeedback.textContent = `⚠️ 刪除失敗：${error.message}（需先於 Supabase 建立管理員 RPC 函式）`;
          adminActionFeedback.className = "leaderboard-feedback error";
          return;
        }
        adminActionFeedback.textContent = `🗑️ 已刪除 ID:${id}`;
        adminActionFeedback.className = "leaderboard-feedback success";
        await Promise.all([loadAdminLeaderboard(), fetchAndRenderLeaderboard()]);
      }
    });
  }

  gameOverDisableDevRestartBtn.addEventListener("click", disableDevAndRestart);
  settleDisableDevRestartBtn.addEventListener("click", disableDevAndRestart);

  menuRestartBtn.addEventListener("click", () => {
    restartGame({ showStart: false });
  });

  if (menuDisableDevRestartBtn) {
    menuDisableDevRestartBtn.addEventListener("click", disableDevAndRestart);
  }

  menuHomeBtn.addEventListener("click", () => {
    if (anySpinning()) return;
    stopAutoAndBurst();
    openStartScreen({ canResume: state.credits > 0 });
  });

  menuPaytableBtn.addEventListener("click", () => {
    closeMenu();
    paytableModal.hidden = false;
  });

  menuChangelogBtn.addEventListener("click", () => {
    closeMenu();
    renderChangelog();
    changelogModal.hidden = false;
  });

  closeChangelogBtn.addEventListener("click", () => {
    changelogModal.hidden = true;
  });

  changelogModal.addEventListener("click", (e) => {
    if (e.target === changelogModal) changelogModal.hidden = true;
  });

  menuSecretCodeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeMenu();
    mobileCodeInput.value = "";
    mobileCodeFeedback.textContent = "";
    mobileCodeModal.hidden = false;
    setTimeout(() => mobileCodeInput.focus(), 50);
  });

  closeMobileCodeBtn.addEventListener("click", () => {
    mobileCodeModal.hidden = true;
  });

  mobileCodeModal.addEventListener("click", (e) => {
    if (e.target === mobileCodeModal) mobileCodeModal.hidden = true;
  });

  function submitMobileSecretCode() {
    const code = mobileCodeInput.value.trim().toUpperCase();
    if (!code) return;
    const matched = SECRET_CODES.find((item) => item.code === code);
    if (matched) {
      markCheatActivated();
      matched.run();
      refreshDevPanel();
      mobileCodeInput.value = "";
      mobileCodeModal.hidden = true;
    } else {
      mobileCodeFeedback.textContent = "❌ 無效的密技代碼";
    }
  }

  mobileCodeSubmitBtn.addEventListener("click", submitMobileSecretCode);

  mobileCodeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitMobileSecretCode();
    }
  });

  devMobileBigBtn.addEventListener("click", () => {
    state.devMobileBigBtn = !state.devMobileBigBtn;
    refreshDevPanel();
  });

  devMobileCompactBtn.addEventListener("click", () => {
    state.devMobileCompact = !state.devMobileCompact;
    refreshDevPanel();
  });

  devPanelBtn.addEventListener("click", () => {
    if (!state.devUnlocked) return;
    closeMenu();
    const nextHidden = !devPanelModal.hidden;
    if (!nextHidden) refreshDevPanel();
    devPanelModal.hidden = nextHidden;
  });

  closeDevPanelBtn.addEventListener("click", () => {
    devPanelModal.hidden = true;
  });

  devRefreshStatsBtn.addEventListener("click", () => {
    updateUI();
    refreshDevPanel();
  });

  devAdd10kBtn.addEventListener("click", () => {
    state.credits += 10000;
    updateUI();
    refreshDevPanel();
  });

  devAdd100kBtn.addEventListener("click", () => {
    state.credits += 100000;
    updateUI();
    refreshDevPanel();
  });

  devReset2kBtn.addEventListener("click", () => {
    state.credits = INITIAL_CREDITS;
    updateUI();
    refreshDevPanel();
  });

  devSet1Btn.addEventListener("click", () => {
    state.credits = 1;
    updateUI();
    refreshDevPanel();
  });

  devBoostUltraBtn.addEventListener("click", () => {
    state.ultraJackpot += 50000;
    updateUI();
    refreshDevPanel();
  });

  devBoostMachinesBtn.addEventListener("click", () => {
    machines.forEach((m) => {
      m.jackpot += 10000;
      m.updateJackpotUI();
    });
    refreshDevPanel();
  });

  devFastSpinBtn.addEventListener("click", () => {
    state.devFastSpin = !state.devFastSpin;
    refreshDevPanel();
  });

  devGodModeBtn.addEventListener("click", () => {
    state.devGodMode = !state.devGodMode;
    refreshDevPanel();
  });

  devBombShieldBtn.addEventListener("click", () => {
    state.devBombShield = !state.devBombShield;
    updateUI();
    refreshDevPanel();
  });

  devNoZeroEndBtn.addEventListener("click", () => {
    state.devNoZeroEnd = !state.devNoZeroEnd;
    updateUI();
    refreshDevPanel();
  });

  devAddCustomBtn.addEventListener("click", () => {
    const val = parseInt(devCustomCreditsInput.value, 10);
    if (Number.isNaN(val)) return;
    state.credits = Math.max(0, state.credits + val);
    devCustomCreditsInput.value = "";
    updateUI();
    refreshDevPanel();
  });

  devForceUnlimitBtn.addEventListener("click", () => {
    markCheatActivated();
    state.secretUnlimitPending = true;
    refreshDevPanel();
  });

  devForceSplitBlackBtn.addEventListener("click", () => {
    markCheatActivated();
    state.secretSplitBlackPending = true;
    refreshDevPanel();
  });

  devForceDoubleBlackBtn.addEventListener("click", () => {
    markCheatActivated();
    state.secretDoubleBlackPending = true;
    refreshDevPanel();
  });

  devForceFullSymbolBtn.addEventListener("click", () => {
    markCheatActivated();
    state.secretFullBoardSymbol = devFullSymbolSelect.value || "random";
    state.secretFullBoardRemaining = 1;
    refreshDevPanel();
  });

  devForceFiveFullSymbolBtn.addEventListener("click", () => {
    markCheatActivated();
    state.secretFullBoardSymbol = devFullSymbolSelect.value || "random";
    state.secretFullBoardRemaining = 5;
    refreshDevPanel();
  });

  devClearPendingBtn.addEventListener("click", () => {
    state.secretTaiwanPending = false;
    state.secretBlackPending = false;
    state.secretDoubleBlackPending = false;
    state.secretSplitBlackPending = false;
    state.secretMahjongPending = false;
    state.secretFiveSevensPending = false;
    state.secretNukePending = false;
    state.secretStarfallPending = false;
    state.secretUnlimitPending = false;
    state.secretFullBoardSymbol = null;
    state.secretFullBoardRemaining = 0;
    refreshDevPanel();
  });

  devCodesList.addEventListener("click", (e) => {
    const btn = e.target.closest(".dev-activate-btn");
    if (!btn) return;
    const entry = SECRET_CODES.find((c) => c.code === btn.dataset.code);
    if (entry) {
      markCheatActivated();
      entry.run();
      refreshDevPanel();
    }
  });

  document.addEventListener("click", (e) => {
    if (!gameMenu.hidden && !gameMenu.contains(e.target) && e.target !== menuBtn) {
      closeMenu();
    }
  });

  function syncSettingsUI() {
    if (settingSoundBtn) {
      settingSoundBtn.classList.toggle("active", state.soundEnabled);
      settingSoundBtn.textContent = state.soundEnabled ? "🔊 遊戲音效：開" : "🔇 遊戲音效：靜音";
    }
    if (settingMobileVibrateBtn) {
      settingMobileVibrateBtn.classList.toggle("active", state.devMobileVibrate);
      settingMobileVibrateBtn.textContent = state.devMobileVibrate ? "📳 手機震動：開" : "📳 手機震動：關";
    }
    if (settingGamepadRumbleBtn) {
      settingGamepadRumbleBtn.classList.toggle("active", state.gamepadRumbleEnabled);
      settingGamepadRumbleBtn.textContent = state.gamepadRumbleEnabled ? "🎮 手把震動：開" : "🎮 手把震動：關";
    }
    if (settingGamepadInputBtn) {
      settingGamepadInputBtn.classList.toggle("active", state.gamepadEnabled);
      settingGamepadInputBtn.textContent = state.gamepadEnabled ? "🕹️ 搖桿控制：開" : "🕹️ 搖桿控制：關";
    }
  }

  function detectTutorialControlMode() {
    const isXbox = Boolean(state.gamepadConnected && state.gamepadEnabled);
    const isMobile = Boolean(
      window.matchMedia && window.matchMedia("(max-width: 980px), (pointer: coarse)").matches
    );
    if (isXbox) return "xbox";
    if (isMobile) return "mobile";
    return "desktop";
  }

  function getTutorialSteps() {
    const mode = detectTutorialControlMode();
    const step1ControlTip = mode === "xbox"
      ? `<li><strong>🎮 Xbox 搖桿操作</strong>：按 <strong>A 鍵</strong> 雙機齊發（省 5%）、<strong>X / B 鍵</strong> 單轉拉機 A／B、<strong>Y 鍵</strong> 連轉 ×5（省 10%）！</li>`
      : mode === "mobile"
        ? `<li><strong>📱 手機觸控操作</strong>：點擊底部大按鈕或直接點選單台「拉桿」開轉；雙機齊發 <strong>省 5%</strong>、🔥 連轉 ×5 <strong>省 10%</strong>！</li>`
        : `<li><strong>🖥️ 鍵盤／滑鼠操作</strong>：按空白鍵（<strong>SPACE</strong>）或點擊「雙機齊發」享 <strong>95 折（省 5%）</strong>；「🔥 連轉 ×5」享 <strong>9 折（省 10%）</strong>！</li>`;

    const step2ControlTip = mode === "xbox"
      ? `<li>可用搖桿 <strong>LB / RB（或左右鍵）</strong> 快速加減注，按 <strong>LT / 上鍵</strong> 套用動態上限，按 <strong>RT / 下鍵</strong> 切換 5 種押注模式！</li>`
      : `<li>可用 <strong>− 減注</strong>、<strong>+ 加注</strong> 或 <strong>動態上限</strong> 快速調整金額，也可直接點選機台內的 <strong>ALL IN</strong> 或切換 5 種押注模式。</li>`;

    const step5ControlTip = mode === "xbox"
      ? `
        <li><strong>🎮 Xbox 搖桿專屬提示</strong>：支援雙馬達停軸／中獎震動；按 <strong>View 鍵</strong> 快速靜音、<strong>Menu 鍵</strong> 開關選單、<strong>B 鍵</strong> 關閉彈窗（在本教學中按 <strong>左右鍵</strong> 可翻頁、按 <strong>A 鍵</strong> 下一步）。</li>
        <li><strong>⚙️ 設定與選項</strong>：可在選單內開啟／關閉遊戲音效與手把震動回饋。</li>
      `
      : mode === "mobile"
        ? `
          <li><strong>📱 手機版專屬提示</strong>：頂部可點擊 <strong>⛶ 全螢幕</strong>，橫放手機支援雙機並排；選單內可透過 <strong>⚙️ 設定與選項</strong> 開關音效與手機震動回饋。</li>
          <li><strong>🔑 手機操作提示</strong>：選單內亦有手機專屬功能可隨時開啟使用。</li>
        `
        : `
          <li><strong>⚙️ 設定與選項</strong>：可在選單內開啟／關閉遊戲音效（靜音）；亦可隨時插上或藍牙配對 Xbox 搖桿自動切換成手把模式！</li>
        `;

    return [
      {
        title: "1. 雙機 16×16 盤面與基礎玩法",
        html: `
          <p>每次開局擁有 <strong>2,000 點</strong>，畫面上方為共用 <strong>ULTRA GRAND JACKPOT</strong>，下方兩台拉霸機（A／B）可獨立或同時轉動。</p>
          <ul>
            <li>每台皆為 16×16 超大盤面，<strong>橫列、直行、左右斜線</strong>出現連續 3 顆以上相同符號即可兌獎（預設上限 8 連）。</li>
            ${step1ControlTip}
          </ul>
        `
      },
      {
        title: "2. 動態押注上限與押注模式",
        html: `
          <p>為了平衡高風險與高報酬，單台最大押注會依照目前總餘額<strong>動態調整</strong>（每台最高為可用額度的 25%）。</p>
          <ul>
            ${step2ControlTip}
            <li>總控台與各機台皆支援 <strong>AUTO 自動轉</strong>，放手也能自動累積轉動！</li>
          </ul>
        `
      },
      {
        title: "3. 核心大獎符號（🇹🇼、7️⃣、🀄）",
        html: `
          <ul>
            <li><strong><img class="tw-flag-img" src="Flag_of_the_Republic_of_China.svg" alt="🇹🇼" /> 台灣之光</strong>：1 顆中該台 GRAND、2 顆分開中 GRAND+10%、<strong>2 顆相連直奪全場 ULTRA GRAND JACKPOT</strong>、3 顆再加送 GRAND 50%！</li>
            <li><strong>7️⃣ 幸運 7</strong>：5 連以上觸發該台 GRAND JACKPOT；若同輪重複觸發 JACKPOT，首個領完整獎池、其餘補發初始獎池。</li>
            <li><strong>🀄 紅中</strong>：出現即贈送大紅包（至少 1,000 點或當前動態押注上限）。</li>
          </ul>
        `
      },
      {
        title: "4. 風險符號與避險策略（💣、🎱）",
        html: `
          <ul>
            <li><strong>💣 炸彈</strong>：餘額越高炸彈出現率會漸增（最高 50%）；3 連以上會扣除<strong>當輪獲得的獎金</strong>，但<strong>絕不倒扣你的本金</strong>。</li>
            <li><strong>🎱 黑八</strong>：出現 1 顆會讓該台當輪獎金歸零；出現 <strong>2 顆分開</strong> 會留下最後 <strong>1 元</strong>；若 <strong>2 顆相連</strong> 則直接判定遊戲結束！</li>
          </ul>
        `
      },
      {
        title: "5. 全球排行榜與目前裝置操作",
        html: `
          <ul>
            <li><strong>🏆 全球排行榜</strong>：隨時可於右上角 <strong>☰ 選單</strong> 查看 TOP 10；正常遊玩結算時可輸入暱稱（自動加上 <code>#XXXX</code>）上傳搶榜（資料庫保留前 30 名）。</li>
            ${step5ControlTip}
          </ul>
        `
      }
    ];
  }

  let tutorialStepIndex = 0;

  function renderTutorialStep() {
    const mode = detectTutorialControlMode();
    const steps = getTutorialSteps();
    const step = steps[tutorialStepIndex];
    const total = steps.length;
    tutorialStepBadge.textContent = `步驟 ${tutorialStepIndex + 1} / ${total}`;
    if (tutorialDeviceBadge) {
      tutorialDeviceBadge.textContent = mode === "xbox"
        ? "🎮 偵測：Xbox 搖桿模式"
        : mode === "mobile"
          ? "📱 偵測：手機觸控模式"
          : "🖥️ 偵測：電腦模式";
    }
    tutorialBody.innerHTML = `<h3>${step.title}</h3>${step.html}`;
    tutorialDots.innerHTML = steps.map((_, idx) =>
      `<span class="tutorial-dot${idx === tutorialStepIndex ? " active" : ""}"></span>`
    ).join("");
    tutorialPrevBtn.disabled = tutorialStepIndex === 0;
    tutorialNextBtn.textContent = tutorialStepIndex === total - 1 ? "✅ 我學會了（開始遊玩）" : "下一步 ➡️";
  }

  function openTutorialModal(startIndex = 0, { enterGame = false } = {}) {
    closeMenu();
    if (enterGame && !startScreen.hidden) {
      startScreen.hidden = true;
    }
    tutorialStepIndex = Math.max(0, Math.min(4, startIndex));
    renderTutorialStep();
    tutorialModal.hidden = false;
  }

  if (startTutorialBtn) {
    startTutorialBtn.addEventListener("click", () => openTutorialModal(0, { enterGame: true }));
  }
  if (menuTutorialBtn) {
    menuTutorialBtn.addEventListener("click", () => openTutorialModal(0, { enterGame: false }));
  }
  if (closeTutorialBtn) {
    closeTutorialBtn.addEventListener("click", () => {
      tutorialModal.hidden = true;
    });
  }
  if (tutorialModal) {
    tutorialModal.addEventListener("click", (e) => {
      if (e.target === tutorialModal) tutorialModal.hidden = true;
    });
  }
  if (tutorialPrevBtn) {
    tutorialPrevBtn.addEventListener("click", () => {
      if (tutorialStepIndex > 0) {
        tutorialStepIndex -= 1;
        renderTutorialStep();
      }
    });
  }
  if (tutorialNextBtn) {
    tutorialNextBtn.addEventListener("click", () => {
      if (tutorialStepIndex < getTutorialSteps().length - 1) {
        tutorialStepIndex += 1;
        renderTutorialStep();
      } else {
        tutorialModal.hidden = true;
      }
    });
  }

  if (menuSettingsBtn) {
    menuSettingsBtn.addEventListener("click", () => {
      closeMenu();
      syncSettingsUI();
      settingsModal.hidden = false;
    });
  }
  if (closeSettingsModalBtn) {
    closeSettingsModalBtn.addEventListener("click", () => {
      settingsModal.hidden = true;
    });
  }
  if (settingsModal) {
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) settingsModal.hidden = true;
    });
  }
  if (settingSoundBtn) {
    settingSoundBtn.addEventListener("click", () => {
      state.soundEnabled = !state.soundEnabled;
      syncSettingsUI();
    });
  }
  if (settingMobileVibrateBtn) {
    settingMobileVibrateBtn.addEventListener("click", () => {
      state.devMobileVibrate = !state.devMobileVibrate;
      if (state.devMobileVibrate && navigator.vibrate) navigator.vibrate(40);
      syncSettingsUI();
      refreshDevPanel();
    });
  }
  if (settingGamepadRumbleBtn) {
    settingGamepadRumbleBtn.addEventListener("click", () => {
      state.gamepadRumbleEnabled = !state.gamepadRumbleEnabled;
      if (state.gamepadRumbleEnabled) triggerGamepadRumble(120, 0.35, 0.65);
      syncSettingsUI();
    });
  }
  if (settingGamepadInputBtn) {
    settingGamepadInputBtn.addEventListener("click", () => {
      state.gamepadEnabled = !state.gamepadEnabled;
      updateGamepadUI();
      syncSettingsUI();
    });
  }

  function updateFullscreenLabel() {
    const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    mobileFullscreenBtn.textContent = isFs ? "⛶ 退出全螢幕" : "⛶ 全螢幕";
  }

  mobileFullscreenBtn.addEventListener("click", async () => {
    const docEl = document.documentElement;
    const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    try {
      if (isFs) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } else if (docEl.requestFullscreen) {
        await docEl.requestFullscreen();
      } else if (docEl.webkitRequestFullscreen) {
        docEl.webkitRequestFullscreen();
      } else {
        window.alert("此瀏覽器不支援直接全螢幕，請使用「分享 → 加入主畫面」以全螢幕模式開啟。");
      }
    } catch (_) {
      // ignore user/browser rejection
    }
    updateFullscreenLabel();
  });

  document.addEventListener("fullscreenchange", updateFullscreenLabel);
  document.addEventListener("webkitfullscreenchange", updateFullscreenLabel);

  closePaytableBtn.addEventListener("click", () => {
    paytableModal.hidden = true;
  });

  paytableModal.addEventListener("click", (e) => {
    if (e.target === paytableModal) paytableModal.hidden = true;
  });

  let secretKeyBuffer = "";
  document.addEventListener("keydown", (e) => {
    const activeTag = document.activeElement ? document.activeElement.tagName : "";
    if (activeTag === "INPUT" || activeTag === "TEXTAREA") {
      if (e.key === "Enter") {
        document.activeElement.blur();
      }
      return;
    }

    if (e.key && e.key.length === 1 && /^[a-zA-Z]$/.test(e.key)) {
      secretKeyBuffer = (secretKeyBuffer + e.key.toUpperCase()).slice(-12);
      const matched = SECRET_CODES.find((item) => secretKeyBuffer.endsWith(item.code));
      if (matched) {
        markCheatActivated();
        matched.run();
        secretKeyBuffer = "";
        refreshDevPanel();
      }
    }

    const anyOverlayOpen =
      !startScreen.hidden ||
      !gameOverScreen.hidden ||
      !settlementScreen.hidden ||
      !mobileCodeModal.hidden ||
      !changelogModal.hidden ||
      !leaderboardModal.hidden ||
      !adminModal.hidden ||
      !gamepadModal.hidden ||
      !settingsModal.hidden ||
      !tutorialModal.hidden ||
      !paytableModal.hidden;
    if (e.code === "Space" && !anyOverlayOpen && !anyAutoActive() && !state.isSettled) {
      e.preventDefault();
      runSpin(machines);
    } else if (e.code === "Escape") {
      if (!paytableModal.hidden) paytableModal.hidden = true;
      if (!changelogModal.hidden) changelogModal.hidden = true;
      if (!leaderboardModal.hidden) leaderboardModal.hidden = true;
      if (!adminModal.hidden) adminModal.hidden = true;
      if (!gamepadModal.hidden) gamepadModal.hidden = true;
      if (!settingsModal.hidden) settingsModal.hidden = true;
      if (!tutorialModal.hidden) tutorialModal.hidden = true;
      if (!mobileCodeModal.hidden) mobileCodeModal.hidden = true;
      if (!devPanelModal.hidden) devPanelModal.hidden = true;
      if (!gameMenu.hidden) closeMenu();
    }
  });

  // Xbox / Gamepad API 相容模式輪詢與對應
  let gamepadRafId = null;
  let prevPadButtons = [];
  let prevStickDir = 0;

  function updateGamepadUI() {
    if (!navigator.getGamepads) return;
    const pads = Array.from(navigator.getGamepads()).filter((p) => p && p.connected);
    state.gamepadConnected = pads.length > 0;
    if (gamepadStatusBtn) {
      gamepadStatusBtn.classList.toggle("connected", state.gamepadConnected && state.gamepadEnabled);
      gamepadStatusBtn.textContent = state.gamepadConnected
        ? (state.gamepadEnabled ? "🎮 Xbox 已連線" : "🎮 搖桿已暫停")
        : "🎮 搖桿";
    }
    if (gamepadModalStatus) {
      gamepadModalStatus.textContent = state.gamepadConnected
        ? `已連線：${pads[0].id}`
        : "請透過藍牙或 USB 連接 Xbox 搖桿後，按下手把任意鍵自動啟用。";
    }
    if (gamepadToggleBtn) {
      gamepadToggleBtn.classList.toggle("active", state.gamepadEnabled);
      gamepadToggleBtn.textContent = state.gamepadEnabled ? "🎮 搖桿控制：開" : "🎮 搖桿控制：關";
    }
    if (!tutorialModal.hidden) {
      renderTutorialStep();
    }
  }

  function closeTopmostModalForPad() {
    if (!tutorialModal.hidden) { tutorialModal.hidden = true; return true; }
    if (!settingsModal.hidden) { settingsModal.hidden = true; return true; }
    if (!gamepadModal.hidden) { gamepadModal.hidden = true; return true; }
    if (!paytableModal.hidden) { paytableModal.hidden = true; return true; }
    if (!changelogModal.hidden) { changelogModal.hidden = true; return true; }
    if (!leaderboardModal.hidden) { leaderboardModal.hidden = true; return true; }
    if (!mobileCodeModal.hidden) { mobileCodeModal.hidden = true; return true; }
    if (!adminModal.hidden) { adminModal.hidden = true; return true; }
    if (!gameMenu.hidden) { closeMenu(); return true; }
    return false;
  }

  function handleGamepadAction(btnIdx) {
    if (!state.gamepadEnabled) return;
    if (!tutorialModal.hidden) {
      if (btnIdx === 0) { tutorialNextBtn.click(); return; }
      if (btnIdx === 1) { tutorialModal.hidden = true; return; }
      if (btnIdx === 4 || btnIdx === 14) { tutorialPrevBtn.click(); return; }
      if (btnIdx === 5 || btnIdx === 15) { tutorialNextBtn.click(); return; }
      return;
    }
    // A 鍵 (0)：處理 Overlay 主按鈕或雙機齊發
    if (btnIdx === 0) {
      if (!startScreen.hidden) { startGameBtn.click(); return; }
      if (!gameOverScreen.hidden) { gameOverRestartBtn.click(); return; }
      if (!settlementScreen.hidden) { settleRestartBtn.click(); return; }
      if (!anyAutoActive() && !state.isSettled) runSpin(machines);
      return;
    }
    // B 鍵 (1)：優先關閉開啟中的彈窗，否則單轉拉機 B
    if (btnIdx === 1) {
      if (closeTopmostModalForPad()) return;
      if (startScreen.hidden && gameOverScreen.hidden && settlementScreen.hidden && !anyAutoActive() && !state.isSettled) {
        runSpin([machines[1]]);
      }
      return;
    }
    if (!startScreen.hidden || !gameOverScreen.hidden || !settlementScreen.hidden) return;

    if (btnIdx === 2) {
      if (!anyAutoActive() && !state.isSettled) runSpin([machines[0]]); // X: 拉機 A
    } else if (btnIdx === 3) {
      if (!anySpinning() && !state.isSettled) burstSpinBtn.click(); // Y: 連轉 ×5
    } else if (btnIdx === 4 || btnIdx === 14) {
      betDownBtn.click(); // LB / 左: 減注
    } else if (btnIdx === 5 || btnIdx === 15) {
      betUpBtn.click(); // RB / 右: 加注
    } else if (btnIdx === 6 || btnIdx === 12) {
      maxBetBtn.click(); // LT / 上: 動態上限
    } else if (btnIdx === 7 || btnIdx === 13) {
      const modeList = Array.from(betModeBtns);
      const curIdx = modeList.findIndex((b) => b.classList.contains("active"));
      const nextBtn = modeList[(curIdx + 1) % modeList.length];
      if (nextBtn) nextBtn.click(); // RT / 下: 切換押注模式
    } else if (btnIdx === 8) {
      state.soundEnabled = !state.soundEnabled;
      syncSettingsUI(); // View: 音效開關
    } else if (btnIdx === 9) {
      menuBtn.click(); // Menu: 開關選單
    }
  }

  function pollGamepads() {
    if (!navigator.getGamepads) {
      gamepadRafId = null;
      return;
    }
    const pads = Array.from(navigator.getGamepads()).filter((p) => p && p.connected);
    if (pads.length === 0) {
      state.gamepadConnected = false;
      updateGamepadUI();
      gamepadRafId = null;
      return;
    }

    const pad = pads[0];
    if (!state.gamepadConnected) updateGamepadUI();

    pad.buttons.forEach((btn, idx) => {
      const pressed = Boolean(btn && btn.pressed);
      if (pressed && !prevPadButtons[idx]) {
        handleGamepadAction(idx);
      }
      prevPadButtons[idx] = pressed;
    });

    const axisX = pad.axes && pad.axes.length > 0 ? pad.axes[0] : 0;
    const stickDir = axisX < -0.55 ? -1 : axisX > 0.55 ? 1 : 0;
    if (stickDir !== 0 && stickDir !== prevStickDir && state.gamepadEnabled) {
      if (stickDir < 0) betDownBtn.click();
      else betUpBtn.click();
    }
    prevStickDir = stickDir;

    gamepadRafId = window.requestAnimationFrame(pollGamepads);
  }

  function startGamepadPolling() {
    updateGamepadUI();
    if (!gamepadRafId) {
      gamepadRafId = window.requestAnimationFrame(pollGamepads);
    }
  }

  window.addEventListener("gamepadconnected", () => {
    startGamepadPolling();
    triggerGamepadRumble(100, 0.3, 0.5);
  });

  window.addEventListener("gamepaddisconnected", () => {
    prevPadButtons = [];
    prevStickDir = 0;
    updateGamepadUI();
  });

  if (gamepadStatusBtn) {
    gamepadStatusBtn.addEventListener("click", () => {
      updateGamepadUI();
      gamepadModal.hidden = false;
    });
  }
  if (closeGamepadModalBtn) {
    closeGamepadModalBtn.addEventListener("click", () => {
      gamepadModal.hidden = true;
    });
  }
  if (gamepadModal) {
    gamepadModal.addEventListener("click", (e) => {
      if (e.target === gamepadModal) gamepadModal.hidden = true;
    });
  }
  if (gamepadToggleBtn) {
    gamepadToggleBtn.addEventListener("click", () => {
      state.gamepadEnabled = !state.gamepadEnabled;
      updateGamepadUI();
      syncSettingsUI();
    });
  }
  if (gamepadTestRumbleBtn) {
    gamepadTestRumbleBtn.addEventListener("click", () => {
      triggerGamepadRumble(160, 0.45, 0.85);
    });
  }

  // 初始化
  const appVersionEl = document.getElementById("appVersionText");
  const startVersionEl = document.getElementById("startVersionText");
  if (appVersionEl) appVersionEl.textContent = `v${APP_VERSION}`;
  if (startVersionEl) startVersionEl.textContent = `v${APP_VERSION}`;
  renderStartLatestUpdates();
  renderPaytable();
  updateUI();
  fetchAndRenderLeaderboard();
  if (navigator.getGamepads && Array.from(navigator.getGamepads()).some((p) => p && p.connected)) {
    startGamepadPolling();
  }
})();
