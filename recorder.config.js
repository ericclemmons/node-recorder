module.exports = {
  identifier(request, response) {
    const { pathname, query } = request.url;
    const { username } = query;

    if (pathname === "/oauth/token" && username && response) {
      return [username, response.body.access_token];
    }

    const { authorization } = request.headers;

    if (authorization) {
      const [, token] = authorization.split("Bearer ");

      return token;
    }
  }
};
