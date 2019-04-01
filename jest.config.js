const { merge } = require("lodash");

module.exports = merge(
  {
    moduleNameMapper: {
      "back-to-the-fixture": "<rootDir>/src"
    },
    testEnvironment: "node"
  },
  require("ts-jest/jest-preset"),

  // @ts-ignore
  require("./dist/jest-preset")
);
