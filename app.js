(() => {
  const APP_VERSION = "26.01.017"; // 格式：年.大版本.小版本 (00.00.000)
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

  const TW_FLAG_HTML = `<img class="tw-flag-svg" src="Flag_of_the_Republic_of_China.svg" alt="🇹🇼" draggable="false" />`;

  function renderSymbolIcon(sym) {
    return sym.id === "tw" ? TW_FLAG_HTML : sym.icon;
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

  function getSymbolWeight(sym, { applySecretBurst = false } = {}) {
    let w = sym.id === "bomb" ? getDynamicBombWeight() : sym.weight;
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
    secretMahjongPending: false,
    secretFiveSevensPending: false,
    secretNukePending: false,
    devFastSpin: false,
    devGodMode: false,
    devBombShield: false,
    devMobileVibrate: true,
    devMobileBigBtn: false,
    devMobileCompact: false,
    devUnlocked: false,
    soundEnabled: true
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
  const soundToggleBtn = document.getElementById("soundToggle");

  const paytableModal = document.getElementById("paytableModal");
  const closePaytableBtn = document.getElementById("closePaytableBtn");
  const paytableBody = document.getElementById("paytableBody");

  const startScreen = document.getElementById("startScreen");
  const resumeGameBtn = document.getElementById("resumeGameBtn");
  const startGameBtn = document.getElementById("startGameBtn");
  const gameOverScreen = document.getElementById("gameOverScreen");
  const gameOverStats = document.getElementById("gameOverStats");
  const gameOverShareXBtn = document.getElementById("gameOverShareXBtn");
  const gameOverShareThreadsBtn = document.getElementById("gameOverShareThreadsBtn");
  const gameOverShareOtherBtn = document.getElementById("gameOverShareOtherBtn");
  const gameOverRestartBtn = document.getElementById("gameOverRestartBtn");
  const gameOverHomeBtn = document.getElementById("gameOverHomeBtn");

  const menuBtn = document.getElementById("menuBtn");
  const gameMenu = document.getElementById("gameMenu");
  const menuSettleBtn = document.getElementById("menuSettleBtn");
  const menuRestartBtn = document.getElementById("menuRestartBtn");
  const menuHomeBtn = document.getElementById("menuHomeBtn");
  const menuPaytableBtn = document.getElementById("menuPaytableBtn");
  const menuSecretCodeBtn = document.getElementById("menuSecretCodeBtn");
  const mobileFullscreenBtn = document.getElementById("mobileFullscreenBtn");
  const devPanelBtn = document.getElementById("devPanelBtn");

  const mobileCodeModal = document.getElementById("mobileCodeModal");
  const closeMobileCodeBtn = document.getElementById("closeMobileCodeBtn");
  const mobileCodeInput = document.getElementById("mobileCodeInput");
  const mobileCodeSubmitBtn = document.getElementById("mobileCodeSubmitBtn");
  const mobileCodeFeedback = document.getElementById("mobileCodeFeedback");

  const devMobileVibrateBtn = document.getElementById("devMobileVibrateBtn");
  const devMobileBigBtn = document.getElementById("devMobileBigBtn");
  const devMobileCompactBtn = document.getElementById("devMobileCompactBtn");

  const settlementScreen = document.getElementById("settlementScreen");
  const settleTitle = document.getElementById("settleTitle");
  const settleStatsGrid = document.getElementById("settleStatsGrid");
  const downloadSettleImgBtn = document.getElementById("downloadSettleImgBtn");
  const shareXBtn = document.getElementById("shareXBtn");
  const shareThreadsBtn = document.getElementById("shareThreadsBtn");
  const shareSettleBtn = document.getElementById("shareSettleBtn");
  const settleRestartBtn = document.getElementById("settleRestartBtn");

  const devPanelModal = document.getElementById("devPanelModal");
  const closeDevPanelBtn = document.getElementById("closeDevPanelBtn");
  const devStatsBox = document.getElementById("devStatsBox");
  const devAdd10kBtn = document.getElementById("devAdd10kBtn");
  const devAdd100kBtn = document.getElementById("devAdd100kBtn");
  const devReset2kBtn = document.getElementById("devReset2kBtn");
  const devSet1Btn = document.getElementById("devSet1Btn");
  const devBoostUltraBtn = document.getElementById("devBoostUltraBtn");
  const devBoostMachinesBtn = document.getElementById("devBoostMachinesBtn");
  const devFastSpinBtn = document.getElementById("devFastSpinBtn");
  const devGodModeBtn = document.getElementById("devGodModeBtn");
  const devBombShieldBtn = document.getElementById("devBombShieldBtn");
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
    return Math.min(CONNECT_STEP_MS, Math.max(12, Math.floor(CONNECT_MAX_DELAY_MS / cellCount)));
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
  function scanLine(cols, startC, startR, dc, dr, bet, acc) {
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
        const cappedRun = Math.min(runLen, MAX_CHAIN_CAP);
        const mult = sym.baseMult * Math.pow(2, cappedRun - 3);
        const amount = Math.max(1, Math.round(bet * mult));

        if (sym.isPenalty) {
          acc.bombCount += 1;
          acc.penalty += amount;
          for (let k = 0; k < runLen; k++) {
            const key = `${c + dc * k}-${r + dr * k}`;
            if (!acc.bombCells.has(key)) {
              acc.bombCells.set(key, acc.bombOrder++);
            }
          }
        } else {
          acc.lineCount += 1;
          acc.grossWin += amount;
          for (let k = 0; k < runLen; k++) {
            const key = `${c + dc * k}-${r + dr * k}`;
            if (!acc.winCells.has(key)) {
              acc.winCells.set(key, acc.winOrder++);
            }
          }
          if (sym.id === "seven" && cappedRun >= 5) {
            acc.isJackpot = true;
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

  function evaluateGrid(cols, bet, machineJackpot) {
    const acc = {
      grossWin: 0,
      penalty: 0,
      isJackpot: false,
      isUltraJackpot: false,
      voidedByEightBall: false,
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

    // 先檢查盤面上是否出現 🎱（失去本台該局所有獎金，但不會影響獎池與餘額）、🇹🇼 與 🀄
    const bonusPerMahjong = Math.max(1000, getDynamicMaxBet(machines.length));
    const twPositions = [];
    for (let c = 0; c < GRID_COLS; c++) {
      for (let r = 0; r < GRID_ROWS; r++) {
        const cellSym = cols[c][r];
        if (cellSym.id === "eightball") {
          acc.eightBallCount += 1;
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

    for (let r = 0; r < GRID_ROWS; r++) scanLine(cols, 0, r, 1, 0, bet, acc);
    for (let c = 0; c < GRID_COLS; c++) scanLine(cols, c, 0, 0, 1, bet, acc);
    for (let c = 0; c < GRID_COLS; c++) scanLine(cols, c, 0, 1, 1, bet, acc);
    for (let r = 1; r < GRID_ROWS; r++) scanLine(cols, 0, r, 1, 1, bet, acc);
    for (let c = 0; c < GRID_COLS; c++) scanLine(cols, c, 0, -1, 1, bet, acc);
    for (let r = 1; r < GRID_ROWS; r++) scanLine(cols, GRID_COLS - 1, r, -1, 1, bet, acc);

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
      acc.grossWin = Math.max(acc.grossWin, machineJackpot);
    }

    // 炸彈只會扣除本局賺到的獎金，不會倒扣玩家持有的本金；若開啟炸彈護盾則免疫炸彈扣分
    if (state.devBombShield) {
      acc.penalty = 0;
    }
    let netResult = Math.max(0, acc.grossWin - acc.penalty);
    if (acc.eightBallCount > 0 && !state.devGodMode) {
      acc.voidedByEightBall = true;
      acc.instantGameOver = acc.eightBallCount >= 2;
      acc.isJackpot = false;
      acc.isUltraJackpot = false;
      acc.winCells.clear();
      acc.specialCells.clear();
      netResult = 0;
    }

    let label = "再接再厲，下一轉會更好！";
    let mode = "normal";

    if (acc.instantGameOver) {
      label = `🎱🎱 雙黑八降臨（${acc.eightBallCount} 顆）！直接判定遊戲結束！`;
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
      label = `🎉 GRAND JACKPOT！${acc.bestCombo.runLen} 連 ${acc.bestCombo.sym.name}`;
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
        statusEl.textContent = msg;
        statusEl.className = "status-banner";
        if (mode !== "normal") statusEl.classList.add(mode);
      },

      renderStatic(winCells = new Map(), bombCells = new Map(), specialCells = new Set(), voidCells = new Set()) {
        const winStep = getConnectStepMs(winCells.size);
        const bombStep = getConnectStepMs(bombCells.size);
        reelStrips.forEach((strip, colIdx) => {
          strip.style.transition = "none";
          strip.style.transform = "translateY(0)";
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

      spinOne(bet, staggerOffsetMs = 0, prebuiltCols = null) {
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
            strip.style.transform = "translateY(0)";
            strip.innerHTML = items.map((s) => `<div class="symbol-cell">${renderSymbolIcon(s)}</div>`).join("");
            void strip.offsetHeight;

            winBox.classList.add("spinning");
            const targetY = -((items.length - GRID_ROWS) * symbolH);
            strip.style.transition = `transform ${duration}ms cubic-bezier(0.12, 0.92, 0.24, 1.06)`;
            strip.style.transform = `translateY(${targetY}px)`;

            setTimeout(() => {
              winBox.classList.remove("spinning");
              winBox.classList.remove("reel-thud");
              void winBox.offsetWidth;
              winBox.classList.add("reel-thud");
              playStopSound(colIdx);
              resolve();
            }, duration);
          });
        });

        return Promise.all(animPromises).then(() => {
          machine.currentCols = nextCols;
          const result = evaluateGrid(nextCols, bet, machine.jackpot);
          machine.renderStatic(result.winCells, result.bombCells, result.specialCells, result.voidCells);

          // 畫面色塊跳出與「答答答」連線音效完全同步觸發
          if (result.winCells.size > 0) {
            playConnectDaDaDaSound(result.winCells.size);
          }
          if (result.voidedByEightBall) {
            eightBallLayerEl.innerHTML = `<div class="eightball-drop">🎱</div>`;
            playEightBallDropSound();
            setTimeout(() => {
              eightBallLayerEl.innerHTML = "";
            }, 1800);
          }
          if (result.isJackpot) {
            machine.jackpot = machine.initialJackpot;
            machine.updateJackpotUI();
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

    const minDualNeed = isDualAllIn ? 2 : isSingleAllInAny ? 1 : dualCost;
    spinAllBtn.disabled = spinning || autoLocked || state.credits < minDualNeed || (!isSingleAllInAny && !isDualAllIn && rawDualSum <= 0);
    burstSpinBtn.disabled = spinning || autoLocked || isSingleAllInAny || isDualAllIn || state.credits < burstCost || rawDualSum <= 0;
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
      m.miniSpinBtn.disabled = anyAllInMode || disabledBySingleAllIn || m.isSpinning || m.autoSpin || state.autoSpin || state.autoSpinPendingDual || state.credits < singleBet || singleBet <= 0;
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
      desc: "下一轉拉機 A 出現 2 顆 🎱（觸發即死）",
      run: () => { state.secretDoubleBlackPending = true; }
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
      code: "SUPERHERO",
      desc: "解鎖並開啟開發人員面板",
      hideActivate: true,
      run: () => { unlockDevPanel(); }
    }
  ];

  function renderDevCodesList() {
    devCodesList.innerHTML = SECRET_CODES.map((item) => `
      <div class="dev-code-row">
        <div class="dev-code-info">
          <span class="dev-code-key">${item.code}</span>
          <span class="dev-code-desc">${item.desc}</span>
        </div>
        ${item.hideActivate ? "" : `<button class="ctrl-btn dev-activate-btn" type="button" data-code="${item.code}">⚡ 激活</button>`}
      </div>
    `).join("");
  }

  function refreshDevPanel() {
    if (!state.devUnlocked) return;
    const pendingList = [
      state.secretTaiwanPending && "🇹🇼 雙國旗相連",
      state.secretMahjongPending && "🀄 必出紅中",
      state.secretFiveSevensPending && "7️⃣ 5連7",
      state.secretNukePending && "💣 炸彈連線",
      state.secretBlackPending && "🎱 雙機各1黑八",
      state.secretDoubleBlackPending && "🎱🎱 單台2黑八"
    ].filter(Boolean);

    devStatsBox.innerHTML = `
      餘額：<strong>${state.credits.toLocaleString()}</strong> ｜ 動態押注上限：<strong>${getDynamicMaxBet(machines.length)}</strong><br>
      💣 炸彈權重：<strong>${getDynamicBombWeight()}</strong>（${getBombRatePercent()}%）<br>
      下一轉強制項目：<strong>${pendingList.length ? pendingList.join("、") : "無"}</strong>
    `;

    devFastSpinBtn.classList.toggle("active", state.devFastSpin);
    devFastSpinBtn.textContent = state.devFastSpin ? "⚡ 極速轉輪：開" : "⚡ 極速轉輪：關";
    devGodModeBtn.classList.toggle("active", state.devGodMode);
    devGodModeBtn.textContent = state.devGodMode ? "🛡️ 防黑八護盾：開" : "🛡️ 防黑八護盾：關";
    devBombShieldBtn.classList.toggle("active", state.devBombShield);
    devBombShieldBtn.textContent = state.devBombShield ? "🛡️ 炸彈護盾：開" : "🛡️ 炸彈護盾：關";
    devMobileVibrateBtn.classList.toggle("active", state.devMobileVibrate);
    devMobileVibrateBtn.textContent = state.devMobileVibrate ? "📳 震動回饋：開" : "📳 震動回饋：關";
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

  function checkGameOver(instantReason = null) {
    if (!anySpinning() && (state.credits <= 0 || instantReason)) {
      stopAutoAndBurst();
      const baseText = instantReason || `本局共進行 ${state.spinCount} 輪轉動，餘額已歸零。`;
      gameOverStats.innerHTML = `${baseText}<br>曾經賺過的最高餘額：<strong>${state.peakCredits.toLocaleString()}</strong> 點｜累計總贏分：<strong>${state.totalGrossWon.toLocaleString()}</strong> 點`;
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

  function openSettlement(customTitle = "本局結算報告") {
    if (anySpinning()) return;
    stopAutoAndBurst();
    closeMenu();
    state.isSettled = true;
    settleTitle.textContent = customTitle;
    const rows = getSettlementRows();
    settleStatsGrid.innerHTML = rows.map((r) => `
      <div class="settle-stat-item">
        <span class="settle-stat-label">${r.label}</span>
        <span class="settle-stat-val">${r.value}</span>
      </div>
    `).join("");
    settlementScreen.hidden = false;
    updateUI();
  }

  function checkMaxWinEnding() {
    if (!anySpinning() && state.credits >= MAX_WIN_CREDITS) {
      openSettlement("🏆 達成 3,000,000,000,000,000 傳說通關！");
      return true;
    }
    return false;
  }

  function downloadSettlementImage() {
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

    if (machineBets.some((b) => b <= 0) || state.credits < totalBet) {
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
    state.totalBetSpent += totalBet;
    showSpendTag(totalBet);
    if (!state.isBurstSession) {
      state.lastNetWin = 0;
    }
    state.spinCount += 1;
    // 任意一台開賭時都會累積全場共用的超終極大獎獎池
    state.ultraJackpot += Math.max(10, Math.round(totalBet * 0.3));

    startSpinLoopSound();
    updateUI();

    // 預先生成各台盤面，並強制保證兩台不可能同時各出現 2 顆 🇹🇼
    const triggerSecretTaiwan = state.secretTaiwanPending;
    const triggerSecretBlack = state.secretBlackPending;
    const triggerDoubleBlack = state.secretDoubleBlackPending;
    const triggerMahjong = state.secretMahjongPending;
    const triggerFiveSevens = state.secretFiveSevensPending;
    const triggerNuke = state.secretNukePending;
    state.secretTaiwanPending = false;
    state.secretBlackPending = false;
    state.secretDoubleBlackPending = false;
    state.secretMahjongPending = false;
    state.secretFiveSevensPending = false;
    state.secretNukePending = false;

    let alreadyHasTwoTw = false;
    const preparedBoards = targetMachines.map((_, idx) => {
      const board = enforceExclusiveJackpot(
        Array.from({ length: GRID_COLS }, () => createRandomCol()),
        alreadyHasTwoTw ? 1 : 3
      );

      // 額外降低自然開局同時出現 2 顆以上 🎱 的機率（85% 機率只保留第 1 顆 🎱）
      if (!triggerDoubleBlack) {
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
        board[2][3] = eightSym;
        board[10][11] = eightSym;
      }

      if (triggerNuke && idx === 0 && !state.devBombShield) {
        const bombSym = SYMBOLS.find((s) => s.id === "bomb");
        const r = Math.floor(Math.random() * GRID_ROWS);
        for (let k = 0; k < 6; k++) {
          board[3 + k][r] = bombSym;
        }
      }

      if (countTw(board) >= 2) {
        alreadyHasTwoTw = true;
      }
      return board;
    });

    const results = await Promise.all(
      targetMachines.map((m, idx) => m.spinOne(machineBets[idx], idx * 160, preparedBoards[idx]))
    );
    state.activeSpinBombWeight = null;
    stopSpinLoopSound();

    const validResults = results.filter(Boolean);
    const combinedNet = validResults.reduce((sum, r) => sum + r.netResult, 0);
    const anyUltraJackpot = validResults.some((r) => r.isUltraJackpot);
    const anyJackpot = validResults.some((r) => r.isJackpot);
    const anyMahjong = validResults.some((r) => r.mahjongCount > 0);
    const anyBomb = validResults.some((r) => r.bombCount > 0);
    const anyInstantGameOver = validResults.some((r) => r.instantGameOver);
    const totalLines = validResults.reduce((sum, r) => sum + r.lineCount, 0);
    const maxWinCells = validResults.reduce((max, r) => Math.max(max, r.winCells.size), 0);

    state.totalGrossWon += combinedNet;
    state.maxSingleWin = Math.max(state.maxSingleWin, combinedNet);
    state.jackpotHits += validResults.filter((r) => r.isJackpot && !r.isUltraJackpot).length;
    state.ultraHits += validResults.filter((r) => r.isUltraJackpot).length;
    state.mahjongHits += validResults.reduce((sum, r) => sum + r.mahjongCount, 0);
    state.eightBallHits += validResults.reduce((sum, r) => sum + r.eightBallCount, 0);

    if (anyUltraJackpot) {
      state.ultraJackpot = INITIAL_ULTRA_JACKPOT;
    }

    if (state.isBurstSession) {
      state.lastNetWin += combinedNet;
    } else {
      state.credits = Math.max(0, state.credits + combinedNet);
      state.peakCredits = Math.max(state.peakCredits, state.credits);
      state.lastNetWin = combinedNet;
    }

    if (maxWinCells > 0 && state.devMobileVibrate && navigator.vibrate) {
      navigator.vibrate(anyJackpot || anyUltraJackpot ? [60, 40, 120] : 40);
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
      state.credits = Math.max(0, state.credits + state.lastNetWin);
      state.peakCredits = Math.max(state.peakCredits, state.credits);
      state.maxSingleWin = Math.max(state.maxSingleWin, state.lastNetWin);
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
      checkGameOver(`本局共進行 ${state.spinCount} 輪，因單台同時出現 2 顆 🎱 黑八直接判定遊戲結束！`);
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
          ? `1顆失去該台獎金（獎池與餘額保留）；單台出現 2 顆直接遊戲結束`
          : s.isSpecial
            ? `極稀有！出現即送 max(1,000, 當前押注上限)`
            : s.isPenalty
              ? `懲罰：3連 −×${m3} ～ ${MAX_CHAIN_CAP}連 −×${m8}`
              : `3連 ×${m3} / 5連 ×${m5} / ${MAX_CHAIN_CAP}連(上限) ×${m8}`;
      const comboText = (s.isSpecial || s.isTopJackpot || s.isVoid) ? renderSymbolIcon(s) : `${s.icon} ${s.icon} ${s.icon}`;
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
    updateUI();
  });

  betUpBtn.addEventListener("click", () => {
    const maxBet = getDynamicMaxBet(machines.length);
    const step = getBetStep(maxBet);
    machines.forEach((m) => {
      m.bet = clampBetValue(m.bet + step);
    });
    updateUI();
  });

  maxBetBtn.addEventListener("click", () => {
    const maxBet = getDynamicMaxBet(machines.length);
    machines.forEach((m) => {
      m.bet = maxBet;
    });
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

  shareXBtn.addEventListener("click", shareToX);

  shareThreadsBtn.addEventListener("click", shareToThreads);

  shareSettleBtn.addEventListener("click", () => shareSettlementToSocial(shareSettleBtn));

  gameOverShareXBtn.addEventListener("click", shareToX);

  gameOverShareThreadsBtn.addEventListener("click", shareToThreads);

  gameOverShareOtherBtn.addEventListener("click", () => shareSettlementToSocial(gameOverShareOtherBtn));

  settleRestartBtn.addEventListener("click", () => {
    restartGame({ showStart: false });
  });

  menuRestartBtn.addEventListener("click", () => {
    restartGame({ showStart: false });
  });

  menuHomeBtn.addEventListener("click", () => {
    if (anySpinning()) return;
    stopAutoAndBurst();
    openStartScreen({ canResume: state.credits > 0 });
  });

  menuPaytableBtn.addEventListener("click", () => {
    closeMenu();
    paytableModal.hidden = false;
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

  devMobileVibrateBtn.addEventListener("click", () => {
    state.devMobileVibrate = !state.devMobileVibrate;
    if (state.devMobileVibrate && navigator.vibrate) navigator.vibrate(50);
    refreshDevPanel();
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

  devClearPendingBtn.addEventListener("click", () => {
    state.secretTaiwanPending = false;
    state.secretBlackPending = false;
    state.secretDoubleBlackPending = false;
    state.secretMahjongPending = false;
    state.secretFiveSevensPending = false;
    state.secretNukePending = false;
    refreshDevPanel();
  });

  devCodesList.addEventListener("click", (e) => {
    const btn = e.target.closest(".dev-activate-btn");
    if (!btn) return;
    const entry = SECRET_CODES.find((c) => c.code === btn.dataset.code);
    if (entry) {
      entry.run();
      refreshDevPanel();
    }
  });

  document.addEventListener("click", (e) => {
    if (!gameMenu.hidden && !gameMenu.contains(e.target) && e.target !== menuBtn) {
      closeMenu();
    }
  });

  soundToggleBtn.addEventListener("click", () => {
    state.soundEnabled = !state.soundEnabled;
    soundToggleBtn.textContent = state.soundEnabled ? "🔊 音效開" : "🔇 靜音";
  });

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
      !paytableModal.hidden;
    if (e.code === "Space" && !anyOverlayOpen && !anyAutoActive() && !state.isSettled) {
      e.preventDefault();
      runSpin(machines);
    } else if (e.code === "Escape") {
      if (!paytableModal.hidden) paytableModal.hidden = true;
      if (!mobileCodeModal.hidden) mobileCodeModal.hidden = true;
      if (!devPanelModal.hidden) devPanelModal.hidden = true;
      if (!gameMenu.hidden) closeMenu();
    }
  });

  // 初始化
  const appVersionEl = document.getElementById("appVersionText");
  const startVersionEl = document.getElementById("startVersionText");
  if (appVersionEl) appVersionEl.textContent = `v${APP_VERSION}`;
  if (startVersionEl) startVersionEl.textContent = `v${APP_VERSION}`;
  renderPaytable();
  updateUI();
})();
