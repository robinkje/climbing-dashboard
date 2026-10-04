import crypto from "node:crypto";
import fs from "node:fs/promises";
import { chromium } from "playwright-core";

const AUTH_URL = "https://vlatka.vertical-life.info/auth/realms/Vertical-Life/protocol/openid-connect/auth";
const EXPORT_URL = "https://www.8a.nu/api/unification/ascent/v1/web/ascents/export-csv";
const EXPECTED_HEADER = '"route_boulder","name","location_name","sector_name","area_name","country_code","date","type","sub_type","rating","project","tries","repeats","difficulty","perceived_hardness","comment","height","recommended","sits"';
const OUTPUT_PATH = new URL("../data.csv", import.meta.url);

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set.`);
  return value;
}

function base64url(value) {
  return value.toString("base64url");
}

function buildAuthUrl() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", "8a-nu");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", "https://www.8a.nu/callback");
  url.searchParams.set("state", base64url(crypto.randomBytes(16)));
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function waitForSession(context, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cookies = await context.cookies("https://www.8a.nu");
    if (cookies.some((cookie) => cookie.name === "nu8a_session")) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("8a.nu login did not create a session. Check the credentials and the workflow log for a site or Cloudflare change.");
}

function validateCsv(csv) {
  const text = csv.replace(/^\uFEFF/, "");
  const lineEnd = text.indexOf("\n");
  const header = text.slice(0, lineEnd === -1 ? undefined : lineEnd).replace(/\r$/, "");
  if (header !== EXPECTED_HEADER) {
    throw new Error("8a.nu returned an unexpected CSV format; refusing to replace data.csv.");
  }
  if (lineEnd === -1 || !text.slice(lineEnd + 1).trim()) {
    throw new Error("8a.nu returned no ascent records; refusing to replace data.csv.");
  }
}

async function main() {
  const username = requireEnvironment("EIGHTA_USERNAME");
  const password = requireEnvironment("EIGHTA_PASSWORD");
  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: ["--disable-dev-shm-usage"],
  });

  try {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();

    await page.goto(buildAuthUrl(), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await page.locator("#kc-login").click();
    await waitForSession(context);

    await page.goto("https://www.8a.nu/", { waitUntil: "domcontentloaded", timeout: 60_000 });
    const result = await page.evaluate(async (url) => {
      const response = await fetch(url, { credentials: "include" });
      return { status: response.status, body: await response.text() };
    }, EXPORT_URL);

    if (result.status !== 200) throw new Error(`8a.nu export failed with HTTP ${result.status}.`);
    validateCsv(result.body);
    await fs.writeFile(OUTPUT_PATH, result.body, "utf8");
    console.log("Updated data.csv from 8a.nu.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
