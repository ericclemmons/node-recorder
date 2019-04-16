import { Mode, recorder } from "./index";

const chalk = require("chalk");

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
      prompt: `change recording mode from "${chalk.keyword("yellow")(
        recorder.getModeEnum()
      )}"`
    };
  }

  // ! There seems to be a bug/race-condition where I cannot `await`
  // ! and _then_ set process.env.RECORDER
  async run() {
    this.changeMode();

    process.env.RECORDER = recorder.getMode();
  }
};
