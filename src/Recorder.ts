import * as http from "http";
import * as https from "https";
import * as nock from "nock";

import { Mode } from "./Mode";

const REQUEST_ARGUMENTS = new WeakMap();

nock.restore();

enum Methods {
  GET = "GET",
  POST = "POST"
}

interface Headers {
  [key: string]: string;
}

interface InterceptedRequest {
  body: string;
  headers: {
    [key: string]: string;
  };
  method: Methods;
  options: {
    [key: string]: string;
  }; // http.RequestOptions;
  respond: nock.ReplyCallback;
}

export class Recorder {
  httpRequest = http.request;
  httpsRequest = https.request;
  mode: Mode = Mode.IGNORE;

  constructor() {
    this.setupNock();
    this.patchNock();
  }

  handleRequest = (interceptedRequest: InterceptedRequest) => {
    const { mode } = this;

    switch (mode) {
      case Mode.IGNORE:
        return this.ignoreRequest(interceptedRequest);

      default:
        throw new Error(`Mode.${mode} is not supported`);
    }
  };

  ignore() {
    this.mode = Mode.IGNORE;
  }

  ignoreRequest = async (interceptedRequest: InterceptedRequest) => {
    const { body, headers, method, options, respond } = interceptedRequest;

    const request = (options.proto === "https"
      ? this.httpsRequest
      : this.httpRequest)({
      ...options,
      method,
      headers
    });

    const responsePromise = new Promise((resolve, reject) => {
      request.once("response", resolve);
      request.once("error", reject);
      request.once("timeout", reject);
    });

    request.write(body);
    request.end();

    const response = (await responsePromise) as http.IncomingMessage;
    const responseBody = await new Promise((resolve, reject) => {
      const chunks: any[] = [];

      response.on("data", (chunk) => chunks.push(chunk));
      response.once("end", () => {
        const { headers } = response;

        if (
          headers["content-encoding"] === "gzip" &&
          headers["transfer-encoding"] === "chunked"
        ) {
          const decoded = Buffer.concat(chunks);

          resolve(decoded);
        } else {
          resolve(Buffer.concat(chunks).toString("utf8"));
        }
      });

      response.once("error", reject);
    });

    respond(null, [response.statusCode, responseBody, response.headers]);
  };

  record() {
    this.mode = Mode.RECORD;
  }

  replay() {
    this.mode = Mode.REPLAY;
  }

  rerecord() {
    this.mode = Mode.RERECORD;
  }

  patchNock = () => {
    // This is Nock's `OverriddenClientRequest`
    const { ClientRequest } = http;

    // @ts-ignore
    http.ClientRequest = function recordClientRequest(
      url: string | URL | http.ClientRequestArgs,
      cb?: (res: http.IncomingMessage) => void
    ) {
      const req = new ClientRequest(url, cb);

      REQUEST_ARGUMENTS.set(req, [url, cb]);

      return req;
    };
  };

  setupNock = () => {
    nock.cleanAll();

    const interceptor = nock(/.*/).persist();
    const recorder = this;

    Object.keys(Methods).forEach((m) => {
      interceptor
        .intercept(/.*/, m)
        .reply(async function reply(uri, body, respond) {
          // @ts-ignore
          const { method, req } = this as any;
          const { headers } = req;
          const [options] = REQUEST_ARGUMENTS.get(req);

          const interceptedRequest: InterceptedRequest = {
            body,
            headers,
            method,
            options,
            respond: respond as nock.ReplyCallback
          };

          recorder.handleRequest(interceptedRequest);
        });
    });

    nock.activate();
  };
}
