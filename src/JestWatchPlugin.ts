import { Mode, recorder } from "./index";

const chalk = require("chalk");
const ansi = require("ansi-escapes");

module.exports = class JestWatchPlugin {
  changeMode() {
    switch (recorder.getMode()) {
      case Mode.REPLAY:
        return recorder.record();
      case Mode.RECORD:
        return recorder.rerecord();
      case Mode.RERECORD:
        return recorder.bypass();
      case Mode.BYPASS:
        return recorder.replay();
    }
  }

  getUsageInfo() {
    return {
      key: "r",
      prompt: `change recording mode from "${chalk
        .keyword("orange")
        .bold.inverse(recorder.getModeEnum())}"`
    };
  }

  // ! There seems to be a bug/race-condition where I cannot `await`
  // ! and _then_ set process.env.RECORDER
  async run() {
    this.changeMode();

    // Scroll up so that repeated presses of `r` don't spam the console
    process.stdout.write(recorder.getModeBanner() + ansi.cursorUp(7));

    // Set the mode for the next test worker's process
    process.env.RECORDER = recorder.getMode();
  }
};
