// Loads config/<ENV>/config.json (ENV comes from the ENV variable, default DEMO) and,
// when the config names a credentialsFile, the sensitive data it points to.

const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./paths');

const cache = new Map();

/**
 * @returns {{ env: string, baseURL: string, timeout: number, retries: number, credentials: object }}
 */
function loadConfig() {
  const env = (process.env.ENV || 'DEMO').toUpperCase();
  if (cache.has(env)) return cache.get(env);

  const configPath = path.join(CONFIG_DIR, env, 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `No config found for ENV="${env}". Expected a file at ${configPath}. ` +
        `Valid options are the folder names under /config (e.g. DEMO, SIT).`
    );
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  // credentialsFile is relative to config/<ENV>/ and should point into data/sensitive/
  const credentialsPath = path.join(CONFIG_DIR, env, config.credentialsFile || '');
  config.credentials =
    config.credentialsFile && fs.existsSync(credentialsPath)
      ? JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'))
      : {};

  cache.set(env, config);
  return config;
}

module.exports = { loadConfig };
