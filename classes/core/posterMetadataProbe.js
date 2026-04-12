const axios = require("axios");

/**
 * Best-effort: true if the image URL is gone (404/410). Network errors → false (do not purge).
 * @param {string} url
 */
async function probeImageUrlGone(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const res = await axios({
      url,
      method: "HEAD",
      timeout: 15000,
      validateStatus: () => true,
      maxRedirects: 5,
    });
    if (res.status === 404 || res.status === 410) return true;
    if (res.status === 405) {
      const g = await axios.get(url, {
        timeout: 15000,
        validateStatus: () => true,
        maxContentLength: 4096,
      });
      return g.status === 404 || g.status === 410;
    }
    return false;
  } catch (e) {
    return false;
  }
}

module.exports = { probeImageUrlGone };
