module.exports = {
  moduleNameMapper: {
    "back-to-the-fixture": "<rootDir>/src"
  },
  preset: "ts-jest",

  // ! Required for recorder to run across all tests
  setupFiles: ["./dist"],

  testEnvironment: "node",

  // ! Required to prevent `rerecord` from triggering builds
  // TODO: Move this to a preset
  watchPathIgnorePatterns: ["__fixtures__"],

  // ! Required for `r` shortcut
  watchPlugins: ["./dist/JestWatchPlugin"]
};
