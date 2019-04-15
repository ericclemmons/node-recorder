import { Mode, recorder } from "./index";

const chalk = require("chalk");

module.exports = class JestWatchPLugin {
  changeMode() {
    switch (recorder.getMode()) {
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
      prompt: `change recording mode from "${chalk.keyword("yellow")(
        recorder.getModeEnum()
      )}"`
    };
  }

  // ! There seems to be a bug/race-condition where I cannot `await`
  // ! and _then_ set process.env.RECORDER_MODE
  async run() {
    this.changeMode();

    process.env.RECORDER_MODE = recorder.getMode();
  }
};
