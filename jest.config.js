require("ts-node/register");

const { merge } = require("lodash");

module.exports = merge(
  {
    moduleNameMapper: {
      "back-to-the-fixture": "<rootDir>/dist"
    },
    testEnvironment: "node"
  },
  require("ts-jest/jest-preset"),

  // @ts-ignore
  require("./src/jest-preset")
);
