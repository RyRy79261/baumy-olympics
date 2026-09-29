import { describe, expect, it } from "vitest";
import { generateTelegramLinkCode } from "@/lib/codes";
import {
  DEFAULT_TELEGRAM_BOT_USERNAME,
  TELEGRAM_BOT_USERNAME_ENV,
  telegramBotUsername,
  telegramLinkDeepLink,
} from "./deep-link";

describe("telegramBotUsername", () => {
  it("defaults to the house bot when unset or blank", () => {
    expect(DEFAULT_TELEGRAM_BOT_USERNAME).toBe("baumy_bot");
    expect(telegramBotUsername({})).toBe("baumy_bot");
    expect(telegramBotUsername({ [TELEGRAM_BOT_USERNAME_ENV]: "  " })).toBe(
      "baumy_bot",
    );
  });

  it("reads the env, with or without a leading @", () => {
    expect(
      telegramBotUsername({ [TELEGRAM_BOT_USERNAME_ENV]: "staging_baumy_bot" }),
    ).toBe("staging_baumy_bot");
    expect(
      telegramBotUsername({ [TELEGRAM_BOT_USERNAME_ENV]: " @Other_Bot " }),
    ).toBe("Other_Bot");
  });

  it("falls back on anything that is not a Telegram username", () => {
    for (const bad of [
      "bot",
      "1baumy_bot",
      "baumy-bot",
      "evil.com/x",
      "a".repeat(33),
    ]) {
      expect(telegramBotUsername({ [TELEGRAM_BOT_USERNAME_ENV]: bad })).toBe(
        "baumy_bot",
      );
    }
  });
});

describe("telegramLinkDeepLink", () => {
  it("builds the bot's start link with a link_ payload", () => {
    expect(telegramLinkDeepLink("K7PQ2MX9RT", "baumy_bot")).toBe(
      "https://t.me/baumy_bot?start=link_K7PQ2MX9RT",
    );
  });

  it("fits every code the app makes into a valid start payload", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateTelegramLinkCode();
      const url = new URL(telegramLinkDeepLink(code, "baumy_bot"));
      expect(url.host).toBe("t.me");
      expect(url.searchParams.get("start")).toBe(`link_${code}`);
      expect(url.searchParams.get("start")!.length).toBeLessThanOrEqual(64);
    }
  });

  it("refuses a code Telegram would drop", () => {
    expect(() => telegramLinkDeepLink("ab cd", "baumy_bot")).toThrow(/payload/);
    expect(() => telegramLinkDeepLink("x".repeat(60), "baumy_bot")).toThrow(
      /payload/,
    );
  });
});
