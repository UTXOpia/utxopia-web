"use client";

import { useEffect, useId, useState } from "react";
import { Pencil, Tag, Trash2 } from "lucide-react";
import {
  ACTIVITY_LABEL_MAX_LENGTH,
  ACTIVITY_NOTE_MAX_LENGTH,
  type ActivityAnnotation,
} from "@/lib/activity-annotations";

export function PersonalAnnotationEditor({
  annotation,
  onSave,
}: {
  annotation?: ActivityAnnotation;
  onSave: (input: { label?: string; note?: string }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(annotation?.label ?? "");
  const [note, setNote] = useState(annotation?.note ?? "");
  const labelInputId = useId();
  const noteInputId = useId();

  useEffect(() => {
    setLabel(annotation?.label ?? "");
    setNote(annotation?.note ?? "");
  }, [annotation?.label, annotation?.note]);

  const cancel = () => {
    setLabel(annotation?.label ?? "");
    setNote(annotation?.note ?? "");
    setEditing(false);
  };

  const save = () => {
    onSave({ label, note });
    setEditing(false);
  };

  if (!editing && !annotation) {
    return (
      <div className="border-t border-gray/8 px-3.5 py-2">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-[11px] text-gray/60 transition-colors hover:bg-gray/8 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-privacy/40"
        >
          <Tag className="h-3 w-3" />
          Add personal label or note
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-gray/8 px-3.5 py-2.5" onClick={(event) => event.stopPropagation()}>
      {editing ? (
        <div className="space-y-2">
          <div>
            <label htmlFor={labelInputId} className="mb-1 block text-[11px] text-gray/55">
              Personal label
            </label>
            <input
              id={labelInputId}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={ACTIVITY_LABEL_MAX_LENGTH}
              placeholder="e.g. Relayer fee"
              autoFocus
              className="h-9 w-full rounded-md border border-gray/15 bg-muted/35 px-2.5 text-xs text-foreground outline-none transition-colors placeholder:text-gray/45 focus:border-privacy/45 focus:ring-2 focus:ring-privacy/10"
            />
          </div>
          <div>
            <label htmlFor={noteInputId} className="mb-1 block text-[11px] text-gray/55">
              Personal note
            </label>
            <textarea
              id={noteInputId}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={ACTIVITY_NOTE_MAX_LENGTH}
              placeholder="Visible only in this browser"
              rows={3}
              className="w-full resize-none rounded-md border border-gray/15 bg-muted/35 px-2.5 py-2 text-xs leading-relaxed text-foreground outline-none transition-colors placeholder:text-gray/45 focus:border-privacy/45 focus:ring-2 focus:ring-privacy/10"
            />
          </div>
          <p className="text-[10px] text-gray/40">Saved in this browser, not on-chain.</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={cancel}
              className="min-h-9 rounded-md px-3 text-xs text-gray/60 transition-colors hover:bg-gray/8 hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              className="min-h-9 rounded-md bg-privacy px-3 text-xs font-medium text-background transition-colors hover:bg-privacy/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-privacy/40"
            >
              Save note
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] text-gray/45">Personal, saved in this browser</p>
            {annotation?.label && (
              <p className="mt-0.5 text-xs font-medium text-foreground">{annotation.label}</p>
            )}
            {annotation?.note && (
              <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-gray/65">
                {annotation.note}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Edit personal label and note"
              className="flex h-8 w-8 items-center justify-center rounded-md text-gray/50 transition-colors hover:bg-gray/8 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-privacy/40"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => onSave({})}
              aria-label="Remove personal label and note"
              className="flex h-8 w-8 items-center justify-center rounded-md text-gray/45 transition-colors hover:bg-error/10 hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/40"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
