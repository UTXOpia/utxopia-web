"use client";

import { Fragment } from "react";
import { ChevronRight, LockKeyhole } from "lucide-react";
import { PRODUCT_COPY } from "@/lib/product-language";

const STEPS = [
  { step: "1", label: PRODUCT_COPY.actions.addFunds },
  { step: "2", label: PRODUCT_COPY.actions.sendPrivately },
  { step: "3", label: PRODUCT_COPY.actions.takeFundsOut },
];

export function VaultGuide() {
  return (
    <div className="px-3 py-3 bg-muted/30 rounded-[10px] mb-4">
      <div className="flex items-center gap-2 sm:gap-4">
        {STEPS.map((s, i) => (
          <Fragment key={s.step}>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold font-mono text-privacy/40">{s.step}</span>
              <span className="text-[11px] text-gray/50">{s.label}</span>
            </div>
            {i < 2 && <ChevronRight className="w-3 h-3 text-gray/15 shrink-0" />}
          </Fragment>
        ))}
        <div className="hidden flex-1 sm:block" />
        <div className="hidden items-center gap-1.5 sm:flex">
          <LockKeyhole className="w-3 h-3 text-privacy/40" />
          <span className="text-[10px] text-privacy/40 font-medium">Private</span>
        </div>
      </div>
    </div>
  );
}
