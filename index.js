require("dotenv").config();

const { Scraper } = require("agent-twitter-client");

const express = require("express");
const bodyParser = require("body-parser");

const scraper = new Scraper();

const app = express();
const port = 3000;
const MAX_RETRIES = 3;

app.use(bodyParser.json()); // to support JSON-encoded bodies
app.use(
  bodyParser.urlencoded({
    // to support URL-encoded bodies
    extended: true,
  })
);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendTweetWithRetry(message, replyToId) {
  let retryCount = 0;
  let lastError = null;

  while (retryCount < MAX_RETRIES) {
    try {
      const response = await scraper.sendTweet(message, replyToId);
      const tweetData = await response.json();

      console.log(tweetData);
      if (!tweetData?.data?.create_tweet?.tweet_results?.result?.rest_id) {
        throw new Error(
          tweetData.errors?.map((i) => i.message).join(", ") || "Failed to send tweet"
        );
      }

      return tweetData?.data?.create_tweet?.tweet_results?.result?.rest_id;
    } catch (error) {
      lastError = error;
      retryCount++;

      // Check if it's a session error
      if (
        error instanceof Error &&
        (error.message.includes("session") || error.message.includes("unauthorized"))
      ) {
        console.log(`Attempt ${retryCount}: Session error, trying to relogin...`);
        await loginToTwitter(scraper);
      } else {
        console.error(`Attempt ${retryCount}: Failed to send tweet:`, error);
      }

      if (retryCount < MAX_RETRIES) {
        // Exponential backoff
        await delay(Math.pow(2, retryCount) * 1000);
      }
    }
  }

  throw new Error(
    `Failed to send tweet after ${MAX_RETRIES} attempts. Last error: ${lastError?.message}`
  );
}

// Replace these with your own secrets and store them securely.
// In production, never hard-code credentials.
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

// Basic Authentication middleware
function basicAuth(req, res, next) {
  // The Authorization header should look like "Basic base64encodedString"
  const authHeader = req.headers.authorization;

  // If there is no Authorization header or it doesn't start with "Basic", return 401
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    // Prompt for credentials with the WWW-Authenticate header
    res.setHeader("WWW-Authenticate", 'Basic realm="Secure Area"');
    return res.status(401).send("Unauthorized");
  }

  // Extract base64 encoded credentials
  const base64Credentials = authHeader.substring(6).trim();
  const decoded = Buffer.from(base64Credentials, "base64").toString("utf8");
  const [clientId, clientSecret] = decoded.split(":");

  // Compare against your stored credentials
  if (clientId === CLIENT_ID && clientSecret === CLIENT_SECRET) {
    return next(); // Credentials are valid, move on
  } else {
    // Invalid credentials, prompt again
    res.setHeader("WWW-Authenticate", 'Basic realm="Secure Area"');
    return res.status(401).send("Unauthorized");
  }
}

app.post("/send-tweet", basicAuth, async (req, res) => {
  try {
    const messages = req.body.messages;
    console.log(messages);
    const cookies = await scraper.getCookies();
    if (cookies) {
      await scraper.setCookies(cookies);
    }

    let previousTweetId = null;
    for (const message of messages) {
      // Send tweet with retry logic
      previousTweetId = await sendTweetWithRetry(message, previousTweetId);
    }

    res.status(200).send({ message: "Tweets sent successfully", statusCode: 200 });
  } catch (e) {
    console.log(e);
    res.status(500).send({ message: e.message, statusCode: 500 });
  }
});

app.listen(port, async () => {
  console.log(`Example app listening on port ${port}`);
  const username = process.env.TWITTER_USERNAME;
  const password = process.env.TWITTER_PASSWORD;
  const email = process.env.TWITTER_EMAIL;
  const twoFactorSecret = process.env.TWITTER_2FA_SECRET;
  await scraper.clearCookies();
  console.log("Cleared cookies");
  await scraper.logout();
  console.log("Logged out");
  console.log(`Username: ${username}, password: ${password}, email: ${email}`);
  await scraper.login(username, password, email, twoFactorSecret);
  console.log("Logged in to scraper");
});
