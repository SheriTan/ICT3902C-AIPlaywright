const { loadConfig } = require('../global/configLoader');

function getUserByName(name) {
    const config = loadConfig();
    const users = [
        ...(config.credentials.admin || []),
        ...(config.credentials.user || [])
    ];

    const user = users.find(
        credential => credential.Name.toLowerCase() === name.toLowerCase()
    );

    if (!user) {
        throw new Error(`No credential found for user "${name}"`);
    }

    return user;
}

module.exports = { getUserByName };