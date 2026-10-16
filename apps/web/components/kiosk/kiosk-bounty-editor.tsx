"use client";

import {
  BountyBulkEditor,
  type BulkEditorBounty,
} from "@/components/chores/bounty-bulk-editor";
import { kioskSubmit } from "@/components/chores/bounty-submit";
import type { FormAction } from "@/components/use-action-form";
import type { UpdateBountiesData } from "@/lib/actions/update-bounties";

// The kitchen screen's mass bounty editor (issue #175): the one editor with
// the kiosk's submit adapter, so the picked admin's PIN goes with the save.
// Its own client component, since the settings page (a server component)
// cannot hand over an adapter's functions.

export function KioskBountyEditor({
  bounties,
  pinLabel,
  action,
}: {
  bounties: readonly BulkEditorBounty[];
  /** The PIN pad's title, e.g. "Ryan's PIN". */
  pinLabel: string;
  action: FormAction<UpdateBountiesData>;
}) {
  return (
    <BountyBulkEditor
      bounties={bounties}
      action={action}
      submit={kioskSubmit(pinLabel)}
      kiosk
    />
  );
}
