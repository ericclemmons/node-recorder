const tokens = new Map();
const mockTokens = new Map();

module.exports = {
  normalizers: [
    function fakeOauthToken(request, response) {
      // Replace `?access_token=...`
      if (request.url.query.access_token) {
        const { access_token } = request.url.query;
        const mockToken = mockTokens.get(access_token);

        if (mockToken) {
          request.url.query.access_token = mockToken;
        }
      }

      // Replace `Authorization: Bearer ...`
      if (request.headers.authorization) {
        const [, access_token] = request.headers.authorization.split(" ");
        const mockToken = mockTokens.get(access_token);

        if (mockToken) {
          request.headers.authorization = `Bearer ${mockToken}`;
        }
      }

      // Replace `/oauth/token`'s response:
      //   { access_token: '...' }`
      if (response && response.body.access_token) {
        const { username } = request.url.query;
        const { access_token } = request.body;
        const mockToken = `${username}_access_token`;

        // Associate username with real access token
        tokens.set(username, access_token);
        // Associate real access token fake one
        mockTokens.set(access_token, mockToken);

        // Replace tokens with username for
        response.body.access_token = mockToken;
      }
    }
  ]
};
