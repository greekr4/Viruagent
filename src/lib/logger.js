const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', '..', 'logs');

const getLogFile = () => {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOGS_DIR, `${date}.log`);
};

const formatTime = () => new Date().toISOString().slice(11, 23);

const write = (level, module, message, data) => {
  const line = `[${formatTime()}] [${level}] [${module}] ${message}${data !== undefined ? ' | ' + JSON.stringify(data) : ''}\n`;
  try {
    fs.appendFileSync(getLogFile(), line);
  } catch {}
};

const createLogger = (module) => ({
  info: (msg, data) => write('INFO', module, msg, data),
  warn: (msg, data) => write('WARN', module, msg, data),
  error: (msg, data) => write('ERROR', module, msg, data),
  debug: (msg, data) => write('DEBUG', module, msg, data),
});

module.exports = { createLogger };
