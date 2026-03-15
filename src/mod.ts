#!/usr/bin/env -S deno run --allow-all

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));

if (Deno.args.includes("--version")) {
  console.log(pkg.version);
  Deno.exit(0);
}

let WORK_TIME = 25 * 60;
let SHORT_BREAK = 5 * 60;
let LONG_BREAK = 15 * 60;
const SESSIONS_BEFORE_LONG_BREAK = 4;

const STATE = { IDLE: "idle", WORKING: "working", BREAK: "break" };

type Mode = "timer" | "menu" | "settings_select" | "settings_input";
type InputTarget = "work" | "shortBreak" | "longBreak" | "sessions" | null;

let mode: Mode = "timer";
let menuIndex = 0;
let settingsIndex = 0;
let inputBuffer = "";
let inputTarget: InputTarget = null;

interface Notification {
  text: string;
  color: string;
  expireAt: number;
}

let notification: Notification | null = null;

interface TimerState {
  state: string;
  remaining: number;
  session: number;
  totalSessions: number;
  isPaused: boolean;
  breakType: "short" | "long" | null;
}

let timerState: TimerState = {
  state: STATE.IDLE,
  remaining: WORK_TIME,
  session: 1,
  totalSessions: SESSIONS_BEFORE_LONG_BREAK,
  isPaused: false,
  breakType: null,
};

const c: Record<string, string> = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  yellow: "\x1b[33m",
  white: "\x1b[97m",
  gray: "\x1b[90m",
  amber: "\x1b[38;5;214m",
  mint: "\x1b[38;5;121m",
  slate: "\x1b[38;5;246m",
  charcoal: "\x1b[38;5;238m",
  smoke: "\x1b[38;5;242m",
  red: "\x1b[38;5;203m",
  green: "\x1b[38;5[121m",
};

let output = "";

function logUpdateOutput(text: string) {
  output = text;
  Deno.stdout.write(new TextEncoder().encode("\r" + text.replace(/\n/g, "\r\n")));
}

function logUpdateDone() {
  const lines = output.split("\n").length;
  Deno.stdout.write(new TextEncoder().encode("\r" + "\n".repeat(lines) + "\r"));
}

