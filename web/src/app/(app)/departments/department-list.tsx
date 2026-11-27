"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArchiveIcon, ArchiveRestoreIcon, CheckIcon, Loader2Icon, PencilIcon, PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/form-bits";
import { removeDepartment, restoreDepartment, saveDepartment } from "./actions";

type Row = { id: string; name: string; color: string | null; active: boolean; employees: number; head: string | null };

export function DepartmentList({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState<{ id: string | null; name: string; color: string } | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; message: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      (r.ok ? toast.success : toast.error)(r.message);
      if (r.ok) after?.();
      router.refresh();
    });

  const editor = edit && (
    <form
      className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveDepartment(edit.id, edit.name, edit.color), () => setEdit(null));
      }}
    >
      <input
        type="color"
        aria-label="Colour"
        value={edit.color || "#14b8a6"}
        onChange={(e) => setEdit({ ...edit, color: e.target.value })}
        className="h-8 w-10 cursor-pointer rounded border bg-transparent"
      />
      <Input autoFocus className="min-w-48 flex-1" placeholder="Department name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} Save
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEdit(null)}>
        <XIcon /> Cancel
      </Button>
    </form>
  );

  return (
    <div className="flex flex-col gap-3">
      {edit?.id === null ? editor : (
        <Button className="self-start" onClick={() => setEdit({ id: null, name: "", color: "" })}>
          <PlusIcon /> Add department
        </Button>
      )}
      {!rows.length && <EmptyState title="No departments yet" />}
      <ul className="divide-y rounded-xl border">
        {rows.map((d) =>
          edit?.id === d.id ? (
            <li key={d.id} className="p-2">
              {editor}
            </li>
          ) : (
            <li key={d.id} className={`flex flex-wrap items-center gap-3 p-3 ${d.active ? "" : "opacity-60"}`}>
              <span className="size-3 rounded-full border" style={{ background: d.color ?? "transparent" }} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{d.name}</span>
                {!d.active && <span className="ml-2 text-xs text-muted-foreground">archived</span>}
                <span className="block text-xs text-muted-foreground">
                  {d.employees} employee{d.employees === 1 ? "" : "s"}
                  {d.head ? ` · Head: ${d.head}` : ""}
                </span>
              </span>
              <Button size="icon-sm" variant="ghost" aria-label={`Edit ${d.name}`} onClick={() => setEdit({ id: d.id, name: d.name, color: d.color ?? "" })}>
                <PencilIcon />
              </Button>
              {d.active ? (
                <Button size="icon-sm" variant="ghost" aria-label={`Remove ${d.name}`} title={d.employees ? "Archive" : "Delete"} disabled={pending} onClick={() => run(() => removeDepartment(d.id))}>
                  <ArchiveIcon />
                </Button>
              ) : (
                <Button size="icon-sm" variant="ghost" aria-label={`Restore ${d.name}`} disabled={pending} onClick={() => run(() => restoreDepartment(d.id))}>
                  <ArchiveRestoreIcon />
                </Button>
              )}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
