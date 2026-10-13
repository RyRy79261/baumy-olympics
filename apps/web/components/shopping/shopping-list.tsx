"use client";

import { useState, type ReactNode } from "react";
import {
  Button,
  CheckItemButton,
  CheckItemEntry,
  CheckList,
  Dialog,
  Field,
  FormMessage,
  Glyph,
  Input,
  choiceClass,
  cx,
} from "@baumy/ui";
import {
  SHOPPING_CATEGORIES,
  shoppingCategoryLabel,
  type ShoppingCategory,
} from "@baumy/types";
import {
  useActionForm,
  useReporting,
  type FormAction,
} from "@/components/use-action-form";
import type { ShoppingEntry } from "@/lib/integrations/brain";
import type {
  AddShoppingData,
  CheckOffShoppingData,
  SetShoppingCategoryData,
} from "@/lib/actions/shopping";
import {
  CATEGORY_GLYPHS,
  NO_GROUP,
  addedMessage,
  categoryMessage,
  checkedOffMessage,
  groupShopping,
} from "@/lib/shopping/view";
import { toast, toastActionError } from "@/lib/ui/toast";

// The house shopping list (SPEC §3.4), the same on /shopping, the hub's
// widget and the kitchen screen: a quick-add field ("milk, eggs") and one big
// row per item that checks it off in one tap. The list itself is brain's
// (ADR 0003); every change goes through the registry's actions, and the page
// re-reads the list afterwards. On the kiosk nobody can change it until
// someone taps their avatar; it asks for no PIN. Until then the kiosk shows
// the same rows, only to read: no quick-add and nothing to tap (issue #204).
//
// Groups (issue #208, SPEC §12 decision 39): brain puts each item in one of
// six groups. The rows sit under a heading per group (its glyph and name) in
// the fixed order, "Not sorted" last, and only groups with items get one;
// read-only too. With no group on any item (an older brain, or everything
// just added) the list is flat, as before. Someone who may change it gets a
// "Group" button beside each row, which opens the groups as big buttons, and
// group buttons above the quick-add field: pick one (or none), type, Add.
//
// Layout only: the look is the pixel kit's (packages/ui, issue #64).

export interface ShoppingActions {
  add: FormAction<AddShoppingData>;
  checkOff: FormAction<CheckOffShoppingData>;
  setCategory: FormAction<SetShoppingCategoryData>;
}

/** Each group's colour, for its glyph: the kit's tokens, nothing new. */
const GROUP_COLOURS: Record<ShoppingCategory, string> = {
  pantry: "var(--color-bm-yellow)",
  fresh: "var(--color-bm-green)",
  coffee: "var(--color-bm-amber)",
  cleaning: "var(--color-bm-teal)",
  maintenance: "var(--color-bm-violet)",
  household: "var(--color-bm-pink)",
};

