#!/usr/bin/env node

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as readline from 'readline';
import logUpdate from 'log-update';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));

if (process.argv.includes('--version')) {
  console.log(pkg.version);
  process.exit(0);
}

let WORK_TIME = 25 * 60;
let SHORT_BREAK = 5 * 60;
let LONG_BREAK = 15 * 60;
const SESSIONS_BEFORE_LONG_BREAK = 4;

const STATE = { IDLE: 'idle', WORKING: 'working', BREAK: 'break' };

// モード: 'timer' | 'menu' | 'settings_select' | 'settings_input'
let mode = 'timer';
let menuIndex = 0;
let settingsIndex = 0;
let inputBuffer = '';
let inputTarget = null; // 'work' | 'shortBreak' | 'longBreak' | 'sessions'
let notification = null; // { text, color, expireAt }

let timerState = {
  state: STATE.IDLE,
  remaining: WORK_TIME,
  session: 1,
  totalSessions: SESSIONS_BEFORE_LONG_BREAK,
  isPaused: false,
};

// ── ANSI ─────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  yellow: '\x1b[33m',
  white: '\x1b[97m',
  gray: '\x1b[90m',
  amber: '\x1b[38;5;214m',
  mint: '\x1b[38;5;121m',
  slate: '\x1b[38;5;246m',
  charcoal: '\x1b[38;5;238m',
  smoke: '\x1b[38;5;242m',
  red: '\x1b[38;5;203m',
  green: '\x1b[38;5;121m',
};

