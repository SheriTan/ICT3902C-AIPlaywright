// To map to correct config.json based on config environment folder (e.g., DEMO, DEV, PROD, UAT)
const fs = require('fs');
const path = require('path');

function loadConfig() {
    const env = (process.env.ENV || 'DEMO').toUpperCase();
    const configPath = path.join(__dirname, '..', 'config', env, 'config.json');

    if (!fs.existsSync(configPath)) {
        throw new Error(
            `No config found for ENV="${env}". Expected a file at ${configPath}. ` +
            `Valid options are folder names under /config (DEMO, DEV, UAT, PROD).`
        );
    }

    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);

    // To retrieve sensitive data based on specified path in config.json (keep it in data/sensitive/ directory)
    const credsPath = path.join(__dirname, '..', 'config', env, config.credentialsFile || '');
    config.credentials = fs.existsSync(credsPath)
        ? JSON.parse(fs.readFileSync(credsPath, 'utf-8'))
        : {};

    return config;
}

module.exports = { loadConfig };