function GroupGlyph({
  category,
  size,
  on = false,
}: {
  category: ShoppingCategory;
  size: number;
  /** On a picked (green) button: in ink, so Fresh's green never vanishes. */
  on?: boolean;
}) {
  return (
    <Glyph
      name={CATEGORY_GLYPHS[category]}
      size={size}
      color={on ? "var(--color-bm-ink)" : GROUP_COLOURS[category]}
      accent={on ? "var(--color-bm-ink)" : "var(--color-bm-text)"}
    />
  );
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
  const [picking, setPicking] = useState<ShoppingEntry | null>(null);
  const groups = groupShopping(items);
  const rows = (list: ShoppingEntry[], testId?: string) => (
    <CheckList data-testid={testId} className="min-h-0">
      {list.map((i) => (
        <li key={i.id} data-testid={`shopping-item-${i.item}`}>
          {canEdit ? (
            <div className="flex items-stretch gap-2">
              <div className="min-w-0 flex-1">
                <CheckOffRow item={i} action={actions.checkOff} kiosk={kiosk} />
              </div>
              <Button
                variant="secondary"
                size={kiosk ? "kiosk" : "default"}
                aria-label={`Change the group of ${i.item}`}
                aria-haspopup="dialog"
                onClick={() => setPicking(i)}
                className={kiosk ? "px-4" : "px-3"}
              >
                Group
              </Button>
            </div>
          ) : (
            <CheckItemEntry label={i.item} kiosk={kiosk} />
          )}
        </li>
      ))}
    </CheckList>
  );

  let list: ReactNode;
  if (items.length === 0) {
    list = (
      <p className="text-sm text-bm-muted" data-testid="shopping-empty">
        The list is empty.
      </p>
    );
  } else if (!groups) {
    list = rows(items, "shopping-items");
  } else {
    list = (
      <div data-testid="shopping-items" className="flex flex-col gap-4">
        {groups.map((g) => {
          const key = g.category ?? NO_GROUP;
          const headingId = `${idPrefix}-group-${key}`;
          return (
            <section
              key={key}
              aria-labelledby={headingId}
              data-testid={`shopping-group-${key}`}
              className="flex flex-col gap-2"
            >
              <h2
                id={headingId}
                className={cx(
                  "flex items-center gap-3 font-display leading-relaxed",
                  g.category ? "text-bm-text" : "text-bm-muted",
                  kiosk ? "min-h-10 text-base" : "min-h-8 text-sm",
                )}
              >
                {g.category ? (
                  <GroupGlyph category={g.category} size={kiosk ? 36 : 28} />
                ) : null}
                {g.label}
              </h2>
              {rows(g.items)}
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {canEdit ? (
        <QuickAdd action={actions.add} kiosk={kiosk} id={`${idPrefix}-add`} />
      ) : null}
      {list}
      {kiosk && canEdit ? (
        // Room at the end to scroll the last row's Group button out from
        // under Baumy, who sits over the footer's right end.
        <div
          aria-hidden="true"
          data-testid="shopping-end-room"
          className="h-20 shrink-0"
        />
      ) : null}
      {canEdit && picking ? (
        <GroupPicker
          key={picking.id}
          item={picking}
          action={actions.setCategory}
          onClose={() => setPicking(null)}
        />
      ) : null}
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
  // was typed (and the group picked) must survive a failure.
  const [text, setText] = useState("");
  const [group, setGroup] = useState<ShoppingCategory | null>(null);
  const { state, formAction, pending, requestId, errors } = useActionForm(
    useReporting(action, (data) => {
      setText("");
      setGroup(null);
      toast.success(addedMessage(data));
    }),
  );
  const failed = state && !state.ok ? state : null;
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      {group ? <input type="hidden" name="category" value={group} /> : null}
      <p
        id={`${id}-groups`}
        className="font-label text-sm font-bold tracking-wide text-bm-muted uppercase"
      >
        Add into a group (optional)
      </p>
      <div
        role="group"
        aria-labelledby={`${id}-groups`}
        data-testid="shopping-add-groups"
        className={cx("grid gap-2", kiosk ? "grid-cols-3" : "grid-cols-2")}
      >
        {SHOPPING_CATEGORIES.map((c) => {
          const on = group === c;
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              onClick={() => setGroup(on ? null : c)}
              className={choiceClass(on, kiosk)}
            >
              <GroupGlyph category={c} size={kiosk ? 28 : 20} on={on} />
              <span className="truncate">{shoppingCategoryLabel(c)}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field
            id={id}
            label={
              group
                ? `Add to ${shoppingCategoryLabel(group)}`
                : "Add to the list"
            }
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

/** The groups as big buttons for one item; a tap sets it and closes. */
function GroupPicker({
  item,
  action,
  onClose,
}: {
  item: ShoppingEntry;
  action: FormAction<SetShoppingCategoryData>;
  onClose: () => void;
}) {
  const { state, formAction, pending, requestId } = useActionForm(
    useReporting(action, (data) => {
      toast.success(categoryMessage(data));
      onClose();
    }),
  );
  const failed = state && !state.ok ? state : null;
  const choices: (ShoppingCategory | null)[] = [...SHOPPING_CATEGORIES, null];
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Group for ${item.item}`}
      busy={pending}
    >
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="item" value={item.item} />
        <div role="group" className="flex flex-col gap-3">
          {choices.map((c) => {
            const current = item.category === c;
            return (
              <button
                key={c ?? NO_GROUP}
                type="submit"
                name="category"
                value={c ?? NO_GROUP}
                disabled={pending}
                aria-pressed={current}
                // Big on every screen: 56px, whether kiosk or phone.
                className={choiceClass(current, true)}
              >
                {c ? <GroupGlyph category={c} size={32} on={current} /> : null}
                {shoppingCategoryLabel(c)}
              </button>
            );
          })}
        </div>
        {failed ? (
          <FormMessage tone="error">{failed.message}</FormMessage>
        ) : null}
      </form>
    </Dialog>
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