// ── 文字幅計算 ────────────────────────────────────────────
function displayWidth(str) {
  const plain = str.replace(/\x1b\[[0-9;]*m/g, '');
  let width = 0;
  for (const ch of plain) {
    const cp = ch.codePointAt(0);
    if (
      (cp >= 0x1F000 && cp <= 0x1FFFF) ||
      (cp >= 0x2600  && cp <= 0x27BF)  ||
      (cp >= 0x3000  && cp <= 0x9FFF)  ||
      (cp >= 0xF900  && cp <= 0xFAFF)  ||
      (cp >= 0xFE30  && cp <= 0xFE4F)  ||
      (cp >= 0xFF00  && cp <= 0xFF60)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

function padDisplay(str, len) {
  const pad = Math.max(0, len - displayWidth(str));
  return str + ' '.repeat(pad);
}

// ── フォーマット ──────────────────────────────────────────
function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function getProgressBar(remaining, total, width = 30) {
  const ratio = Math.max(0, Math.min(1, (total - remaining) / total));
  const parts = ['▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
  const exactFilled = ratio * width;
  const wholeFilled = Math.floor(exactFilled);
  const frac = exactFilled - wholeFilled;
  const fracChar = frac > 0 ? parts[Math.floor(frac * 8)] : '';
  const empty = width - wholeFilled - (fracChar ? 1 : 0);
  const isWork = timerState.state === STATE.WORKING;
  const fillColor = isWork ? c.amber : c.mint;

  return (
    `${fillColor}${'█'.repeat(wholeFilled)}` +
    (fracChar ? `${fillColor}${fracChar}` : '') +
    `${c.reset}${c.charcoal}${'▒'.repeat(Math.max(0, empty))}${c.reset}`
  );
}

function getSessionDots(session, total) {
  return Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    if (n < session)  return `${c.smoke}◆${c.reset}`;
    if (n === session) return `${timerState.state === STATE.WORKING ? c.amber : c.mint}${c.bold}◆${c.reset}`;
    return `${c.charcoal}◇${c.reset}`;
  }).join(' ');
}

// ── ボックス描画ヘルパー ──────────────────────────────────
const W = 40;
const top   = () => `${c.gray}╭${'─'.repeat(W + 2)}╮${c.reset}`;
const sep   = () => `${c.gray}├${'─'.repeat(W + 2)}┤${c.reset}`;
const bot   = () => `${c.gray}╰${'─'.repeat(W + 2)}╯${c.reset}`;
const blank = () => `${c.gray}│${c.reset}${' '.repeat(W + 2)}${c.gray}│${c.reset}`;
const row   = (inner) => `${c.gray}│${c.reset} ${padDisplay(inner, W)} ${c.gray}│${c.reset}`;

// ── 通知 ─────────────────────────────────────────────────
function notify(text, color = c.mint, ms = 2000) {
  notification = { text, color, expireAt: Date.now() + ms };
}

// ── タイマー行 ────────────────────────────────────────────
function buildTimerRows() {
  const { state, remaining, session, totalSessions, isPaused } = timerState;
  const isIdle    = state === STATE.IDLE;
  const isWorking = state === STATE.WORKING;
  const isBreak   = state === STATE.BREAK;
  const accent    = isWorking ? c.amber : isBreak ? c.mint : c.slate;
  const totalTime = isWorking
    ? WORK_TIME
    : isBreak
    ? (remaining <= SHORT_BREAK ? SHORT_BREAK : LONG_BREAK)
    : WORK_TIME;

  // 時間 + 状態 (両端揃え)
  const timeRaw   = formatTime(remaining);                         // e.g. "25:00"
  const pauseTag  = isPaused ? `  ${c.yellow}⏸${c.reset}` : '';
  const leftPart  = ` ${c.bold}${accent}${timeRaw}${c.reset}${pauseTag}`;
  const leftW     = 1 + 5 + (isPaused ? 3 : 0);

  const stateWord = isWorking ? 'FOCUS' : isBreak ? 'BREAK' : 'IDLE';
  const rightPart = `${accent}●  ${stateWord}${c.reset}`;
  const rightW    = 1 + 2 + stateWord.length;

  const midSpaces = Math.max(2, W - leftW - rightW);
  const timeLine  = `${leftPart}${' '.repeat(midSpaces)}${rightPart}`;

  // プログレスバー (1 space + bar + 2 spaces + 4 chars pct)
  const barW  = W - 7;
  const bar   = getProgressBar(remaining, totalTime, barW);
  const pct   = isIdle
    ? `${c.charcoal}  ─%${c.reset}`
    : `${c.smoke}${Math.round(((totalTime - remaining) / totalTime) * 100).toString().padStart(3)}%${c.reset}`;
  const barLine = ` ${bar}  ${pct}`;

  // セッションドット + カウンター (右寄せ)
  const dots        = getSessionDots(session, totalSessions);
  const counterText = `${session}/${totalSessions}`;
  const counter     = `${c.charcoal}${counterText}${c.reset}`;
  const dotsField   = padDisplay(` ${dots}`, W - counterText.length);
  const dotsLine    = `${dotsField}${counter}`;

  return [
    blank(),
    row(timeLine),
    blank(),
    row(barLine),
    blank(),
    `${c.gray}│${c.reset} ${dotsLine} ${c.gray}│${c.reset}`,
  ];
}

// ── 通知行 ────────────────────────────────────────────────
function buildNotifRow() {
  if (notification && Date.now() < notification.expireAt) {
    return row(` ${notification.color}${notification.text}${c.reset}`);
  }
  notification = null;
  return blank();
}

// ── ヒント行 (timer モード) ───────────────────────────────
function buildHintRow() {
  return row(` ${c.charcoal}m menu · s start · p pause · q quit${c.reset}`);
}

// ── メニュー行 ────────────────────────────────────────────
const MENU_ITEMS = [
  { label: '▶  Start      開始',     key: 's' },
  { label: '⏸  Pause      停止',     key: 'p' },
  { label: '↺  Reset      リセット', key: 'r' },
  { label: '⚙  Settings   設定',     key: 'c' },
  { label: '×  Exit       終了',     key: 'q' },
];

function buildMenuRows() {
  const items = MENU_ITEMS.map((item, i) => {
    const sel    = i === menuIndex;
    // ❯ は U+276F (0x2600-0x27BF 内) → displayWidth = 2 なので非選択時は空白2つ
    const cursor = sel ? `${c.amber}${c.bold}❯${c.reset}` : '  ';
    const label  = sel
      ? `${c.white}${c.bold}${item.label}${c.reset}`
      : `${c.smoke}${item.label}${c.reset}`;
    return row(` ${cursor}  ${label}`);
  });
  return [
    ...items,
    sep(),
    row(` ${c.charcoal}↑↓ navigate · ⏎ select · ESC cancel${c.reset}`),
  ];
}

// ── 設定選択行 ────────────────────────────────────────────
function currentSettings() {
  return [
    { label: `作業時間     ${String(Math.floor(WORK_TIME / 60)).padStart(2)} min`,    key: 'work' },
    { label: `短い休憩     ${String(Math.floor(SHORT_BREAK / 60)).padStart(2)} min`,  key: 'shortBreak' },
    { label: `長い休憩     ${String(Math.floor(LONG_BREAK / 60)).padStart(2)} min`,   key: 'longBreak' },
    { label: `セッション数   ${timerState.totalSessions}`,                             key: 'sessions' },
    { label: '← Back',                                                                 key: 'back' },
  ];
}

function buildSettingsRows() {
  const items = currentSettings().map((item, i) => {
    const sel    = i === settingsIndex;
    const cursor = sel ? `${c.mint}${c.bold}❯${c.reset}` : '  ';
    const label  = sel
      ? `${c.white}${c.bold}${item.label}${c.reset}`
      : `${c.smoke}${item.label}${c.reset}`;
    return row(` ${cursor}  ${label}`);
  });
  return [
    ...items,
    sep(),
    row(` ${c.charcoal}↑↓ navigate · ⏎ select · ESC cancel${c.reset}`),
  ];
}

// ── 入力行 ────────────────────────────────────────────────
function buildInputRows() {
  const labels = {
    work:       '作業時間 (分)',
    shortBreak: '短い休憩 (分)',
    longBreak:  '長い休憩 (分)',
    sessions:   'セッション数',
  };
  const labelStr = `${c.smoke}${labels[inputTarget] || ''}${c.reset}`;
  const inputStr = `${c.bold}${c.amber}${inputBuffer || ' '}▌${c.reset}`;
  return [
    blank(),
    row(`  ${labelStr}`),
    row(`  ${inputStr}`),
    blank(),
    sep(),
    row(` ${c.charcoal}数値を入力 · ⏎ 確定 · ESC キャンセル${c.reset}`),
  ];
}

// ── 全体描画 (単一ボックス) ───────────────────────────────
function render() {
  const versionStr = `v${pkg.version}`;
  const headerPad  = W - 1 - 8 - versionStr.length; // 1 space + POMODORO(8) + pad + version
  const header     = ` ${c.bold}${c.white}POMODORO${c.reset}${' '.repeat(Math.max(0, headerPad))}${c.charcoal}${versionStr}${c.reset}`;

  const lines = [
    '',
    top(),
    row(header),
    sep(),
    ...buildTimerRows(),
    sep(),
    buildNotifRow(),
    sep(),
  ];

  if (mode === 'menu') {
    lines.push(...buildMenuRows());
  } else if (mode === 'settings_select') {
    lines.push(...buildSettingsRows());
  } else if (mode === 'settings_input') {
    lines.push(...buildInputRows());
  } else {
    lines.push(buildHintRow());
  }

  lines.push(bot(), '');
  logUpdate(lines.join('\n'));
}

// ── タイマーロジック ──────────────────────────────────────
function tick() {
  if (timerState.state === STATE.IDLE || timerState.isPaused) {
    render();
    return;
  }

  timerState.remaining--;

  if (timerState.remaining <= 0) {
    handleTimerComplete();
  }

  render();
}

function handleTimerComplete() {
  const wasWorking = timerState.state === STATE.WORKING;

  if (wasWorking) {
    if (timerState.session >= SESSIONS_BEFORE_LONG_BREAK) {
      timerState.state     = STATE.BREAK;
      timerState.remaining = LONG_BREAK;
      timerState.session   = 1;
      notify('🎉 4セッション完了！長い休憩 (15分)', c.amber);
    } else {
      timerState.state     = STATE.BREAK;
      timerState.remaining = SHORT_BREAK;
      timerState.isPaused  = false;
      notify(`✓ セッション${timerState.session}完了！短い休憩 (5分)`, c.mint);
    }
  } else {
    if (timerState.session < SESSIONS_BEFORE_LONG_BREAK) {
      timerState.session++;
    }
    timerState.state     = STATE.WORKING;
    timerState.remaining = WORK_TIME;
    timerState.isPaused  = false;
    notify('▶ 作業開始！', c.amber);
  }
}

// ── キー操作 ──────────────────────────────────────────────
function handleKey(key) {
  const ESC    = '\x1b';
  const UP     = '\x1b[A';
  const DOWN   = '\x1b[B';
  const ENTER  = '\r';
  const CTRL_C = '\x03';
  const BACK   = '\x7f';

  if (key === CTRL_C) exit();

  // ── timer モード ──
  if (mode === 'timer') {
    if      (key === 'm') { mode = 'menu'; menuIndex = 0; }
    else if (key === 's') actionStart();
    else if (key === 'p') actionPause();
    else if (key === 'r') actionReset();
    else if (key === 'q') exit();
    render();
    return;
  }

  // ── menu モード ──
  if (mode === 'menu') {
    if (key === UP)    menuIndex = (menuIndex - 1 + MENU_ITEMS.length) % MENU_ITEMS.length;
    if (key === DOWN)  menuIndex = (menuIndex + 1) % MENU_ITEMS.length;
    if (key === ESC)   mode = 'timer';
    if (key === ENTER) {
      const item = MENU_ITEMS[menuIndex];
      mode = 'timer';
      if      (item.key === 's') actionStart();
      else if (item.key === 'p') actionPause();
      else if (item.key === 'r') actionReset();
      else if (item.key === 'c') { mode = 'settings_select'; settingsIndex = 0; }
      else if (item.key === 'q') exit();
    }
    render();
    return;
  }

  // ── settings_select モード ──
  if (mode === 'settings_select') {
    const items = currentSettings();
    if (key === UP)    settingsIndex = (settingsIndex - 1 + items.length) % items.length;
    if (key === DOWN)  settingsIndex = (settingsIndex + 1) % items.length;
    if (key === ESC)   mode = 'timer';
    if (key === ENTER) {
      const item = items[settingsIndex];
      if (item.key === 'back') {
        mode = 'timer';
      } else {
        inputTarget  = item.key;
        inputBuffer  = '';
        mode         = 'settings_input';
      }
    }
    render();
    return;
  }

  // ── settings_input モード ──
  if (mode === 'settings_input') {
    if (key === ESC) {
      mode = 'settings_select';
    } else if (key === BACK) {
      inputBuffer = inputBuffer.slice(0, -1);
    } else if (key === ENTER) {
      const val = parseInt(inputBuffer);
      if (!isNaN(val) && val > 0) {
        applySettings(inputTarget, val);
        notify(`✓ ${inputTarget} → ${val}`, c.mint);
        mode = 'settings_select';
      } else {
        notify('正の整数を入力してください', c.red);
      }
    } else if (/^\d$/.test(key)) {
      inputBuffer += key;
    }
    render();
    return;
  }
}

function actionStart() {
  if (timerState.state === STATE.IDLE) {
    timerState.state     = STATE.WORKING;
    timerState.remaining = WORK_TIME;
  }
  timerState.isPaused = false;
  notify('▶ Started', c.amber);
}

function actionPause() {
  timerState.isPaused = !timerState.isPaused;
  notify(timerState.isPaused ? '⏸ Paused' : '▶ Resumed', c.yellow);
}

function actionReset() {
  timerState.state     = STATE.IDLE;
  timerState.remaining = WORK_TIME;
  timerState.session   = 1;
  timerState.isPaused  = false;
  notify('↺ Reset', c.smoke);
}

function applySettings(key, val) {
  switch (key) {
    case 'work':
      WORK_TIME = val * 60;
      if (timerState.state === STATE.IDLE) timerState.remaining = WORK_TIME;
      break;
    case 'shortBreak': SHORT_BREAK = val * 60; break;
    case 'longBreak':  LONG_BREAK  = val * 60; break;
    case 'sessions':   timerState.totalSessions = val; break;
  }
}

function exit() {
  clearInterval(intervalId);
  logUpdate.done();
  process.stdout.write('\x1b[?25h');
  console.log('\nBye 👋');
  process.exit(0);
}

// ── raw モード起動 ────────────────────────────────────────
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdout.write('\x1b[?25l');
process.stdin.on('data', (key) => { handleKey(key); });
process.on('SIGINT', () => exit());

// ── メインループ ──────────────────────────────────────────
const intervalId = setInterval(tick, 1000);
render();
