import { Mode } from "./index";

describe("Mode", () => {
  it("should export available modes", () => {
    expect(Mode).toEqual({
      BYPASS: "bypass",
      RECORD: "record",
      REPLAY: "replay",
      RERECORD: "rerecord"
    });
  });
});
