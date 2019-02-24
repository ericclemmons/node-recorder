import * as fs from "fs";
import * as globby from "globby";
import { omit, pick } from "lodash";
import * as mkdirp from "mkdirp";
import * as nock from "nock";
import * as path from "path";
import * as url from "url";
import * as zlib from "zlib";

const fnv1a = require("@sindresorhus/fnv1a");

import { Mode } from "./Mode";

interface Options {
  mode: Mode;
  fixturesPath?: string;
  user?: string;
}

export class Recorder {
  mode = Mode.LIVE;
  fixturesPath = path.join(process.cwd(), "__fixtures__");
  user = "all";

  constructor(options: Options) {
    Object.assign(this, options);

    nock.restore();
    nock.cleanAll();

    if (!nock.isActive()) {
      nock.activate();
    }

    switch (this.mode) {
      case undefined:
        break;
      case Mode.LIVE:
        break;
      case Mode.RECORD:
        this.record(this.user);
        break;
      case Mode.REPLAY:
        this.replay(this.user);
        break;
      default:
        throw new Error(`Unknown "mode": ${this.mode}`);
    }
  }

  getFixturePath(call: nock.NockDefinition, username = "all") {
    const { hostname } = url.parse(call.scope);
    const { pathname } = url.parse(call.path);

    if (!hostname) {
      console.error(call);
      throw new Error(
        `Cannot parse hostname from fixture's "scope": ${JSON.stringify(
          call.scope
        )}`
      );
    }

    if (!pathname) {
      console.error(call);
      throw new Error(
        `Cannot parse pathname from fixture's "path": ${JSON.stringify(
          call.path
        )}`
      );
    }

    const hash = fnv1a(
      JSON.stringify(pick(call, "scope", "method", "path", "body"))
    );

    // TODO Allow `user` to be a callback here

    const file = path.join(
      this.fixturesPath,
      hostname,
      pathname,
      `${hash}.${username}.json`
    );

    // TODO Allow `fixturesPath` to be dynamic

    return file;
  }

  /**
   * Load previous recordings & mock HTTP requests
   * @see https://github.com/nock/nock#activating
   */
  replay(username = "all") {
    nock.restore();
    nock.activate();

    // Ensure we have no prior mocks conflicting
    nock.cleanAll();

    const recordings = globby.sync(`**/*.+(${username}|all).json`, {
      cwd: this.fixturesPath
    });

    recordings
      .map(pathname => path.join(this.fixturesPath, pathname))
      .forEach(file => {
        const def = JSON.parse(fs.readFileSync(file, "utf8"));

        nock(def.scope)
          .intercept(def.path, def.method, def.body)
          .reply(def.status, def.response)
          .persist();
      });
  }

  /**
   * Start recording HTTP requests as mocks
   * @see https://github.com/nock/nock#restoring
   */
  record(username = "all") {
    nock.restore();

    nock.recorder.rec({
      // Need this to trigger our logger
      dont_print: false,
      logging: () => {
        // nock uses a singleton for recording, so we have to clear the stack to prevent race-conditions
        const calls: nock.ReplyCallbackResult[] = nock.recorder.play() as any;
        nock.recorder.clear();

        calls
          // TODO Find a way of allowing a cusotm filter here
          //.filter(call => call.scope.includes('whatever);
          .forEach(call => {
            const contentEncoding =
              call.rawHeaders[call.rawHeaders.indexOf("Content-Encoding") + 1];

            const transferEncoding =
              call.rawHeaders[call.rawHeaders.indexOf("Transfer-Encoding") + 1];

            if (
              contentEncoding === "gzip" &&
              transferEncoding === "chunked" &&
              Array.isArray(call.response)
            ) {
              const decoded = Buffer.from(call.response.join(""), "hex");
              const unzipped = zlib.gunzipSync(decoded).toString("utf8");

              call.response = JSON.parse(unzipped);
            }

            const fixture = JSON.stringify(omit(call, ["rawHeaders"]), null, 2);
            const fixturePath = this.getFixturePath(call, username);

            mkdirp.sync(path.dirname(fixturePath));
            fs.writeFileSync(fixturePath, fixture);
          });
      },
      output_objects: true
    });
  }
}
