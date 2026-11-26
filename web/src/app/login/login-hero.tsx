"use client";

import { motion } from "motion/react";
import { ScanFaceIcon } from "lucide-react";
import { COMPANY, PRODUCT } from "@/components/brand";

const FEATURES = [
  { label: "Face Check-in", dot: "bg-pastry-pink" },
  { label: "Smart Leave", dot: "bg-pastry-lime" },
  { label: "Auto Payroll", dot: "bg-pastry-cherry" },
];

export function LoginHero() {
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 flex items-center gap-3"
      >
        <span className="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/15 text-white">
          <ScanFaceIcon className="size-5" />
        </span>
        <span className="text-xl font-bold tracking-tight text-white">{PRODUCT}</span>
      </motion.div>

      <div className="relative z-10 space-y-5">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="text-4xl leading-[1.08] font-extrabold tracking-tight text-white xl:text-5xl"
        >
          Walk in,
          <br />
          get recognised,
          <br />
          <span className="text-pastry-lime">attendance done.</span>
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.4 }}
          className="max-w-md text-base leading-relaxed text-white/60"
        >
          Face-recognition attendance, leave and payroll for the {COMPANY} team — no cards, no queues.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.4 }}
          className="flex flex-wrap gap-2 pt-2"
        >
          {FEATURES.map((f, i) => (
            <motion.span
              key={f.label}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.5 + i * 0.08 }}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-[11px] font-medium tracking-wide text-white/85"
            >
              <span aria-hidden className={`size-1.5 rounded-full ${f.dot}`} />
              {f.label}
            </motion.span>
          ))}
        </motion.div>
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
        className="relative z-10 text-xs tracking-wide text-white/20"
      >
        {PRODUCT} · Built for {COMPANY}
      </motion.p>

      <motion.div
        aria-hidden
        animate={{ rotate: 360 }}
        transition={{ duration: 80, repeat: Infinity, ease: "linear" }}
        className="absolute -top-32 -right-32 size-[520px] rounded-full border border-white/[0.04]"
      />
      <motion.div
        aria-hidden
        animate={{ rotate: -360 }}
        transition={{ duration: 100, repeat: Infinity, ease: "linear" }}
        className="absolute -bottom-40 -left-40 size-[600px] rounded-full border border-white/[0.04]"
      />
    </>
  );
}
