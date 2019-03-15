import * as fs from "fs";
import * as globby from "globby";
import { omit, pick } from "lodash";
import * as mkdirp from "mkdirp";
import * as nock from "nock";
import * as path from "path";
import * as url from "url";
import * as zlib from "zlib";

import { Call } from "./Call";

const fnv1a = require("@sindresorhus/fnv1a");

import { Mode } from "./Mode";

interface Filter {
  (call: Call, index: number, calls: Call[]): boolean;
}

interface Options {
  filter?: Filter;
  mode?: Mode;
  fixturesPath?: string;
  user?: string;
}

export const DefaultOptions = {
  filter: (call: Call) => true,
  mode: Mode.LIVE,
  fixturesPath: path.join(process.cwd(), "__fixtures__"),
  user: "all"
};

export class Recorder {
  filter = DefaultOptions.filter;
  mode = DefaultOptions.mode;
  fixturesPath = DefaultOptions.fixturesPath;
  user = DefaultOptions.user;

  constructor(options?: Options) {
    if (options) {
      this.configure(options);
    }

    nock.restore();
    nock.cleanAll();

    if (!nock.isActive()) {
      nock.activate();
    }
  }

  configure(options: Options) {
    Object.assign(this, DefaultOptions, options);

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

    return this;
  }

  getFixturePath(call: Call, username = "all") {
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
      .map(file => JSON.parse(fs.readFileSync(file, "utf8")))
      .filter(this.filter)
      .forEach((call: Call) => {
        const { reqheaders } = call;

        nock(call.scope, { reqheaders })
          .intercept(call.path, call.method as string, call.body)
          .reply(call.status as number, call.response)
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
      enable_reqheaders_recording: true,
      logging: args => {
        // nock uses a singleton for recording, so we have to clear the stack to prevent race-conditions
        const calls: Call[] = nock.recorder.play() as any;

        nock.recorder.clear();

        calls
          .map((call: Call) => {
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

              try {
                call.response = JSON.parse(unzipped);
              } catch (error) {
                // Not all content is JSON!
              }
            }

            const headers: { [key: string]: string } = {};

            while (call.rawHeaders.length) {
              // @ts-ignore Object is possibly 'undefined'.ts(2532)
              const header = call.rawHeaders.shift().toLowerCase();
              const value = call.rawHeaders.shift();

              // @ts-ignore Type 'string | undefined' is not assignable to type 'string'.
              // Type 'undefined' is not assignable to type 'string'.ts(2322)
              headers[header] = value;
            }

            // Sorted
            call.headers = Object.keys(headers)
              .sort((a, b) => b.localeCompare(a))
              .reduce((acc, header) => {
                return {
                  [header]: headers[header],
                  ...acc
                };
              }, {});

            return call;
          })
          .filter(this.filter)
          .forEach((call: Call) => {
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
