"use client";

import { useState } from "react";
import { Button, Card } from "@baumy/ui";
import { BountyBulkEditor } from "@/components/chores/bounty-bulk-editor";
import type { ChoreView } from "@/lib/actions/list-chores";
import { updateBountiesAction } from "./actions";
import { ChoreAdminRow } from "./chore-forms";

// The admin page's chores: the list (each with Edit, Archive or Restore),
// or, after "Edit many at once", one editable row per bounty with one Save
// (issue #175).

export function ChoresCard({ chores }: { chores: ChoreView[] }) {
  const [bulk, setBulk] = useState(false);
  if (bulk) {
    return (
      <Card
        title="Edit many at once"
        description="Change any rows, then save them together. If one can't be saved, none are. New points count from now on."
      >
        <BountyBulkEditor
          bounties={chores}
          action={updateBountiesAction}
          onClose={() => setBulk(false)}
        />
      </Card>
    );
  }
  return (
    <Card title="Chores">
      {chores.length === 0 ? (
        <p className="text-sm text-bm-muted">No chores yet.</p>
      ) : (
        <>
          <Button
            variant="secondary"
            className="mb-2"
            onClick={() => setBulk(true)}
          >
            Edit many at once
          </Button>
          <ul>
            {chores.map((c) => (
              <ChoreAdminRow key={c.id} chore={c} />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
