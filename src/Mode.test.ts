import { Mode } from "back-to-the-fixture";

describe("Mode", () => {
  it("should export available modes", () => {
    expect(Mode).toEqual({
      IGNORE: "ignore",
      RECORD: "record",
      REPLAY: "replay",
      RERECORD: "rerecord"
    });
  });
});
