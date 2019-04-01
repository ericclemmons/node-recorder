module.exports = {
  normalizers: [
    function fakeOauthToken(request, response) {
      const fakeToken = "FAKE_ACCESS_TOKEN";

      // Replace `?access_token=...`
      if (request.url.query && request.url.query.access_token) {
        request.url.query.access_token = fakeToken;
      }

      // Replace `Authorization: Bearer ...`
      if (request.headers.authorization) {
        request.headers.authorization = `Bearer ${fakeToken}`;
      }

      // Replace `{ access_token: '...' }`
      if (response && response.body.access_token) {
        response.body.access_token = fakeToken;
      }
    }
  ]
};
