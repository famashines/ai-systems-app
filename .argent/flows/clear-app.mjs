import { execFileSync } from 'node:child_process';

const avd = 'Pixel_10_Pro_Store';
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' }).trim();

const serials = adb('devices')
  .split('\n')
  .slice(1)
  .map((line) => line.split('\t'))
  .filter(([, state]) => state === 'device')
  .map(([serial]) => serial);
const serial = serials.find((s) => s.startsWith('emulator-') && adb('-s', s, 'emu', 'avd', 'name').split('\n')[0].trim() === avd);
if (!serial) throw new Error(`No running emulator with the AVD ${avd}. Connected: ${serials.join(', ') || 'none'}`);
adb('-s', serial, 'shell', 'pm', 'clear', 'com.famashines.ai');
