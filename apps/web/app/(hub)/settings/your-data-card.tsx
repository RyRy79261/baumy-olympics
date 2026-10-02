import Link from "next/link";
import { formatBerlinDateTime } from "@baumy/core";
import { Card, linkClass } from "@baumy/ui";
import type { MyDataView } from "@/lib/actions/get-my-data";

// Settings, "Your data" (issue #144): the same `get_my_data` answer Baumy
// sums up when asked "what do you keep about me?", as counts and dates.

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

const when = (iso: string) => formatBerlinDateTime(new Date(iso));

function signIn(a: MyDataView["account"]): string {
  const ways = [
    a.hasPassword ? "password" : null,
    a.googleLinked ? "Google" : null,
    a.passkeys > 0 ? plural(a.passkeys, "passkey") : null,
  ].filter((w): w is string => w !== null);
  const list = ways.length > 0 ? ways.join(", ") : "none";
  return `${list}; two-factor ${a.twoFactorEnabled ? "on" : "off"}`;
}

function photos(p: MyDataView["photos"], days: number): string {
  if (p.stored === 0) return "none";
  const due = p.items
    .map((i) => i.deletesAt)
    .filter((d): d is string => d !== null)
    .sort();
  const open = p.stored - due.length;
  const parts = [String(p.stored)];
  if (due.length > 0) parts.push(`the next is deleted ${when(due[0]!)}`);
  if (open > 0) {
    parts.push(
      `${open} on ${open === 1 ? "a claim" : "claims"} still open, deleted ${days} days after settling`,
    );
  }
  return parts.join("; ");
}

export function YourDataCard({ data }: { data: MyDataView }) {
  const open =
    data.completions.byStatus.pending + data.completions.byStatus.disputed;
  const rows: [string, string, string][] = [
    ["sign-in", "Sign-in", signIn(data.account)],
    [
      "sessions",
      "Signed-in devices",
      data.sessions.count > 0
        ? `${data.sessions.count}, last used ${when(data.sessions.lastUsedAt[0]!)}`
        : "0",
    ],
    [
      "profile",
      "Profile",
      `${data.profile.displayName}, member since ${when(data.profile.memberSince)}; Telegram ${data.profile.telegramLinked ? "linked" : "not linked"}; kiosk PIN ${data.profile.kioskPinSet ? "set" : "not set"}`,
    ],
    [
      "completions",
      "Completions",
      `${data.completions.total}${open > 0 ? ` (${open} still open)` : ""}`,
    ],
    [
      "notes",
      "Notes",
      `${data.notes.written} written, ${data.notes.deletedKept} deleted but kept`,
    ],
    ["photos", "Proof photos", photos(data.photos, data.retention.photoDays)],
    ["audit", "Audit-log entries naming you", String(data.auditEntries)],
    [
      "ai",
      "Baumy usage",
      `${plural(data.ai.commands, "command")} (${data.ai.inputTokens + data.ai.outputTokens} tokens), ${plural(data.ai.voiceClips, "voice clip")}`,
    ],
    [
      "apps",
      "Connected apps",
      data.connectedApps.length > 0
        ? data.connectedApps.map((a) => a.name).join(", ")
        : "none",
    ],
  ];
  return (
    <Card
      title="Your data"
      description="What Baumy keeps about you, as counts and dates. Only you see this; you can also ask Baumy “what do you keep about me?”."
      data-testid="your-data"
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([key, label, value]) => (
          <div key={key} className="contents" data-testid={`your-data-${key}`}>
            <dt className="text-bm-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mt-4 text-sm font-bold">How long it is kept</h3>
      <ul
        className="mt-1 list-disc pl-5 text-sm"
        data-testid="your-data-retention"
      >
        {data.retention.rules.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
      <p className="mt-3 text-sm">
        The full policy is on the{" "}
        <Link href={data.retention.policyUrl} className={linkClass}>
          privacy page
        </Link>
        .
      </p>
    </Card>
  );
}
