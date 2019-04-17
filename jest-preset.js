module.exports = {
  // ! Required for recorder to run across all tests
  setupFiles: [require.resolve("./dist")],

  // ! Required to prevent `rerecord` from triggering builds
  // ? Commenting this out, since it doesn't seem to be a problem
  // watchPathIgnorePatterns: [recorder.fixturesPath],

  // ! Required for `r` shortcut
  watchPlugins: [require.resolve("./dist/JestWatchPlugin")]
};
