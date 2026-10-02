import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  __setDbOverride,
  schema,
  type Database,
  type PooledDatabase,
} from "@baumy/db";
import { createAuth, type Auth } from "../config";
import { PASSWORD_MIN_LENGTH } from "../password";
import { PASSKEY_NOT_CONFIRMED, STEP_UP_PASSKEY_PATH } from "../step-up";

// "Confirm it's you" with a passkey (issue #135): the server-only endpoint
// that checks a WebAuthn assertion for the signed-in account and makes no
// session. Against the real Better Auth instance and Postgres (PGlite), with
// a software authenticator: an ES256 key whose COSE public key is stored as
// the passkey, signing the challenge Better Auth's own options endpoint made.

const MIGRATIONS = fileURLToPath(
  new URL("../../../db/migrations", import.meta.url),
);
const ORIGIN = "http://localhost:3000";
const RP_ID = "localhost";

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let auth: Auth;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  __setDbOverride({
    http: db as unknown as Database,
    pooled: {
      db: db as unknown as PooledDatabase["db"],
      pool: { end: async () => {} } as unknown as PooledDatabase["pool"],
    },
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  auth = createAuth({ BETTER_AUTH_URL: ORIGIN, E2E_TEST_MODE: "1" });
}, 60_000);

afterAll(async () => {
  __setDbOverride(null);
  await client.close();
  vi.restoreAllMocks();
});

/** `name=value` pairs of a response's Set-Cookie headers, as a Cookie header. */
function cookiesOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

let seq = 0;
async function signUp(): Promise<{ userId: string; cookie: string }> {
  seq += 1;
  const res = await auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({
        email: `stepper${seq}@example.com`,
        password: "stepper-passphrase".padEnd(PASSWORD_MIN_LENGTH, "x"),
        name: "Stepper",
      }),
    }),
  );
  expect(res.status).toBe(200);
  const { user } = (await res.json()) as { user: { id: string } };
  return { userId: user.id, cookie: cookiesOf(res) };
}

/** A software authenticator holding one ES256 credential. */
function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const jwk = publicKey.export({ format: "jwk" });
  const x = Buffer.from(jwk.x!, "base64url");
  const y = Buffer.from(jwk.y!, "base64url");
  // COSE_Key {1: 2 (EC2), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y}.
  const cose = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    x,
    Buffer.from([0x22, 0x58, 0x20]),
    y,
  ]);
  const credentialId = Buffer.from(
    `cred-${Math.random().toString(36).slice(2)}`,
  ).toString("base64url");
  let counter = 0;
  return {
    credentialId,
    publicKey: cose.toString("base64"),
    assert(
      challenge: string,
      opts: { origin?: string; rpId?: string } = {},
    ): Record<string, unknown> {
      counter += 1;
      const clientData = Buffer.from(
        JSON.stringify({
          type: "webauthn.get",
          challenge,
          origin: opts.origin ?? ORIGIN,
          crossOrigin: false,
        }),
      );
      const flags = 0x01 | 0x04; // user present, user verified
      const count = Buffer.alloc(4);
      count.writeUInt32BE(counter);
      const authData = Buffer.concat([
        createHash("sha256")
          .update(opts.rpId ?? RP_ID)
          .digest(),
        Buffer.from([flags]),
        count,
      ]);
      const signature = sign(
        "sha256",
        Buffer.concat([
          authData,
          createHash("sha256").update(clientData).digest(),
        ]),
        privateKey,
      );
      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientData.toString("base64url"),
          authenticatorData: authData.toString("base64url"),
          signature: signature.toString("base64url"),
        },
      };
    },
  };
}

async function registerPasskey(
  userId: string,
  key: ReturnType<typeof authenticator>,
) {
  const [row] = await db
    .insert(schema.passkey)
    .values({
      id: `pk-${key.credentialId}`,
      userId,
      credentialID: key.credentialId,
      publicKey: key.publicKey,
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      transports: "internal",
    })
    .returning();
  return row!;
}

/** Better Auth's own options endpoint: the challenge and its cookie. */
async function challengeFor(cookie: string) {
  const res = await auth.handler(
    new Request(`${ORIGIN}/api/auth/passkey/generate-authenticate-options`, {
      headers: { cookie, origin: ORIGIN },
    }),
  );
  expect(res.status).toBe(200);
  const options = (await res.json()) as {
    challenge: string;
    allowCredentials?: { id: string }[];
  };
  return { options, cookie: `${cookie}; ${cookiesOf(res)}` };
}

function verify(cookie: string, response: Record<string, unknown>) {
  return auth.api.verifyStepUpPasskey({
    body: { response },
    headers: new Headers({ cookie, origin: ORIGIN }),
  });
}

async function sessionCount(userId: string) {
  return (
    await db
      .select()
      .from(schema.session)
      .where(eq(schema.session.userId, userId))
  ).length;
}

