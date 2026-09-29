import { describe, expect, it } from "vitest";
import type { Queryable } from "../index";
import { serviceTokens } from "../schema";
import { runServiceTokenCommand } from "../service-token-cli";
import {
  BRAIN_SCOPE,
  SERVICE_TOKEN_MAX_LENGTH,
  SERVICE_TOKEN_PREFIX,
  SERVICE_TOKEN_TOUCH_EVERY_MS,
  findLiveServiceToken,
  generateServiceToken,
  hashServiceToken,
  insertServiceToken,
  listServiceTokens,
  mintServiceToken,
  revokeServiceToken,
  touchServiceToken,
} from "../service-tokens";
import { useTestDb } from "./_harness";

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const NOW = new Date("2026-09-27T10:00:00Z");
const LATER = new Date("2026-09-28T10:00:00Z");

describe("service tokens", () => {
  it("mints a prefixed random token and stores only its hash", async () => {
    const token = generateServiceToken();
    expect(token.startsWith(SERVICE_TOKEN_PREFIX)).toBe(true);
    expect(token.length).toBeLessThan(SERVICE_TOKEN_MAX_LENGTH);
    expect(generateServiceToken()).not.toBe(token);

    const row = await insertServiceToken(db(), {
      name: "baumy-brain",
      token,
      scopes: [BRAIN_SCOPE],
      now: NOW,
    });
    expect(row).toMatchObject({ name: "baumy-brain", scopes: ["brain"] });
    const stored = await t.db().select().from(serviceTokens);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).toBe(hashServiceToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it("finds a live token by its plaintext, and nothing else", async () => {
    const token = generateServiceToken();
    await insertServiceToken(db(), {
      name: "baumy-brain",
      token,
      scopes: [BRAIN_SCOPE],
      now: NOW,
    });
    await expect(findLiveServiceToken(db(), token)).resolves.toMatchObject({
      name: "baumy-brain",
      scopes: ["brain"],
    });
    await expect(findLiveServiceToken(db(), `${token}x`)).resolves.toBeNull();
    await expect(findLiveServiceToken(db(), "")).resolves.toBeNull();
    await expect(
      findLiveServiceToken(db(), "x".repeat(SERVICE_TOKEN_MAX_LENGTH + 1)),
    ).resolves.toBeNull();
  });

  it("keeps one live token per name, and a revoked one stops working", async () => {
    const first = generateServiceToken();
    await insertServiceToken(db(), {
      name: "baumy-brain",
      token: first,
      scopes: [BRAIN_SCOPE],
      now: NOW,
    });
    await expect(
      insertServiceToken(db(), {
        name: "baumy-brain",
        token: generateServiceToken(),
        scopes: [BRAIN_SCOPE],
        now: NOW,
      }),
    ).resolves.toBeNull();

    await expect(
      revokeServiceToken(db(), { name: "baumy-brain", now: LATER }),
    ).resolves.toBe(true);
    await expect(findLiveServiceToken(db(), first)).resolves.toBeNull();
    await expect(
      revokeServiceToken(db(), { name: "baumy-brain", now: LATER }),
    ).resolves.toBe(false);

    // The name is free again.
    const second = generateServiceToken();
    await expect(
      insertServiceToken(db(), {
        name: "baumy-brain",
        token: second,
        scopes: [BRAIN_SCOPE],
        now: LATER,
      }),
    ).resolves.not.toBeNull();
    const list = await listServiceTokens(db());
    expect(list.map((r) => r.revokedAt)).toEqual([LATER, null]);
    expect(list[0]).not.toHaveProperty("tokenHash");
  });

  it("mintServiceToken mints once per live name, and rotates in place", async () => {
    const minted = await mintServiceToken(db(), {
      name: "baumy-brain",
      scopes: [BRAIN_SCOPE],
      now: NOW,
      mode: "mint",
    });
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(minted.token.startsWith(SERVICE_TOKEN_PREFIX)).toBe(true);
    expect(minted.row).toMatchObject({
      name: "baumy-brain",
      scopes: ["brain"],
    });
    await expect(
      mintServiceToken(db(), {
        name: "baumy-brain",
        scopes: [BRAIN_SCOPE],
        now: NOW,
        mode: "mint",
      }),
    ).resolves.toEqual({ ok: false, reason: "exists" });

    const rotated = await mintServiceToken(db(), {
      name: "baumy-brain",
      scopes: [BRAIN_SCOPE],
      now: LATER,
      mode: "rotate",
      requireLive: true,
    });
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    await expect(findLiveServiceToken(db(), minted.token)).resolves.toBeNull();
    await expect(
      findLiveServiceToken(db(), rotated.token),
    ).resolves.not.toBeNull();

    // requireLive refuses a name with no live token and mints nothing.
    await expect(
      mintServiceToken(db(), {
        name: "robot",
        scopes: [BRAIN_SCOPE],
        now: LATER,
        mode: "rotate",
        requireLive: true,
      }),
    ).resolves.toEqual({ ok: false, reason: "missing" });
    const names = (await listServiceTokens(db())).map((r) => r.name);
    expect(names).toContain("baumy-brain");
    expect(names).not.toContain("robot");
  });

  it("records a use at most every SERVICE_TOKEN_TOUCH_EVERY_MS", async () => {
    const token = generateServiceToken();
    await insertServiceToken(db(), {
      name: "baumy-brain",
      token,
      scopes: [BRAIN_SCOPE],
      now: NOW,
    });
    const found = await findLiveServiceToken(db(), token);
    expect(found?.lastUsedAt).toBeNull();
    await touchServiceToken(db(), found!, NOW);
    const touched = await findLiveServiceToken(db(), token);
    expect(touched?.lastUsedAt).toEqual(NOW);

    const soon = new Date(NOW.getTime() + SERVICE_TOKEN_TOUCH_EVERY_MS - 1);
    await touchServiceToken(db(), touched!, soon);
    expect((await findLiveServiceToken(db(), token))?.lastUsedAt).toEqual(NOW);

    const due = new Date(NOW.getTime() + SERVICE_TOKEN_TOUCH_EVERY_MS);
    await touchServiceToken(db(), touched!, due);
    const [listed] = await listServiceTokens(db());
    expect(listed?.lastUsedAt).toEqual(due);
  });
});

describe("the service-token command", () => {
  function io() {
    const out: string[] = [];
    const info: string[] = [];
    return {
      out,
      info,
      io: {
        out: (l: string) => out.push(l),
        info: (l: string) => info.push(l),
      },
    };
  }
  const run = (argv: string[], sink: ReturnType<typeof io>, now = NOW) =>
    runServiceTokenCommand(argv, {
      db: db(),
      transaction: (fn) =>
        t.db().transaction((tx) => fn(tx as unknown as Queryable)),
      now,
      io: sink.io,
    });

  it("mints: the token alone on stdout, once, with the brain scope by default", async () => {
    const s = io();
    await expect(run(["mint", "baumy-brain"], s)).resolves.toBe(0);
    expect(s.out).toHaveLength(1);
    const token = s.out[0]!;
    expect(token.startsWith(SERVICE_TOKEN_PREFIX)).toBe(true);
    expect(s.info.join("\n")).not.toContain(token);
    await expect(findLiveServiceToken(db(), token)).resolves.toMatchObject({
      scopes: ["brain"],
    });

    // A second mint of a live name refuses and prints no token.
    const again = io();
    await expect(run(["mint", "baumy-brain"], again)).resolves.toBe(1);
    expect(again.out).toEqual([]);
    expect(again.info.join("\n")).toContain("rotate baumy-brain");
  });

  it("takes --scopes, and refuses bad names, commands and scopes", async () => {
    const s = io();
    await expect(
      run(["mint", "robot", "--scopes", "brain,extra"], s),
    ).resolves.toBe(0);
    await expect(findLiveServiceToken(db(), s.out[0]!)).resolves.toMatchObject({
      scopes: ["brain", "extra"],
    });
    for (const argv of [
      [],
      ["mint"],
      ["mint", "Bad Name"],
      ["delete", "robot"],
      ["mint", "x", "--scopes"],
      ["mint", "x", "--scopes", "a b"],
    ]) {
      const bad = io();
      await expect(run(argv, bad)).resolves.toBe(2);
      expect(bad.out).toEqual([]);
      expect(bad.info[0]).toContain("Usage");
    }
  });

  it("rotates in one go: the old token dies as the new one is minted", async () => {
    const a = io();
    await run(["mint", "baumy-brain"], a);
    const b = io();
    await expect(run(["rotate", "baumy-brain"], b, LATER)).resolves.toBe(0);
    await expect(findLiveServiceToken(db(), a.out[0]!)).resolves.toBeNull();
    await expect(findLiveServiceToken(db(), b.out[0]!)).resolves.not.toBeNull();
  });

  it("revokes by name, and lists without ever printing a token", async () => {
    const a = io();
    await run(["mint", "baumy-brain"], a);
    const r = io();
    await expect(run(["revoke", "baumy-brain"], r, LATER)).resolves.toBe(0);
    expect(r.info[0]).toContain("Revoked baumy-brain");
    await expect(findLiveServiceToken(db(), a.out[0]!)).resolves.toBeNull();
    const none = io();
    await expect(run(["revoke", "baumy-brain"], none)).resolves.toBe(1);
    expect(none.info[0]).toContain("No live token");

    const l = io();
    await expect(run(["list"], l)).resolves.toBe(0);
    expect(l.out).toEqual([]);
    expect(l.info[0]).toContain("baumy-brain\tbrain");
    expect(l.info[0]).toContain("revoked");
    expect(l.info.join("\n")).not.toContain(a.out[0]!);
  });

  it("lists nothing when there are no tokens", async () => {
    const l = io();
    await run(["list"], l);
    expect(l.info).toEqual(["No service tokens."]);
  });
});
