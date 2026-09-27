"use client";

import { useState } from "react";
import {
  Button,
  CheckItemButton,
  CheckList,
  Field,
  FormMessage,
  Input,
  WidgetItem,
  WidgetList,
} from "@baumy/ui";
import { SHOPPING_ITEM_MAX } from "@baumy/types";
import {
  useActionForm,
  useReporting,
  type FormAction,
} from "@/components/use-action-form";
import type { ShoppingEntry } from "@/lib/integrations/brain";
import type {
  AddShoppingData,
  CheckOffShoppingData,
} from "@/lib/actions/shopping";
import { addedMessage, checkedOffMessage } from "@/lib/shopping/view";
import { toast, toastActionError } from "@/lib/ui/toast";

// The house shopping list (SPEC §3.4), the same on /shopping, the hub's
// widget and the kitchen screen: a quick-add field ("milk, eggs") and one big
// row per item that checks it off in one tap. The list itself is brain's
// (ADR 0003); every change goes through the registry's actions, and the page
// re-reads the list afterwards. On the kiosk nobody can change it until
// someone taps their avatar; it asks for no PIN.
//
// NEUTRAL PLACEHOLDER layout; issue #7 restyles it through packages/ui.

export interface ShoppingActions {
  add: FormAction<AddShoppingData>;
  checkOff: FormAction<CheckOffShoppingData>;
}

export function ShoppingList({
  items,
  actions,
  canEdit,
  kiosk = false,
  idPrefix = "shopping",
}: {
  items: ShoppingEntry[];
  actions: ShoppingActions;
  /** False on the kiosk until someone taps their avatar. */
  canEdit: boolean;
  kiosk?: boolean;
  /** Keeps ids apart when the page shows the list twice. */
  idPrefix?: string;
}) {
  return (
    <div className="flex min-h-0 flex-col gap-3">
      {canEdit ? (
        <QuickAdd action={actions.add} kiosk={kiosk} id={`${idPrefix}-add`} />
      ) : null}
      {items.length === 0 ? (
        <p className="text-sm text-neutral-600" data-testid="shopping-empty">
          The list is empty.
        </p>
      ) : canEdit ? (
        <CheckList data-testid="shopping-items" className="min-h-0">
          {items.map((i) => (
            <li key={i.id} data-testid={`shopping-item-${i.item}`}>
              <CheckOffRow item={i} action={actions.checkOff} kiosk={kiosk} />
            </li>
          ))}
        </CheckList>
      ) : (
        <WidgetList data-testid="shopping-items">
          {items.map((i) => (
            <WidgetItem
              key={i.id}
              data-testid={`shopping-item-${i.item}`}
              primary={i.item}
            />
          ))}
        </WidgetList>
      )}
    </div>
  );
}

function QuickAdd({
  action,
  kiosk,
  id,
}: {
  action: FormAction<AddShoppingData>;
  kiosk: boolean;
  id: string;
}) {
  // Controlled: React resets a form's fields after each action, and what
  // was typed must survive a failure.
  const [text, setText] = useState("");
  const { state, formAction, pending, requestId, errors } = useActionForm(
    useReporting(action, (data) => {
      setText("");
      toast.success(addedMessage(data));
    }),
  );
  const failed = state && !state.ok ? state : null;
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field
            id={id}
            label="Add to the list"
            errors={
              errors.items ?? (failed && !failed.issues ? [failed.message] : [])
            }
          >
            {(c) => (
              <Input
                {...c}
                name="items"
                kiosk={kiosk}
                placeholder="milk, eggs"
                autoComplete="off"
                maxLength={SHOPPING_ITEM_MAX * 4}
                value={text}
                onChange={(e) => setText(e.target.value)}
                required
              />
            )}
          </Field>
        </div>
        <Button
          type="submit"
          size={kiosk ? "kiosk" : "default"}
          disabled={pending}
        >
          Add
        </Button>
      </div>
      {errors.items || !failed || !failed.issues ? null : (
        <FormMessage tone="error">{failed.message}</FormMessage>
      )}
    </form>
  );
}

/** One tap checks the item off; the result is a toast. */
function CheckOffRow({
  item,
  action,
  kiosk,
}: {
  item: ShoppingEntry;
  action: FormAction<CheckOffShoppingData>;
  kiosk: boolean;
}) {
  const { formAction, pending, requestId } =
    useActionForm<CheckOffShoppingData>(async (prev, form) => {
      const result = await action(prev, form);
      if (!toastActionError(result) && result.ok) {
        toast.success(checkedOffMessage(result.data));
      }
      return result;
    });
  return (
    <form action={formAction}>
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="items" value={item.item} />
      <CheckItemButton label={item.item} kiosk={kiosk} disabled={pending} />
    </form>
  );
}
