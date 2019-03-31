const { merge } = require("lodash");
console.log(require("ts-jest/jest-preset"));

module.exports = merge(
  {
    moduleNameMapper: {
      "back-to-the-fixture": "<rootDir>/src"
    },
    testEnvironment: "node"
  },
  require("ts-jest/jest-preset"),
  require("./dist/jest-preset")
);
