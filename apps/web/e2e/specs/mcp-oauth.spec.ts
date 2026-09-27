import { createHash, randomBytes } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { PASSWORD, founderEmail } from "../lib/accounts";
import { founderAdmin, newAccount } from "../lib/household";

// Issue #23 end to end, against Docker Postgres: a scripted MCP client
// (standing in for claude.ai) discovers the authorization server, registers
// with Dynamic Client Registration, sends the member through the consent
// page, exchanges the code with PKCE S256, refreshes and is disconnected on
// /settings/connections. The token is checked through the test-only
// /api/test/mcp-token, which calls the same verifyToken the MCP endpoint
// will (issue #24).

// One worker runs this file's tests in order: they share this project's
// founder, and the connections page lists all of that founder's clients.
test.describe.configure({ mode: "default" });

// A loopback redirect, as Claude Desktop and Claude Code use. Nothing listens
// there: the browser's navigation to it is caught by page.route.
const REDIRECT = "http://127.0.0.1:47823/callback";

interface Meta {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  revocation_endpoint: string;
  scopes_supported: string[];
  code_challenge_methods_supported: string[];
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
}

async function discover(request: APIRequestContext): Promise<Meta> {
  const res = await request.get("/.well-known/oauth-authorization-server");
  expect(res.status()).toBe(200);
  const meta = (await res.json()) as Meta;
  expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
  expect(meta.scopes_supported).toEqual(["baumy:read", "baumy:write"]);
  const resource = await request.get("/.well-known/oauth-protected-resource");
  expect((await resource.json()).authorization_servers).toEqual([meta.issuer]);
  return meta;
}

async function register(
  request: APIRequestContext,
  meta: Meta,
  name: string,
): Promise<string> {
  const res = await request.post(meta.registration_endpoint, {
    data: { client_name: name, redirect_uris: [REDIRECT] },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function authorizeUrl(meta: Meta, clientId: string, challenge: string) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "e2e-state",
    scope: "baumy:read baumy:write",
  });
  return `${meta.authorization_endpoint}?${q}`;
}

/** Catch the navigation back to the client and hand over its query. */
function catchCallback(page: Page): Promise<URL> {
  return new Promise((resolve) => {
    void page.route(`${REDIRECT}**`, async (route) => {
      resolve(new URL(route.request().url()));
      await route.fulfill({ status: 200, body: "connected" });
    });
  });
}

async function exchange(
  request: APIRequestContext,
  meta: Meta,
  clientId: string,
  code: string,
  verifier: string,
): Promise<Tokens> {
  const res = await request.post(meta.token_endpoint, {
    form: {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
    },
  });
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toBe("no-store");
  return (await res.json()) as Tokens;
}

async function verify(request: APIRequestContext, token: string) {
  return request.get("/api/test/mcp-token", {
    headers: { authorization: `Bearer ${token}` },
  });
}

const unique = (label: string) =>
  `${label} ${Math.random().toString(36).slice(2, 8)}`;

