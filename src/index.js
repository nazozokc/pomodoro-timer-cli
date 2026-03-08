#!/usr/bin/env node

import { select, input } from '@inquirer/prompts';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
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

let isMenuOpen = false;

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
};

// ── 文字幅計算 ────────────────────────────────────────────
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

function centerStr(str, width) {
  const w = displayWidth(str);
  const left = Math.floor((width - w) / 2);
  const right = width - w - left;
  return ' '.repeat(Math.max(0, left)) + str + ' '.repeat(Math.max(0, right));
}

// ── フォーマット ──────────────────────────────────────────
function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function getProgressBar(remaining, total, width = 26) {
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
  const dots = [];
  for (let i = 1; i <= total; i++) {
    if (i < session) {
      dots.push(`${c.smoke}◆${c.reset}`);
    } else if (i === session) {
      const isWork = timerState.state === STATE.WORKING;
      dots.push(`${isWork ? c.amber : c.mint}${c.bold}◆${c.reset}`);
    } else {
      dots.push(`${c.charcoal}◇${c.reset}`);
    }
  }
  return dots.join(' ');
}

// ── 画面操作 ──────────────────────────────────────────────
function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
}

// ── タイマー描画 ──────────────────────────────────────────
function renderTimer() {
  if (isMenuOpen) return;

  const { state, remaining, session, totalSessions, isPaused } = timerState;

  const isIdle = state === STATE.IDLE;
  const isWorking = state === STATE.WORKING;
  const isBreak = state === STATE.BREAK;

  const accent = isWorking ? c.amber : isBreak ? c.mint : c.slate;

  const stateLabel = isWorking
    ? `${accent}FOCUS${c.reset}`
    : isBreak
      ? `${accent}BREAK${c.reset}`
      : `${c.slate}IDLE${c.reset}`;

  const totalTime = isWorking
    ? WORK_TIME
    : isBreak
      ? (remaining <= SHORT_BREAK ? SHORT_BREAK : LONG_BREAK)
      : WORK_TIME;

  const W = 33;

  const top = `${c.gray}╭${'─'.repeat(W + 2)}╮${c.reset}`;
  const sep = `${c.gray}├${'─'.repeat(W + 2)}┤${c.reset}`;
  const bot = `${c.gray}╰${'─'.repeat(W + 2)}╯${c.reset}`;
  const blank = () => `${c.gray}│${c.reset} ${' '.repeat(W)} ${c.gray}│${c.reset}`;
  const row = (inner) => `${c.gray}│${c.reset} ${padDisplay(inner, W)} ${c.gray}│${c.reset}`;

  const timeDisplay = `${c.bold}${accent}${formatTime(remaining)}${c.reset}`;
  const pauseMark = isPaused ? `  ${c.yellow}⏸  paused${c.reset}` : '';
  const percent = isIdle ? '' : `${c.smoke}${Math.round(((totalTime - remaining) / totalTime) * 100)}%${c.reset}`;
  const sessionDots = getSessionDots(session, totalSessions);
  const bar = getProgressBar(remaining, totalTime, 26);
  const title = `${c.bold}${c.white}P O M O D O R O${c.reset}`;
  const ver = `${c.charcoal}v${pkg.version}${c.reset}`;

  const lines = [
    '',
    top,
    `${c.gray}│${c.reset} ${centerStr(title, W)} ${c.gray}│${c.reset}`,
    sep,
    blank(),
    row(`  ${timeDisplay}    ${c.bold}${stateLabel}${c.reset}${pauseMark}`),
    blank(),
    row(`  ${bar}  ${percent}`),
    blank(),
    `${c.gray}│${c.reset} ${padDisplay(`  ${sessionDots}`, W - displayWidth(ver) - 1)}${ver} ${c.gray}│${c.reset}`,
    bot,
    '',
  ];

  logUpdate(lines.join('\n'));
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
      timerState.session = 1;
    } else {
      timerState.state = STATE.BREAK;
      timerState.remaining = SHORT_BREAK;
      timerState.isPaused = false;
    }
  } else {
    if (timerState.session < SESSIONS_BEFORE_LONG_BREAK) {
      timerState.session++;
    }
    timerState.state = STATE.WORKING;
    timerState.remaining = WORK_TIME;
    timerState.isPaused = false;
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
  // logUpdate の最終出力を「確定テキスト」として固定してから
  // inquirer に stdout を渡す。こうすれば inquirer は自分が
  // 描いた行数だけを管理できるので、カーソルがズレない。
  logUpdate.done();
  isMenuOpen = true;

  const result = await select({
    message: 'アクションを選択:',
    choices: [
      { name: '▶   Start    開始', value: 'start' },
      { name: '⏸   Pause    停止', value: 'stop' },
      { name: '↺   Reset    リセット', value: 'reset' },
      { name: '⚙   Settings 設定', value: 'settings' },
      { name: '×   Exit     終了', value: 'exit' },
    ],
  });

  isMenuOpen = false;
  return result;
}

async function handleSettings() {
  const cur = {
    work: Math.floor(WORK_TIME / 60),
    shortBreak: Math.floor(SHORT_BREAK / 60),
    longBreak: Math.floor(LONG_BREAK / 60),
    sessions: timerState.totalSessions,
  };

  const setting = await select({
    message: '変更する設定:',
    choices: [
      { name: `作業時間    — ${cur.work} min`, value: 'work' },
      { name: `短い休憩    — ${cur.shortBreak} min`, value: 'shortBreak' },
      { name: `長い休憩    — ${cur.longBreak} min`, value: 'longBreak' },
      { name: `セッション数 — ${cur.sessions}`, value: 'sessions' },
      { name: '← Back', value: 'back' },
    ],
  });

  if (setting === 'back') return;

  const value = await input({
    message: `新しい値を入力 (分):`,
    default: cur[setting].toString(),
    validate: (v) => (!isNaN(v) && parseInt(v) > 0) || '正の整数を入力してください',
  });

  const minutes = parseInt(value);

  switch (setting) {
    case 'work':
      WORK_TIME = minutes * 60;
      if (timerState.state === STATE.IDLE) timerState.remaining = WORK_TIME;
      break;
    case 'shortBreak':
      SHORT_BREAK = minutes * 60;
      break;
    case 'longBreak':
      LONG_BREAK = minutes * 60;
      break;
    case 'sessions':
      timerState.totalSessions = minutes;
      break;
  }
}

// ── エントリポイント ──────────────────────────────────────
async function main() {
  startTimerLoop();
  clearScreen();
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
        break;

      case 'stop':
        timerState.isPaused = true;
        break;

      case 'reset':
        timerState.state = STATE.IDLE;
        timerState.remaining = WORK_TIME;
        timerState.session = 1;
        timerState.isPaused = false;
        break;

      case 'settings':
        await handleSettings();
        break;

      case 'exit':
        stopTimerLoop();
        clearScreen();
        console.log('Bye 👋');
        process.exit(0);
    }

    // 選択後に画面をフルクリアして再描画
    // → inquirer の残骸・確定テキストを完全排除してからタイマーを出す
    clearScreen();
    renderTimer();
  }
}

process.on('SIGINT', () => {
  stopTimerLoop();
  clearScreen();
  process.exit(0);
});

main();
