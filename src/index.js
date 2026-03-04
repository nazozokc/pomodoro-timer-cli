#!/usr/bin/env node

import { select, input } from '@inquirer/prompts';
import logUpdate from 'log-update';
import consola from 'consola';

let WORK_TIME = 25 * 60;
let SHORT_BREAK = 5 * 60;
let LONG_BREAK = 15 * 60;
const SESSIONS_BEFORE_LONG_BREAK = 4;

const STATE = {
  IDLE: 'idle',
  WORKING: 'working',
  BREAK: 'break',
};

let timerState = {
  state: STATE.IDLE,
  remaining: WORK_TIME,
  session: 1,
  totalSessions: SESSIONS_BEFORE_LONG_BREAK,
  isPaused: false,
};

// ── ANSI helpers ─────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  white: '\x1b[97m',
};

// logUpdate.clear() してから consola を呼ぶラッパー
// → ボックスが残ったまま新行が追加される問題を防ぐ
function log(type, msg) {
  logUpdate.clear();
  consola[type](msg);
}

// ── 文字幅計算（絵文字=2, 通常=1）────────────────────────
function displayWidth(str) {
  const plain = str.replace(/\x1b\[[0-9;]*m/g, '');
  let width = 0;
  for (const ch of plain) {
    const cp = ch.codePointAt(0);
    if (
      (cp >= 0x1F000 && cp <= 0x1FFFF) ||
      (cp >= 0x2600 && cp <= 0x27BF) ||
      (cp >= 0x3000 && cp <= 0x9FFF) ||
      (cp >= 0xF900 && cp <= 0xFAFF) ||
      (cp >= 0xFE30 && cp <= 0xFE4F) ||
      (cp >= 0xFF00 && cp <= 0xFF60)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

function padDisplay(str, len, char = ' ') {
  const pad = Math.max(0, len - displayWidth(str));
  return str + char.repeat(pad);
}

// ── タイマー表示 ──────────────────────────────────────────
function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function getProgressBar(remaining, total, width = 22) {
  const ratio = Math.max(0, Math.min(1, (total - remaining) / total));
  const filled = Math.floor(ratio * width);
  const empty = width - filled;
  return `${c.green}${'█'.repeat(filled)}${c.reset}${c.dim}${'░'.repeat(empty)}${c.reset}`;
}

function renderTimer() {
  const { state, remaining, session, totalSessions, isPaused } = timerState;

  let stateLabel, accentColor, totalTime;
  switch (state) {
    case STATE.WORKING:
      stateLabel = `作業中 🍅`;
      accentColor = c.red;
      totalTime = WORK_TIME;
      break;
    case STATE.BREAK:
      stateLabel = `休憩中 ☕`;
      accentColor = c.green;
      totalTime = remaining <= SHORT_BREAK ? SHORT_BREAK : LONG_BREAK;
      break;
    default:
      stateLabel = `待機中 💤`;
      accentColor = c.cyan;
      totalTime = WORK_TIME;
  }

  // ボックス内の表示幅（「│ 」「 │」を除いた幅）
  const W = 31;

  const timeStr = `${c.bold}${accentColor}${formatTime(remaining)}${c.reset}`;
  const sessionStr = state !== STATE.IDLE
    ? `${c.dim}${session} / ${totalSessions}${c.reset}`
    : `${c.dim}─ / ─${c.reset}`;
  const pauseStr = isPaused ? `  ${c.yellow}⏸ 一時停止${c.reset}` : '';

  const bar = getProgressBar(remaining, totalTime);

  // タイトルをセンタリング
  const titleRaw = `🍅  Pomodoro Timer  🍅`;
  const titlePad = Math.max(0, Math.floor((W - displayWidth(titleRaw)) / 2));
  const titleLine = ' '.repeat(titlePad) + `${c.bold}${c.white}${titleRaw}${c.reset}`;

  const border = '─'.repeat(W + 2);
  const top = ` ╭${border}╮`;
  const sep = ` ├${border}┤`;
  const bot = ` ╰${border}╯`;
  const empty = ` │ ${' '.repeat(W)} │`;

  const row = (inner) => ` │ ${padDisplay(inner, W)} │`;

  const rows = [
    '',
    top,
    row(titleLine),
    sep,
    empty,
    row(`  ${timeStr}    ${sessionStr}${pauseStr}`),
    row(`  ${bar}`),
    row(`  ${stateLabel}`),
    empty,
    bot,
    '',
  ];

  logUpdate(rows.join('\n'));
}

// ── タイマーロジック ──────────────────────────────────────
async function tick() {
  if (timerState.state === STATE.IDLE || timerState.isPaused) return;

  timerState.remaining--;
  renderTimer();

  if (timerState.remaining <= 0) {
    await handleTimerComplete();
  }
}

async function handleTimerComplete() {
  const wasWorking = timerState.state === STATE.WORKING;

  if (wasWorking) {
    if (timerState.session >= SESSIONS_BEFORE_LONG_BREAK) {
      timerState.state = STATE.BREAK;
      timerState.remaining = LONG_BREAK;
      log('success', '🎉 4セッション完了！長い休憩に入りましょう (15分)');
      timerState.session = 1;
    } else {
      timerState.state = STATE.BREAK;
      timerState.remaining = SHORT_BREAK;
      log('success', `🍅 セッション${timerState.session}完了！休憩しましょう (5分)`);
      timerState.isPaused = false;
    }
  } else {
    if (timerState.remaining === LONG_BREAK) {
      log('success', '長い休憩終了！新しいポモドーロを始めましょう');
      timerState.state = STATE.IDLE;
      timerState.isPaused = false;
    } else {
      if (timerState.session < SESSIONS_BEFORE_LONG_BREAK) {
        timerState.session++;
      }
      timerState.state = STATE.WORKING;
      timerState.remaining = WORK_TIME;
      timerState.isPaused = false;
    }
  }

  renderTimer();
}

let intervalId = null;

function startTimerLoop() {
  if (intervalId) return;
  intervalId = setInterval(tick, 1000);
}

function stopTimerLoop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

// ── メニュー ──────────────────────────────────────────────
async function showMenu() {
  return select({
    message: 'アクションを選択:',
    choices: [
      { name: '▶  開始 (Start)', value: 'start' },
      { name: '⏸  停止 (Pause)', value: 'stop' },
      { name: '🔄  リセット (Reset)', value: 'reset' },
      { name: '⚙   設定 (Settings)', value: 'settings' },
      { name: '❌  終了 (Exit)', value: 'exit' },
    ],
  });
}

async function handleSettings() {
  const cur = {
    work: Math.floor(WORK_TIME / 60),
    shortBreak: Math.floor(SHORT_BREAK / 60),
    longBreak: Math.floor(LONG_BREAK / 60),
    sessions: timerState.totalSessions,
  };

  const setting = await select({
    message: '設定を変更:',
    choices: [
      { name: `作業時間    (現在: ${cur.work}分)`, value: 'work' },
      { name: `短い休憩    (現在: ${cur.shortBreak}分)`, value: 'shortBreak' },
      { name: `長い休憩    (現在: ${cur.longBreak}分)`, value: 'longBreak' },
      { name: `セッション数 (現在: ${cur.sessions})`, value: 'sessions' },
      { name: '← 戻る', value: 'back' },
    ],
  });

  if (setting === 'back') return;

  const value = await input({
    message: `${setting} の値を入力 (分):`,
    default: cur[setting].toString(),
    validate: (v) => (!isNaN(v) && parseInt(v) > 0) || '正の数を入力してください',
  });

  const minutes = parseInt(value);

  switch (setting) {
    case 'work':
      WORK_TIME = minutes * 60;
      if (timerState.state === STATE.IDLE) timerState.remaining = WORK_TIME;
      log('success', `作業時間を ${minutes} 分に設定しました`);
      break;
    case 'shortBreak':
      SHORT_BREAK = minutes * 60;
      log('success', `短い休憩を ${minutes} 分に設定しました`);
      break;
    case 'longBreak':
      LONG_BREAK = minutes * 60;
      log('success', `長い休憩を ${minutes} 分に設定しました`);
      break;
    case 'sessions':
      timerState.totalSessions = minutes;
      log('success', `セッション数を ${minutes} に設定しました`);
      break;
  }
}

// ── エントリポイント ──────────────────────────────────────
async function main() {
  startTimerLoop();
  renderTimer();

  while (true) {
    const choice = await showMenu();

    switch (choice) {
      case 'start':
        if (timerState.state === STATE.IDLE) {
          timerState.state = STATE.WORKING;
          timerState.remaining = WORK_TIME;
        }
        timerState.isPaused = false;
        log('info', 'タイマーを開始しました');
        renderTimer();
        break;

      case 'stop':
        timerState.isPaused = true;
        log('info', 'タイマーを一時停止しました');
        renderTimer();
        break;

      case 'reset':
        timerState.state = STATE.IDLE;
        timerState.remaining = WORK_TIME;
        timerState.session = 1;
        timerState.isPaused = false;
        log('info', 'タイマーをリセットしました');
        renderTimer();
        break;

      case 'settings':
        await handleSettings();
        renderTimer();
        break;

      case 'exit':
        stopTimerLoop();
        logUpdate.clear();
        consola.info('ポモドーロタイマーを終了します');
        process.exit(0);
    }
  }
}

process.on('SIGINT', () => {
  stopTimerLoop();
  logUpdate.clear();
  process.exit(0);
});

main();

