module.exports = {
  ignore(request) {
    // Ignore all internal calls
    if (request.href.startsWith("http://127.0.0.1/")) {
      return true;
    }

    return false;
  },

  identify(request, response) {
    const { authorization } = request.headers;
    const { pathname, query } = request.url;
    const { access_token, username } = query;

    // Identify any calls with `?access_token=...`
    if (access_token) {
      return access_token;
    }

    // Identify any calls with `Authorization: Bearer ...`
    if (authorization) {
      const [, token] = authorization.split("Bearer ");

      return token;
    }

    if (pathname === "/oauth/token" && username) {
      // Identify requests by `/oauth/token?username=...`
      if (!response) {
        return username;
      }

      // Associate `{ access_token: ... }` with `?username=...`
      return [username, response.body.access_token];
    }
  }
};
