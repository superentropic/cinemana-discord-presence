const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const launcher = path.join(root, 'scripts', 'launch-hidden.vbs');
const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
execFileSync('reg.exe', ['add', key, '/v', 'CinemanaDiscordPresence', '/t', 'REG_SZ', '/d', `wscript.exe "${launcher}"`, '/f'], { stdio: 'inherit' });
console.log('Cinemana Discord Presence will now start when you sign in to Windows.');
