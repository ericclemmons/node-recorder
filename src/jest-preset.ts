const { resolve } = require("path");

const { recorder } = require("./index");

module.exports = {
  // ! Required for recorder to run across all tests
  setupFiles: [require.resolve("./")],

  // ! Required to prevent `rerecord` from triggering builds
  watchPathIgnorePatterns: [recorder.fixturesPath],

  // ! Required for `r` shortcut
  watchPlugins: [require.resolve("./JestWatchPlugin")]
};
