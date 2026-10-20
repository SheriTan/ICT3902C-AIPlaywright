// Looks up a test user by display name in the DEMO environment's credentials file.

const { loadConfig } = require('../global/configLoader');

/**
 * @param {string} name - the user's "Name" in the credentials file, case-insensitive (e.g. 'Jack Howe')
 * @returns {{ Name: string, Email: string, Password: string }}
 */
function getUserByName(name) {
  const { credentials } = loadConfig();
  const users = [...(credentials.admin || []), ...(credentials.user || [])];

  const user = users.find((candidate) => candidate.Name.toLowerCase() === name.toLowerCase());
  if (!user) {
    throw new Error(`No credential found for user "${name}"`);
  }

  return user;
}

module.exports = { getUserByName };
