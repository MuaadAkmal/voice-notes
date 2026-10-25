import koffi from 'koffi';
import log from 'electron-log/main';

// Thin user32/kernel32 bindings via koffi (FFI, no compile step). Every call degrades to null/no-op
// if the DLLs can't be bound, so a missing binary can never break recording.

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const VK_MEDIA_PLAY_PAUSE = 0xb3;
const KEYEVENTF_EXTENDEDKEY = 0x1;
const KEYEVENTF_KEYUP = 0x2;
const MAX_CHARS = 512;

type Bindings = {
  GetForegroundWindow: () => unknown;
  GetWindowTextW: (hwnd: unknown, buf: Buffer, max: number) => number;
  GetWindowThreadProcessId: (hwnd: unknown, pid: Uint32Array) => number;
  OpenProcess: (access: number, inherit: boolean, pid: number) => unknown;
  QueryFullProcessImageNameW: (h: unknown, flags: number, buf: Buffer, size: Uint32Array) => boolean;
  CloseHandle: (h: unknown) => boolean;
  keybd_event: (vk: number, scan: number, flags: number, extra: number) => void;
};

let bindings: Bindings | null | undefined;

function bind(): Bindings | null {
  if (bindings !== undefined) return bindings;
  try {
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    bindings = {
      GetForegroundWindow: user32.func('void* __stdcall GetForegroundWindow()'),
      GetWindowTextW: user32.func('int __stdcall GetWindowTextW(void* hWnd, uint16_t* lpString, int nMaxCount)'),
      GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(void* hWnd, uint32_t* pid)'),
      OpenProcess: kernel32.func('void* __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)'),
      QueryFullProcessImageNameW: kernel32.func(
        'bool __stdcall QueryFullProcessImageNameW(void* h, uint32_t flags, uint16_t* name, uint32_t* size)',
      ),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(void* h)'),
      keybd_event: user32.func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)'),
    };
  } catch (err) {
    log.error('[win32] bindings unavailable', err);
    bindings = null;
  }
  return bindings;
}

const isNull = (p: unknown) => p === null || p === 0n || p === 0;

function processName(b: Bindings, pid: number): string {
  const h = b.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (isNull(h)) return '';
  try {
    const buf = Buffer.alloc(MAX_CHARS * 2);
    const size = Uint32Array.of(MAX_CHARS);
    if (!b.QueryFullProcessImageNameW(h, 0, buf, size)) return '';
    const full = buf.toString('utf16le', 0, size[0] * 2);
    return full.slice(full.lastIndexOf('\\') + 1);
  } finally {
    b.CloseHandle(h);
  }
}

export type ForegroundWindow = { title: string; processName: string; pid: number };

/** The window the user is looking at, e.g. { title: 'Dark | Netflix - Google Chrome', processName: 'chrome.exe' }. */
export function foregroundWindow(): ForegroundWindow | null {
  const b = bind();
  if (!b) return null;
  try {
    const hwnd = b.GetForegroundWindow();
    if (isNull(hwnd)) return null;
    const buf = Buffer.alloc(MAX_CHARS * 2);
    const len = b.GetWindowTextW(hwnd, buf, MAX_CHARS);
    const pid = Uint32Array.of(0);
    b.GetWindowThreadProcessId(hwnd, pid);
    return { title: buf.toString('utf16le', 0, len * 2), processName: processName(b, pid[0]), pid: pid[0] };
  } catch (err) {
    log.warn('[win32] foreground window lookup failed', err);
    return null;
  }
}

/** Taps the play/pause media key (whatever Windows considers the current media session gets it). */
export function pressPlayPause(): void {
  const b = bind();
  if (!b) return;
  b.keybd_event(VK_MEDIA_PLAY_PAUSE, 0, KEYEVENTF_EXTENDEDKEY, 0);
  b.keybd_event(VK_MEDIA_PLAY_PAUSE, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0);
}
