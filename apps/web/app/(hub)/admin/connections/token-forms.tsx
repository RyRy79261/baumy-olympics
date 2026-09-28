"use client";

import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { Button, Card, Field, FormMessage, Input } from "@baumy/ui";
import { useActionForm } from "@/components/use-action-form";
import type { ServiceTokenData } from "@/lib/actions/service-tokens";
import type { ActionOutput as Out } from "@/lib/actions/registry";
import { toast } from "@/lib/ui/toast";
import {
  createServiceTokenAction,
  revokeServiceTokenAction,
  rotateServiceTokenAction,
} from "./actions";

// /admin/connections' forms (issue #104). Creating and rotating show the new
// token once, in the page's one OneTimeTokenArea, with a copy button and
// where it goes; both ask for the
// password unless the admin signed in under 10 minutes ago. Rotating and
// revoking cut brain off, so each asks first (the Security page's confirm
// step).

const PASSWORD_HINT =
  "Not needed if you signed in within the last 10 minutes. If you sign in with Google, sign out and in again instead.";

function PasswordField({ id, disabled }: { id: string; disabled: boolean }) {
  return (
    <Field id={id} label="Your password" hint={PASSWORD_HINT}>
      {(control) => (
        <Input
          {...control}
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          maxLength={256}
          disabled={disabled}
        />
      )}
    </Field>
  );
}

/** The plaintext, once: copy it, and where to put it. */
function OneTimeToken({ data }: { data: ServiceTokenData }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  if (!data.token) {
    return (
      <FormMessage tone="success">
        The token for {data.name} was already shown once. Rotate it if you need
        a new one.
      </FormMessage>
    );
  }
  const token = data.token;
  /** Only say "Copied" when it was: a refused clipboard must not look fine. */
  async function copy() {
    setCopyError(false);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      setCopyError(true);
    }
  }
  return (
    <div className="flex flex-col gap-3" data-testid="service-token-shown">
      <FormMessage tone="success">
        New token for {data.name}. This is the only time it is shown; only its
        hash is kept here.
      </FormMessage>
      <code
        data-testid="service-token-plaintext"
        className="pixel-frame block bg-bm-raised px-3 py-2 font-mono text-sm break-all select-all"
      >
        {token}
      </code>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={copy}>
          {copied ? "Copied" : "Copy token"}
        </Button>
      </div>
      {copyError ? (
        <FormMessage tone="error">
          Your browser wouldn&rsquo;t copy it. Select the token above and copy
          it by hand.
        </FormMessage>
      ) : null}
      <p className="text-base">
        Put it in baumy-brain&rsquo;s Vercel project as{" "}
        <code className="font-mono">BRAIN_SERVICE_TOKEN</code> (Settings,
        Environment Variables), then redeploy brain.
      </p>
    </div>
  );
}

interface Shown {
  shown: ServiceTokenData | null;
  setShown: Dispatch<SetStateAction<ServiceTokenData | null>>;
}

const ShownToken = createContext<Shown>({ shown: null, setShown: () => {} });

/**
 * The page's ONE one-time token: the latest one created or rotated. A new
 * one replaces it, and revoking its name clears it, so the page never shows
 * a token that no longer works, or two at once.
 */
export function OneTimeTokenArea({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<ServiceTokenData | null>(null);
  return (
    <ShownToken.Provider value={{ shown, setShown }}>
      {shown ? (
        <Card title="Your new token">
          {/* Keyed by the token, so "Copied" never carries over. */}
          <OneTimeToken key={shown.token ?? shown.name} data={shown} />
        </Card>
      ) : null}
      {children}
    </ShownToken.Provider>
  );
}

/** create_service_token: the new token shows in OneTimeTokenArea. */
export function CreateTokenForm({ defaultName }: { defaultName: string }) {
  const { setShown } = useContext(ShownToken);
  const { state, formAction, pending, requestId, errors } = useActionForm<
    Out<"create_service_token">
  >(async (prev, form) => {
    const result = await createServiceTokenAction(prev, form);
    if (result.ok) setShown(result.data);
    return result;
  });
  return (
    <Card
      title="Create a token"
      description="baumy-brain, the Telegram bot, calls Baumy Olympics with a service token. Create one here and give it to brain."
    >
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="requestId" value={requestId} />
        <Field id="service-token-name" label="Name" errors={errors.name}>
          {(control) => (
            <Input
              {...control}
              name="name"
              defaultValue={defaultName}
              maxLength={63}
              autoComplete="off"
            />
          )}
        </Field>
        <PasswordField id="service-token-password" disabled={pending} />
        {state && !state.ok && state.code !== "INVALID_INPUT" ? (
          <FormMessage tone="error">{state.message}</FormMessage>
        ) : null}
        <Button type="submit" className="self-start" disabled={pending}>
          {pending ? "Creating..." : "Create token"}
        </Button>
      </form>
    </Card>
  );
}

/** rotate_service_token and revoke_service_token, each behind a confirm. */
export function LiveTokenControls({ name }: { name: string }) {
  const [asking, setAsking] = useState<"rotate" | "revoke" | null>(null);
  const { setShown } = useContext(ShownToken);
  const rotate = useActionForm<Out<"rotate_service_token">>(
    async (prev, form) => {
      const result = await rotateServiceTokenAction(prev, form);
      if (result.ok) {
        setShown(result.data);
        setAsking(null);
      }
      return result;
    },
  );
  const revoke = useActionForm<Out<"revoke_service_token">>(
    async (prev, form) => {
      const result = await revokeServiceTokenAction(prev, form);
      if (result.ok) {
        // The token on show stops working: take it off the page.
        setShown((s) => (s?.name === name ? null : s));
        toast.success(`${name} is revoked.`);
      } else toast.error(result.message);
      setAsking(null);
      return result;
    },
  );

  return (
    <div className="flex flex-col gap-3">
      {asking === "rotate" ? (
        <form action={rotate.formAction} className="flex flex-col gap-3">
          <input type="hidden" name="requestId" value={rotate.requestId} />
          <input type="hidden" name="name" value={name} />
          <p className="text-base">
            Rotate {name}? Its token stops working now, so brain is cut off
            until it has the new one.
          </p>
          <PasswordField
            id={`rotate-password-${name}`}
            disabled={rotate.pending}
          />
          {rotate.state && !rotate.state.ok ? (
            <FormMessage tone="error">{rotate.state.message}</FormMessage>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" disabled={rotate.pending}>
              {rotate.pending ? "Rotating..." : "Yes, rotate"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setAsking(null)}
              disabled={rotate.pending}
            >
              Keep it
            </Button>
          </div>
        </form>
      ) : asking === "revoke" ? (
        <form action={revoke.formAction} className="flex flex-col gap-3">
          <input type="hidden" name="requestId" value={revoke.requestId} />
          <input type="hidden" name="name" value={name} />
          <p className="text-base">
            Revoke {name}? Brain&rsquo;s next call gets refused until you create
            a new token.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" disabled={revoke.pending}>
              {revoke.pending ? "Revoking..." : "Yes, revoke"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setAsking(null)}
              disabled={revoke.pending}
            >
              Keep it
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => setAsking("rotate")}
            aria-label={`Rotate ${name}`}
          >
            Rotate
          </Button>
          <Button
            variant="danger"
            onClick={() => setAsking("revoke")}
            aria-label={`Revoke ${name}`}
          >
            Revoke
          </Button>
        </div>
      )}
    </div>
  );
}
