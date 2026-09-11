const { spawnSync } = require('node:child_process');
spawnSync('reg.exe', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'CinemanaDiscordPresence', '/f'], { stdio: 'inherit' });
console.log('Removed the Windows startup entry.');
