import { recorder } from "back-to-the-fixture";
import fetch from "node-fetch";

describe("recorder", () => {
  describe(".ignore()", () => {
    it("should ignore fixtures & make the call", async () => {
      recorder.ignore();

      const res = await fetch("https://randomuser.me/api");
      const person = await res.json();

      expect(person).toThrowErrorMatchingSnapshot();
    });
  });

  describe(".record()", () => {
    it.todo("should record missing fixtures");

    it("should keep existing fixtures", async () => {
      recorder.record();

      const res = await fetch("https://randomuser.me/api");
      const person = await res.json();

      expect(person).toMatchSnapshot();
    });
  });

  describe(".replay", () => {
    beforeEach(() => recorder.replay());

    it("should replay existing fixtures", async () => {
      const res = await fetch("https://randomuser.me/api");
      const person = await res.json();

      expect(person).toMatchSnapshot();
    });

    it("should throw when a fixture doesn't exist", async () => {
      expect(
        fetch("https://some.fake.api/")
      ).rejects.toThrowErrorMatchingSnapshot();
    });
  });

  describe(".rerecord()", () => {
    it.skip("should replace existing fixtures", async () => {
      recorder.rerecord();

      const res = await fetch("https://randomuser.me/api");
      const person = await res.json();

      expect(person).toMatchSnapshot();
    });
  });
});