function displayWidth(str: string): number {
  const plain = str.replace(/\x1b\[[0-9;]*m/g, "");
  let width = 0;
  for (const ch of plain) {
    const cp = ch.codePointAt(0)!;
    if (
      (cp >= 0x1f000 && cp <= 0x1ffff) ||
      (cp >= 0x3000 && cp <= 0x9fff) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

function padDisplay(str: string, len: number): string {
  const pad = Math.max(0, len - displayWidth(str));
  return str + " ".repeat(pad);
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function getProgressBar(remaining: number, total: number, width = 30): string {
  const ratio = Math.max(0, Math.min(1, (total - remaining) / total));
  const parts = ["▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];
  const exactFilled = ratio * width;
  const wholeFilled = Math.floor(exactFilled);
  const frac = exactFilled - wholeFilled;
  const fracChar = frac > 0 ? parts[Math.floor(frac * 8)] : "";
  const empty = width - wholeFilled - (fracChar ? 1 : 0);
  const isWork = timerState.state === STATE.WORKING;
  const fillColor = isWork ? c.amber : c.mint;

  return (
    `${fillColor}${"█".repeat(wholeFilled)}` +
    (fracChar ? `${fillColor}${fracChar}` : "") +
    `${c.reset}${c.charcoal}${"▒".repeat(Math.max(0, empty))}${c.reset}`
  );
}

function getSessionDots(session: number, total: number): string {
  return Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    if (n < session) return `${c.smoke}◆${c.reset}`;
    if (n === session)
      return `${
        timerState.state === STATE.WORKING ? c.amber : c.mint
      }${c.bold}◆${c.reset}`;
    return `${c.charcoal}◇${c.reset}`;
  }).join(" ");
}

const W = 40;
const top = () => `${c.gray}╭${"─".repeat(W + 2)}╮${c.reset}`;
const sep = () => `${c.gray}├${"─".repeat(W + 2)}┤${c.reset}`;
const bot = () => `${c.gray}╰${"─".repeat(W + 2)}╯${c.reset}`;
const blank = () =>
  `${c.gray}│${c.reset}${" ".repeat(W + 2)}${c.gray}│${c.reset}`;
const row = (inner: string) =>
  `${c.gray}│${c.reset} ${padDisplay(inner, W)} ${c.gray}│${c.reset}`;

function notify(text: string, color = c.mint, ms = 2000) {
  notification = { text, color, expireAt: Date.now() + ms };
}

function buildTimerRows(): string[] {
  const {
    state,
    remaining,
    session,
    totalSessions,
    isPaused,
    breakType,
  } = timerState;
  const isIdle = state === STATE.IDLE;
  const isWorking = state === STATE.WORKING;
  const isBreak = state === STATE.BREAK;
  const accent = isWorking ? c.amber : isBreak ? c.mint : c.slate;

  const totalTime = isWorking
    ? WORK_TIME
    : isBreak
      ? breakType === "long"
        ? LONG_BREAK
        : SHORT_BREAK
      : WORK_TIME;

  const timeRaw = formatTime(remaining);
  const pauseTag = isPaused ? `  ${c.yellow}|| ${c.reset}` : "";
  const leftPart = ` ${c.bold}${accent}${timeRaw}${c.reset}${pauseTag}`;
  const leftW = 1 + 5 + (isPaused ? 4 : 0);

  const stateWord = isWorking ? "FOCUS" : isBreak ? "BREAK" : "IDLE";
  const rightPart = `${accent}*  ${stateWord}${c.reset}`;
  const rightW = 1 + 2 + stateWord.length;

  const midSpaces = Math.max(2, W - leftW - rightW);
  const timeLine = `${leftPart}${" ".repeat(midSpaces)}${rightPart}`;

  const barW = W - 7;
  const bar = getProgressBar(remaining, totalTime, barW);
  const pct = isIdle
    ? `${c.charcoal}  -%${c.reset}`
    : `${c.smoke}${
      Math.round(((totalTime - remaining) / totalTime) * 100)
        .toString()
        .padStart(3)
    }%${c.reset}`;
  const barLine = ` ${bar}  ${pct}`;

  const dots = getSessionDots(session, totalSessions);
  const counterText = `${session}/${totalSessions}`;
  const counter = `${c.charcoal}${counterText}${c.reset}`;
  const dotsField = padDisplay(` ${dots}`, W - counterText.length);
  const dotsLine = `${dotsField}${counter}`;

  return [
    blank(),
    row(timeLine),
    blank(),
    row(barLine),
    blank(),
    `${c.gray}│${c.reset} ${dotsLine} ${c.gray}│${c.reset}`,
  ];
}

function buildNotifRow(): string {
  if (notification && Date.now() < notification.expireAt) {
    return row(` ${notification.color}${notification.text}${c.reset}`);
  }
  notification = null;
  return blank();
}

function buildHintRow(): string {
  return row(
    ` ${c.charcoal}m menu · s start · p pause · q quit${c.reset}`,
  );
}

interface MenuItem {
  label: string;
  key: string;
}

const MENU_ITEMS: MenuItem[] = [
  { label: ">  Start      開始", key: "s" },
  { label: "|| Pause      停止", key: "p" },
  { label: "o  Reset      リセット", key: "r" },
  { label: "*  Settings   設定", key: "c" },
  { label: "x  Exit       終了", key: "q" },
];

function buildMenuRows(): string[] {
  const items = MENU_ITEMS.map((item, i) => {
    const sel = i === menuIndex;
    const cursor = sel ? `${c.amber}${c.bold}>${c.reset}` : " ";
    const label = sel
      ? `${c.white}${c.bold}${item.label}${c.reset}`
      : `${c.smoke}${item.label}${c.reset}`;
    return row(` ${cursor}  ${label}`);
  });
  return [
    ...items,
    sep(),
    row(` ${c.charcoal}↑↓ navigate · Enter select · ESC cancel${c.reset}`),
  ];
}

interface SettingsItem {
  label: string;
  key: string;
}

function currentSettings(): SettingsItem[] {
  return [
    {
      label: `作業時間     ${String(Math.floor(WORK_TIME / 60)).padStart(2)} min`,
      key: "work",
    },
    {
      label: `短い休憩     ${String(Math.floor(SHORT_BREAK / 60)).padStart(2)} min`,
      key: "shortBreak",
    },
    {
      label: `長い休憩     ${String(Math.floor(LONG_BREAK / 60)).padStart(2)} min`,
      key: "longBreak",
    },
    {
      label: `セッション数   ${timerState.totalSessions}`,
      key: "sessions",
    },
    { label: "< Back", key: "back" },
  ];
}

function buildSettingsRows(): string[] {
  const items = currentSettings().map((item, i) => {
    const sel = i === settingsIndex;
    const cursor = sel ? `${c.mint}${c.bold}>${c.reset}` : " ";
    const label = sel
      ? `${c.white}${c.bold}${item.label}${c.reset}`
      : `${c.smoke}${item.label}${c.reset}`;
    return row(` ${cursor}  ${label}`);
  });
  return [
    ...items,
    sep(),
    row(` ${c.charcoal}↑↓ navigate · Enter select · ESC cancel${c.reset}`),
  ];
}

function buildInputRows(): string[] {
  const labels: Record<string, string> = {
    work: "作業時間 (分)",
    shortBreak: "短い休憩 (分)",
    longBreak: "長い休憩 (分)",
    sessions: "セッション数",
  };
  const labelStr = `${c.smoke}${labels[inputTarget!] || ""}${c.reset}`;
  const inputStr = `${c.bold}${c.amber}${inputBuffer || " "}|${c.reset}`;
  return [
    blank(),
    row(`  ${labelStr}`),
    row(`  ${inputStr}`),
    blank(),
    sep(),
    row(` ${c.charcoal}数値を入力 · Enter 確定 · ESC キャンセル${c.reset}`),
  ];
}

function render() {
  const versionStr = `v${pkg.version}`;
  const headerPad = W - 1 - 8 - versionStr.length;
  const header = ` ${c.bold}${c.white}POMODORO${c.reset}${" ".repeat(Math.max(0, headerPad))}${c.charcoal}${versionStr}${c.reset}`;

  const lines: string[] = [
    "",
    top(),
    row(header),
    sep(),
    ...buildTimerRows(),
    sep(),
    buildNotifRow(),
    sep(),
  ];

  if (mode === "menu") {
    lines.push(...buildMenuRows());
  } else if (mode === "settings_select") {
    lines.push(...buildSettingsRows());
  } else if (mode === "settings_input") {
    lines.push(...buildInputRows());
  } else {
    lines.push(buildHintRow());
  }

  lines.push(bot(), "");
  logUpdateOutput(lines.join("\n"));
}

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
    if (timerState.session >= timerState.totalSessions) {
      timerState.state = STATE.BREAK;
      timerState.remaining = LONG_BREAK;
      timerState.session = 1;
      timerState.isPaused = false;
      timerState.breakType = "long";
      notify("全セッション完了！長い休憩", c.amber);
    } else {
      timerState.state = STATE.BREAK;
      timerState.remaining = SHORT_BREAK;
      timerState.isPaused = false;
      timerState.breakType = "short";
      notify(`セッション${timerState.session}完了！短い休憩 (5分)`, c.mint);
    }
  } else {
    if (timerState.session < timerState.totalSessions) {
      timerState.session++;
    }
    timerState.state = STATE.WORKING;
    timerState.remaining = WORK_TIME;
    timerState.isPaused = false;
    timerState.breakType = null;
    notify("作業開始！", c.amber);
  }
}

function handleKey(key: string) {
  const ESC = "\x1b";
  const UP = "\x1b[A";
  const DOWN = "\x1b[B";
  const ENTER = "\r";
  const CTRL_C = "\x03";
  const BACK = "\x7f";

  if (key === CTRL_C) exit();

  if (mode === "timer") {
    if (key === "m") {
      mode = "menu";
      menuIndex = 0;
    } else if (key === "s") actionStart();
    else if (key === "p") actionPause();
    else if (key === "r") actionReset();
    else if (key === "q") exit();
    render();
    return;
  }

  if (mode === "menu") {
    if (key === UP) menuIndex = (menuIndex - 1 + MENU_ITEMS.length) % MENU_ITEMS.length;
    if (key === DOWN) menuIndex = (menuIndex + 1) % MENU_ITEMS.length;
    if (key === ESC) mode = "timer";
    if (key === ENTER) {
      const item = MENU_ITEMS[menuIndex];
      mode = "timer";
      if (item.key === "s") actionStart();
      else if (item.key === "p") actionPause();
      else if (item.key === "r") actionReset();
      else if (item.key === "c") {
        mode = "settings_select";
        settingsIndex = 0;
      } else if (item.key === "q") exit();
    }
    render();
    return;
  }

  if (mode === "settings_select") {
    const items = currentSettings();
    if (key === UP) settingsIndex = (settingsIndex - 1 + items.length) % items.length;
    if (key === DOWN) settingsIndex = (settingsIndex + 1) % items.length;
    if (key === ESC) mode = "timer";
    if (key === ENTER) {
      const item = items[settingsIndex];
      if (item.key === "back") {
        mode = "timer";
      } else {
        inputTarget = item.key as InputTarget;
        inputBuffer = "";
        mode = "settings_input";
      }
    }
    render();
    return;
  }

  if (mode === "settings_input") {
    if (key === ESC) {
      mode = "settings_select";
    } else if (key === BACK) {
      inputBuffer = inputBuffer.slice(0, -1);
    } else if (key === ENTER) {
      const val = parseInt(inputBuffer);
      if (!isNaN(val) && val > 0) {
        applySettings(inputTarget!, val);
        notify(`${inputTarget} -> ${val}`, c.mint);
        mode = "settings_select";
      } else {
        notify("正の整数を入力してください", c.red);
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
    timerState.state = STATE.WORKING;
    timerState.remaining = WORK_TIME;
    timerState.breakType = null;
  }
  timerState.isPaused = false;
  notify("Started", c.amber);
}

function actionPause() {
  timerState.isPaused = !timerState.isPaused;
  notify(timerState.isPaused ? "Paused" : "Resumed", c.yellow);
}

function actionReset() {
  timerState.state = STATE.IDLE;
  timerState.remaining = WORK_TIME;
  timerState.session = 1;
  timerState.isPaused = false;
  timerState.breakType = null;
  notify("Reset", c.smoke);
}

function applySettings(key: InputTarget, val: number) {
  switch (key) {
    case "work":
      WORK_TIME = val * 60;
      if (timerState.state === STATE.IDLE) timerState.remaining = WORK_TIME;
      break;
    case "shortBreak":
      SHORT_BREAK = val * 60;
      if (timerState.state === STATE.BREAK && timerState.breakType === "short") {
        timerState.remaining = SHORT_BREAK;
      }
      break;
    case "longBreak":
      LONG_BREAK = val * 60;
      if (timerState.state === STATE.BREAK && timerState.breakType === "long") {
        timerState.remaining = LONG_BREAK;
      }
      break;
    case "sessions":
      timerState.totalSessions = val;
      break;
  }
}

let intervalId: number | undefined;

function exit() {
  if (intervalId) clearInterval(intervalId);
  logUpdateDone();
  Deno.stdout.write(new TextEncoder().encode("\x1b[?25h"));
  console.log("\nBye");
  Deno.exit(0);
}

Deno.stdin.setRaw(true);
Deno.stdout.write(new TextEncoder().encode("\x1b[?25l"));

async function readKeys() {
  const decoder = new TextDecoder();
  const buffer = new Uint8Array(1024);
  while (true) {
    const n = await Deno.stdin.read(buffer);
    if (n === null) break;
    const key = decoder.decode(buffer.slice(0, n));
    handleKey(key);
  }
}

Deno.addSignalListener("SIGINT", () => exit());

intervalId = setInterval(tick, 1000);
render();
readKeys();
