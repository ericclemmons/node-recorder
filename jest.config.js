require("ts-node/register");

const { merge } = require("lodash");

module.exports = merge(
  {
    moduleNameMapper: {
      // ! Don't use this, because Jest messes up polydev's require(...)
      // "node-recorder": "<rootDir>/dist"
    },
    testEnvironment: "node"
  },
  require("ts-jest/jest-preset"),

  // @ts-ignore
  require("./src/jest-preset")
);
