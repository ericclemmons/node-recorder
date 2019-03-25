module.exports = function compareBuffers(lhs, rhs) {
  if (lhs.length !== rhs.length) {
    return false;
  }

  for (let i = 0; i < lhs.length; ++i) {
    if (lhs[i] !== rhs[i]) {
      return false;
    }
  }

  return true;
};
