import type { ReactNode } from "react";

import type { LucideIcon } from "lucide-react";

/**
 * What a screen says when it has nothing to show.
 *
 * A new workspace opens on empty lists, and every one of them said the same grey
 * sentence in the middle of a table: nothing about what the screen is for, and
 * nothing to press. A first run is largely decided on these screens, and there
 * was no procedure to explain them — the audit asked for a five-step wizard, and
 * a wizard is one artefact that gets clicked past once, while this is per screen
 * and arrives at the moment the question is actually being asked (rilievo U-12).
 *
 * Two kinds of empty, which must not read alike: nothing yet, which is an
 * invitation and carries the action, and nothing matching, which is a filter to
 * undo and carries no invitation at all — offering to create a record because a
 * search found nothing is answering a question nobody asked.
 */
interface Props {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Only for the nothing-yet case: the one thing worth doing here. */
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="space-y-1.5">
        <p className="font-medium text-sm">{title}</p>
        <p className="mx-auto max-w-sm text-muted-foreground text-xs leading-relaxed">{description}</p>
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
