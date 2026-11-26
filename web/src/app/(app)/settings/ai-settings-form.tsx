"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  BotIcon,
  CheckCircle2Icon,
  KeyRoundIcon,
  Loader2Icon,
  ShieldCheckIcon,
  SparklesIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { MODEL_SUGGESTIONS, isAiMode, type AiSettings, type ReviewMode, type ActionResult } from "@/lib/ai-settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { removeApiKey, saveAiSettings, saveApiKey, testApiKey } from "./actions";

type Props = AiSettings & { demo: boolean; canEdit: boolean };

function Choice({
  selected,
  onSelect,
  icon: Icon,
  title,
  description,
  disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ElementType;
  title: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-all",
        "hover:border-primary/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60",
        selected ? "border-primary bg-accent/60 shadow-sm" : "bg-card",
      )}
    >
      <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg", selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
        <Icon className="size-4" />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

export function AiSettingsForm(initial: Props) {
  const [mode, setMode] = useState<ReviewMode>(initial.reviewMode);
  const [model, setModel] = useState(initial.model);
  const [minConfidence, setMinConfidence] = useState(Math.round(initial.minConfidence * 100));
  const [rejectAllowed, setRejectAllowed] = useState(initial.rejectAllowed);
  const [keyLast4, setKeyLast4] = useState(initial.keyLast4);
  const [newKey, setNewKey] = useState("");
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const aiOn = isAiMode(mode);
  const disabled = !initial.canEdit;

  const run = (label: string, fn: () => Promise<ActionResult>, after?: (r: ActionResult) => void) => {
    setBusy(label);
    startTransition(async () => {
      const r = await fn();
      (r.ok ? toast.success : toast.error)(r.message);
      after?.(r);
      setBusy(null);
    });
  };

  const toggleAi = (on: boolean) => {
    if (on && !keyLast4 && !initial.demo) {
      toast.error("Add an OpenAI API key first, then turn AI review on.");
      return;
    }
    setMode(on ? "ai_assist" : "manual");
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {!initial.canEdit && (
        <p className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
          Only a super admin can change AI settings.
        </p>
      )}

      {/* Review mode */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BotIcon className="size-5 text-primary" /> AI leave review
            <Badge variant="outline" className={cn("ml-1", aiOn ? "border-success/30 bg-success-soft text-success" : "text-muted-foreground")}>
              {aiOn ? "On" : "Off"}
            </Badge>
          </CardTitle>
          <CardDescription>
            Leave rules are always checked automatically. AI adds a recommendation and summary for HR.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <label className="flex items-center justify-between gap-4 rounded-xl border bg-muted/40 p-4">
            <span className="flex flex-col">
              <span className="text-sm font-medium">Use AI to review leave requests</span>
              <span className="text-xs text-muted-foreground">
                OpenAI · no names, emails or salary are ever sent
              </span>
            </span>
            <Switch checked={aiOn} onCheckedChange={toggleAi} disabled={disabled} aria-label="AI leave review" />
          </label>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={aiOn ? "ai" : "noai"}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              role="radiogroup"
              className="grid gap-3 md:grid-cols-2"
            >
              {aiOn ? (
                <>
                  <Choice selected={mode === "ai_assist"} onSelect={() => setMode("ai_assist")} disabled={disabled}
                    icon={SparklesIcon} title="Recommend only (recommended)"
                    description="AI suggests approve / reject with a short reason. HR always makes the final decision." />
                  <Choice selected={mode === "ai_auto"} onSelect={() => setMode("ai_auto")} disabled={disabled}
                    icon={ZapIcon} title="Auto-approve safe requests"
                    description="Approves automatically only when every rule passes and AI is confident. Everything else goes to HR." />
                </>
              ) : (
                <>
                  <Choice selected={mode === "manual"} onSelect={() => setMode("manual")} disabled={disabled}
                    icon={CheckCircle2Icon} title="Manual"
                    description="HR or the department manager decides every request." />
                  <Choice selected={mode === "policy_auto"} onSelect={() => setMode("policy_auto")} disabled={disabled}
                    icon={ShieldCheckIcon} title="Auto-approve when all rules pass"
                    description="No AI. Requests that pass every rule are approved instantly; the rest go to HR." />
                </>
              )}
            </motion.div>
          </AnimatePresence>

          {aiOn && (
            <div className="grid gap-5 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="model">Model</Label>
                <Input id="model" list="model-suggestions" value={model} disabled={disabled}
                  onChange={(e) => setModel(e.target.value)} placeholder="gpt-4.1-mini" />
                <datalist id="model-suggestions">
                  {MODEL_SUGGESTIONS.map((m) => <option key={m} value={m} />)}
                </datalist>
                <p className="text-xs text-muted-foreground">Default gpt-4.1-mini — fast and low cost.</p>
              </div>

              {mode === "ai_auto" && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="confidence" className="flex justify-between">
                    Minimum confidence to auto-approve
                    <span className="font-mono tabular-nums text-primary">{minConfidence}%</span>
                  </Label>
                  <input id="confidence" type="range" min={50} max={99} step={1} value={minConfidence} disabled={disabled}
                    onChange={(e) => setMinConfidence(Number(e.target.value))}
                    className="h-2 w-full cursor-pointer accent-[var(--primary)]" />
                  <label className="mt-1 flex items-center justify-between gap-3 text-sm">
                    <span>
                      Allow AI to auto-reject
                      <span className="block text-xs text-muted-foreground">Not recommended — off by default</span>
                    </span>
                    <Switch checked={rejectAllowed} onCheckedChange={setRejectAllowed} disabled={disabled} size="sm" />
                  </label>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button disabled={disabled || pending}
              onClick={() => run("save", () => saveAiSettings({ reviewMode: mode, model, minConfidence: minConfidence / 100, rejectAllowed }))}>
              {busy === "save" && <Loader2Icon className="size-4 animate-spin" />} Save settings
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* API key */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-5 text-primary" /> OpenAI API key
          </CardTitle>
          <CardDescription>
            Kept on the server only and never sent to browsers — after saving, only the last 4 characters are shown.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/40 p-4">
            <span className={cn("size-2.5 rounded-full", keyLast4 ? "bg-success" : "bg-muted-foreground/40")} />
            <span className="text-sm">
              {keyLast4 ? (
                <>Key saved <span className="font-mono">sk-…{keyLast4}</span></>
              ) : (
                "No key saved"
              )}
            </span>
            {initial.keyUpdatedAt && keyLast4 && (
              <span className="text-xs text-muted-foreground">
                updated {new Date(initial.keyUpdatedAt).toLocaleDateString()}
              </span>
            )}
            {keyLast4 && (
              <div className="ml-auto flex gap-2">
                <Button variant="outline" size="sm" disabled={disabled || pending}
                  onClick={() => run("test", () => testApiKey(model))}>
                  {busy === "test" && <Loader2Icon className="size-4 animate-spin" />} Test key
                </Button>
                <Button variant="ghost" size="sm" className="text-danger" disabled={disabled || pending}
                  onClick={() => {
                    if (!confirm("Remove the OpenAI key? AI review will be turned off.")) return;
                    run("remove", removeApiKey, (r) => { if (r.ok) { setKeyLast4(null); setMode("manual"); } });
                  }}>
                  <Trash2Icon className="size-4" /> Remove
                </Button>
              </div>
            )}
          </div>

          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              const k = newKey;
              run("key", () => saveApiKey(k, model), (r) => {
                if (r.ok) { setKeyLast4(k.trim().slice(-4)); setNewKey(""); }
              });
            }}
          >
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="apikey">{keyLast4 ? "Replace key" : "Add key"}</Label>
              <Input id="apikey" type="password" autoComplete="off" spellCheck={false} placeholder="sk-..."
                value={newKey} onChange={(e) => setNewKey(e.target.value)} disabled={disabled} />
            </div>
            <Button type="submit" disabled={disabled || pending || newKey.trim().length < 20}>
              {busy === "key" && <Loader2Icon className="size-4 animate-spin" />} Verify & save
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            The key is checked with OpenAI before saving. Create one at platform.openai.com › API keys and set a monthly
            spending limit there.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
