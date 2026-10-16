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
  SheetSending,
  choiceClass,
  cx,
  iconChoiceClass,
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
// small square beside each row showing the item's group icon, which opens
// the groups as big buttons, and a row of icon chips above the quick-add
// field: pick one (or none), type, Add (owner 2026-10-13, layout A).
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

/**
 * "Not sorted" on an item's group square: an empty dashed box, the "no
 * group yet" slot. Plain CSS, no art (owner 2026-10-13: a neutral marker).
 */
function NotSortedMark({ kiosk }: { kiosk: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-testid="not-sorted-mark"
      className={cx(
        "border-2 border-dashed border-bm-dim",
        kiosk ? "size-7" : "size-5",
      )}
    />
  );
}

export function ShoppingList({
  items,
  actions,
  canEdit,
  kiosk = false,
  idPrefix = "shopping",
  headingLevel = 2,
}: {
  items: ShoppingEntry[];
  actions: ShoppingActions;
  /** False on the kiosk until someone taps their avatar. */
  canEdit: boolean;
  kiosk?: boolean;
  /** Keeps ids apart when the page shows the list twice. */
  idPrefix?: string;
  /** The groups' heading level: 3 inside a widget whose title is an h2. */
  headingLevel?: 2 | 3;
}) {
  const [picking, setPicking] = useState<ShoppingEntry | null>(null);
  // The picker shows the item as the list has it now: the page re-reads
  // itself (the kiosk every minute), so its group may have changed, or it
  // may be gone (ticked off in Telegram), and then the picker closes.
  const live = picking
    ? (items.find((i) => i.id === picking.id) ?? null)
    : null;
  if (picking && !live) setPicking(null);
  const groups = groupShopping(items);
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const rows = (list: ShoppingEntry[], testId?: string) => (
    <CheckList data-testid={testId} className="min-h-0">
      {list.map((i) => (
        <li key={i.id} data-testid={`shopping-item-${i.item}`}>
          {canEdit ? (
            <div className="flex items-stretch gap-2">
              <div className="min-w-0 flex-1">
                <CheckOffRow item={i} action={actions.checkOff} kiosk={kiosk} />
              </div>
              <button
                type="button"
                aria-label={`Group: ${shoppingCategoryLabel(i.category)} — change`}
                aria-haspopup="dialog"
                data-testid="shopping-group-button"
                data-category={i.category ?? NO_GROUP}
                onClick={() => setPicking(i)}
                className={iconChoiceClass("off", kiosk)}
              >
                {i.category ? (
                  <GroupGlyph category={i.category} size={kiosk ? 32 : 24} />
                ) : (
                  <NotSortedMark kiosk={kiosk} />
                )}
              </button>
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
              <Heading
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
              </Heading>
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
      {canEdit && live ? (
        <GroupPicker
          key={live.id}
          item={live}
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
      {/* Owner 2026-10-13 (layout A): one compact row of icon chips, named
          for screen readers, under a short caption in the field label's
          style; the field's label says which one is picked. */}
      <p
        id={`${id}-groups`}
        className="font-label text-sm font-bold tracking-wide text-bm-text uppercase"
      >
        Group (optional)
      </p>
      <div
        role="group"
        aria-labelledby={`${id}-groups`}
        data-testid="shopping-add-groups"
        className="flex flex-wrap gap-2"
      >
        {SHOPPING_CATEGORIES.map((c) => {
          const on = group === c;
          return (
            <button
              key={c}
              type="button"
              aria-label={shoppingCategoryLabel(c)}
              aria-pressed={on}
              onClick={() => setGroup(on ? null : c)}
              className={iconChoiceClass(on ? "on" : "off", kiosk)}
            >
              <GroupGlyph category={c} size={kiosk ? 32 : 24} on={on} />
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
    useReporting<SetShoppingCategoryData>(
      async (prev, form) => {
        const result = await action(prev, form);
        // Gone meanwhile (ticked off elsewhere): say so and close; the
        // list re-reads itself without it.
        if (!result.ok && result.code === "NOT_FOUND") {
          toast.error(result.message);
          onClose();
        }
        return result;
      },
      (data) => {
        toast.success(categoryMessage(data));
        onClose();
      },
    ),
  );
  const failed =
    state && !state.ok && state.code !== "NOT_FOUND" ? state : null;
  const choices: (ShoppingCategory | null)[] = [...SHOPPING_CATEGORIES, null];
  return (
    <Dialog open onClose={onClose} title={`Group for ${item.item}`}>
      {/* Open while the move is on its way (#174). */}
      <SheetSending pending={pending} />
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
                aria-current={current ? "true" : undefined}
                // Big on every screen: 56px, whether kiosk or phone. Where
                // it is now is outlined with "Now", not a green "go".
                className={choiceClass(current ? "current" : "off", true)}
              >
                {c ? (
                  <GroupGlyph category={c} size={32} />
                ) : (
                  // The rows' neutral mark, in an icon-sized box, so "Not
                  // sorted" lines up with the labels beside icons.
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 place-items-center"
                  >
                    <NotSortedMark kiosk />
                  </span>
                )}
                {shoppingCategoryLabel(c)}
                {current ? (
                  <span
                    data-testid="group-now"
                    className="ml-auto text-xs text-bm-green"
                  >
                    Now
                  </span>
                ) : null}
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