describe("verifyStepUpPasskey", () => {
  it("is SERVER_ONLY and not reachable over HTTP", async () => {
    expect(
      (
        auth.api.verifyStepUpPasskey as unknown as {
          options: { metadata?: { SERVER_ONLY?: boolean } };
        }
      ).options.metadata?.SERVER_ONLY,
    ).toBe(true);
    const { cookie } = await signUp();
    const res = await auth.handler(
      new Request(`${ORIGIN}/api/auth${STEP_UP_PASSKEY_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, cookie },
        body: JSON.stringify({ response: {} }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("confirms the account's own passkey once, makes no session and moves the counter", async () => {
    const { userId, cookie } = await signUp();
    const key = authenticator();
    const pk = await registerPasskey(userId, key);
    const { options, cookie: withChallenge } = await challengeFor(cookie);
    // Signed in, the options name only this account's passkeys.
    expect(options.allowCredentials?.map((c) => c.id)).toEqual([
      key.credentialId,
    ]);
    const before = await sessionCount(userId);

    const response = key.assert(options.challenge);
    await expect(verify(withChallenge, response)).resolves.toEqual({
      passkeyId: pk.id,
    });
    expect(await sessionCount(userId)).toBe(before);
    const [after] = await db
      .select()
      .from(schema.passkey)
      .where(eq(schema.passkey.id, pk.id));
    expect(after!.counter).toBe(1);

    // The challenge was used: the same assertion again is refused.
    await expect(verify(withChallenge, response)).rejects.toMatchObject({
      statusCode: 401,
      body: { code: "STEP_UP_FAILED", message: PASSKEY_NOT_CONFIRMED },
    });
  });

  it("refuses without a challenge, or without a session", async () => {
    const { userId, cookie } = await signUp();
    const key = authenticator();
    await registerPasskey(userId, key);
    const { options, cookie: withChallenge } = await challengeFor(cookie);
    await expect(
      verify(cookie, key.assert(options.challenge)),
    ).rejects.toMatchObject({ statusCode: 401 });
    // The session cookie removed: only the challenge cookie is left.
    const challengeOnly = withChallenge
      .split("; ")
      .filter((c) => !c.startsWith("baumy.session_token="))
      .join("; ");
    await expect(
      verify(challengeOnly, key.assert(options.challenge)),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("refuses another account's passkey", async () => {
    const me = await signUp();
    const other = await signUp();
    const theirs = authenticator();
    await registerPasskey(other.userId, theirs);
    const { options, cookie } = await challengeFor(me.cookie);
    await expect(
      verify(cookie, theirs.assert(options.challenge)),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("refuses a challenge made for another account's session", async () => {
    const me = await signUp();
    const other = await signUp();
    const key = authenticator();
    await registerPasskey(me.userId, key);
    // The other account's challenge cookie, sent with my session.
    const theirs = await challengeFor(other.cookie);
    const challengeCookie = theirs.cookie
      .split("; ")
      .filter((c) => !c.startsWith("baumy.session_token="))
      .join("; ");
    await expect(
      verify(
        `${me.cookie}; ${challengeCookie}`,
        key.assert(theirs.options.challenge),
      ),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("refuses a wrong challenge, origin, rp id or signature", async () => {
    const { userId, cookie } = await signUp();
    const key = authenticator();
    await registerPasskey(userId, key);
    const cases: ((challenge: string) => Record<string, unknown>)[] = [
      () => key.assert(Buffer.from("not the challenge").toString("base64url")),
      (c) => key.assert(c, { origin: "https://evil.example" }),
      (c) => key.assert(c, { rpId: "evil.example" }),
      (c) => {
        const r = key.assert(c) as {
          response: { signature: string };
        } & Record<string, unknown>;
        const sig = Buffer.from(r.response.signature, "base64url");
        sig[sig.length - 1] ^= 0xff;
        return {
          ...r,
          response: { ...r.response, signature: sig.toString("base64url") },
        };
      },
    ];
    for (const make of cases) {
      const { options, cookie: withChallenge } = await challengeFor(cookie);
      await expect(
        verify(withChallenge, make(options.challenge)),
      ).rejects.toMatchObject({ statusCode: 401 });
    }
    // And the right one still works, so the refusals above were the checks.
    const { options, cookie: withChallenge } = await challengeFor(cookie);
    await expect(
      verify(withChallenge, key.assert(options.challenge)),
    ).resolves.toMatchObject({ passkeyId: expect.any(String) });
  });
});

describe("verifyStepUpPasskey with passkeys off", () => {
  it("refuses every call", async () => {
    const off = createAuth({
      BETTER_AUTH_URL: ORIGIN,
      E2E_TEST_MODE: "1",
      // An rp id the site is not under: passkeys off (resolvePasskeyScope).
      PASSKEY_RP_ID: "elsewhere.example",
    });
    const { cookie } = await signUp();
    await expect(
      off.api.verifyStepUpPasskey({
        body: { response: { id: "x" } },
        headers: new Headers({ cookie, origin: ORIGIN }),
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});
