import debug from "debug";

import { Mode, recorder } from "./index";
import { log } from "./log";

debug.enable("back-to-the-fixture");

module.exports = class JestWatchPLugin {
  changeMode() {
    switch (recorder.mode) {
      case Mode.RECORD:
        return recorder.rerecord();
      case Mode.RERECORD:
        return recorder.replay();
      case Mode.REPLAY:
        return recorder.ignore();
      case Mode.IGNORE:
        return recorder.record();
    }
  }

  getUsageInfo() {
    return {
      key: "r",
      prompt: `change recording mode from "${recorder.mode}"`
    };
  }

  // ! There seems to be a bug/race-condition where I cannot `await`
  // ! and _then_ set process.env.RECORDER_MODE
  async run() {
    this.changeMode();

    const { mode } = recorder;

    process.env.RECORDER_MODE = mode;

    log("recorder set to %o", mode);
  }
};
