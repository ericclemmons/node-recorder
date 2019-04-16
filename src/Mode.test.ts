import { Mode } from "node-recorder";

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