test("a scripted client completes the OAuth round trip and is disconnected", async ({
  page,
  request,
}, testInfo) => {
  await founderAdmin(page, testInfo.project.name);
  const meta = await discover(request);
  const name = unique("E2E Claude");
  const clientId = await register(request, meta, name);
  const { verifier, challenge } = pkce();

  const callback = catchCallback(page);
  const landed = await page.goto(authorizeUrl(meta, clientId, challenge));
  await expect(page).toHaveURL(/\/oauth\/consent\?/);
  // No other site may frame the consent screen (clickjacking).
  expect(landed?.headers()["x-frame-options"]).toBe("DENY");
  expect(landed?.headers()["content-security-policy"]).toBe(
    "frame-ancestors 'none'",
  );
  await expect(
    page.getByRole("heading", { name: `Connect ${name} to Baumy` }),
  ).toBeVisible();
  // Each tool's consent line is listed under its scope.
  await expect(
    page.getByRole("list", { name: "baumy:read tools" }),
  ).toContainText("Your name, role and colour in the household");
  const read = page.getByLabel("Read Baumy (baumy:read)");
  const write = page.getByLabel("Make changes as you (baumy:write)");
  await expect(read).toBeChecked();
  await expect(write).not.toBeChecked();
  await write.check();
  await page.getByRole("button", { name: "Approve" }).click();

  const back = await callback;
  expect(back.searchParams.get("state")).toBe("e2e-state");
  const code = back.searchParams.get("code")!;
  expect(code).toMatch(/^baumy_ac_/);

  const tokens = await exchange(request, meta, clientId, code, verifier);
  expect(tokens.token_type).toBe("Bearer");
  expect(tokens.scope).toBe("baumy:read baumy:write");
  const who = await verify(request, tokens.access_token);
  expect(who.status()).toBe(200);
  expect((await who.json()).scopes).toEqual(["baumy:read", "baumy:write"]);

  // The code works once.
  const again = await request.post(meta.token_endpoint, {
    form: {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
    },
  });
  expect((await again.json()).error).toBe("invalid_grant");

  // Refresh rotates: the old access token stops working.
  const refreshed = await request.post(meta.token_endpoint, {
    form: {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    },
  });
  expect(refreshed.status()).toBe(200);
  const next = (await refreshed.json()) as Tokens;
  expect((await verify(request, tokens.access_token)).status()).toBe(401);
  expect((await verify(request, next.access_token)).status()).toBe(200);

  // The member disconnects it on /settings/connections.
  await page.goto("/settings");
  await page.getByRole("link", { name: "Manage connected apps" }).click();
  await expect(
    page.getByRole("heading", { name: "Connected apps", level: 1 }),
  ).toBeVisible();
  const card = page.getByRole("listitem").filter({ hasText: name });
  await expect(card).toContainText("Read and write");
  await card.getByRole("button", { name: `Disconnect ${name}` }).click();
  await expect(page.getByText(`${name} is disconnected.`)).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: name }),
  ).toHaveCount(0);
  expect((await verify(request, next.access_token)).status()).toBe(401);
  const dead = await request.post(meta.token_endpoint, {
    form: {
      grant_type: "refresh_token",
      refresh_token: next.refresh_token,
      client_id: clientId,
    },
  });
  expect((await dead.json()).error).toBe("invalid_grant");
});

test("leaving baumy:write unticked yields a read-only token", async ({
  page,
  request,
}, testInfo) => {
  await founderAdmin(page, testInfo.project.name);
  const meta = await discover(request);
  const clientId = await register(request, meta, unique("E2E Reader"));
  const { verifier, challenge } = pkce();

  const callback = catchCallback(page);
  await page.goto(authorizeUrl(meta, clientId, challenge));
  await expect(page.getByLabel("Read Baumy (baumy:read)")).toBeChecked();
  await page.getByRole("button", { name: "Approve" }).click();
  const code = (await callback).searchParams.get("code")!;

  const tokens = await exchange(request, meta, clientId, code, verifier);
  expect(tokens.scope).toBe("baumy:read");
  const who = await verify(request, tokens.access_token);
  expect((await who.json()).scopes).toEqual(["baumy:read"]);
});

test("sign-in returns to consent, and an account with no member row gets no code", async ({
  browser,
  request,
}, testInfo) => {
  const project = testInfo.project.name;
  const meta = await discover(request);
  const clientId = await register(request, meta, unique("E2E Gate"));
  const { challenge } = pkce();
  const url = authorizeUrl(meta, clientId, challenge);

  // Nobody signed in: sign-in first, then straight back to the consent page.
  // (The founder exists from the tests above, or from another spec.)
  const signedOut = await browser.newContext();
  const visitor = await signedOut.newPage();
  const warm = await browser.newContext();
  await founderAdmin(await warm.newPage(), project);
  await warm.close();
  await visitor.goto(url);
  await expect(visitor).toHaveURL(/\/auth\/sign-in\?callbackURL=/);
  // The form on this very page, so its callbackURL is kept.
  await visitor.getByLabel("Email").fill(founderEmail(project));
  await visitor.getByLabel("Password").fill(PASSWORD);
  await visitor.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(visitor).toHaveURL(/\/oauth\/consent\?/);
  await expect(visitor.getByRole("button", { name: "Approve" })).toBeVisible();
  await signedOut.close();

  // A signed-in account that is not a household member goes to /join.
  const outsider = await newAccount(browser, `mcp-outsider-${project}`);
  await expect(outsider.page).toHaveURL(/\/join$/);
  let called = false;
  await outsider.page.route(`${REDIRECT}**`, async (route) => {
    called = true;
    await route.fulfill({ status: 200, body: "should not happen" });
  });
  await outsider.page.goto(url);
  await expect(outsider.page).toHaveURL(/\/join$/);
  await expect(
    outsider.page.getByRole("heading", { name: "Join the household" }),
  ).toBeVisible();
  expect(called).toBe(false);
  await outsider.context.close();
});
