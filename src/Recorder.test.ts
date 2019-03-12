import { Mode, Recorder } from "back-to-the-fixture";
import { readFileSync } from "fs";
import fetch from "node-fetch";

// TODO Can this map the fetch call!?
const call = {
  scope: "https://randomuser.me:443",
  method: "GET",
  path: "/api",
  body: ""
};

describe("Recorder", () => {
  describe("record", () => {
    describe("with filter", () => {
      it("should not record fixture", async () => {
        const recorder = new Recorder({
          // Don't replay randomuser APIs
          filter: call => !call.scope.startsWith("https://randomuser.me"),
          mode: Mode.RECORD
        });

        const before = JSON.parse(
          readFileSync(recorder.getFixturePath(call), "utf8")
        );

        const res = await fetch("https://randomuser.me/api");
        await res.json();

        const after = JSON.parse(
          readFileSync(recorder.getFixturePath(call), "utf8")
        );

        expect(before).toEqual(after);
      });
    });
  });

  describe("replay", () => {
    it("should return fixture", async () => {
      const recorder = new Recorder({ mode: Mode.REPLAY });
      const res = await fetch("https://randomuser.me/api");
      const json = await res.json();
      const fixture = JSON.parse(
        readFileSync(recorder.getFixturePath(call), "utf8")
      );

      expect(json).toEqual(fixture.response);
    });

    describe("with filter", () => {
      it("should not return fixture", async () => {
        const recorder = new Recorder({
          // Don't replay randomuser APIs
          filter: call => !call.scope.startsWith("https://randomuser.me"),
          mode: Mode.REPLAY
        });

        const res = await fetch("https://randomuser.me/api");
        const json = await res.json();
        const fixture = JSON.parse(
          readFileSync(recorder.getFixturePath(call), "utf8")
        );

        expect(json).not.toEqual(fixture.response);
      });
    });
  });
});
