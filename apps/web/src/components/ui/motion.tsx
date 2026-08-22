"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { HTMLMotionProps } from "motion/react";
import { cn } from "@/lib/utils";

const EMPHASIZED_EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Small enter/exit transition for menus and compact floating panels.
 * Motion is intentionally subtle and becomes instantaneous when the user asks
 * the operating system to reduce animation.
 */
export function MotionPresence({
  show,
  children,
  className,
  side = "bottom",
  ...rest
}: Omit<HTMLMotionProps<"div">, "children"> & {
  show: boolean;
  children: React.ReactNode;
  side?: "top" | "bottom";
}) {
  const reduceMotion = useReducedMotion();
  const direction = side === "top" ? 1 : -1;

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 6 * direction, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 4 * direction, scale: 0.985 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 0.16, ease: EMPHASIZED_EASE }
          }
          className={cn(side === "top" ? "origin-bottom" : "origin-top", className)}
          {...rest}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Smoothly replaces a fixed-footprint icon without resizing its control. */
export function IconSwap({
  swapKey,
  children,
  className,
}: {
  swapKey: React.Key;
  children: React.ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={swapKey}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.72, y: 2 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.72, y: -2 }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { type: "spring", stiffness: 520, damping: 34, mass: 0.55 }
        }
        className={cn("inline-flex items-center justify-center", className)}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
}

/** Shared moving background/underline for an accessible selected control. */
export function ActiveIndicator({
  layoutId,
  className,
}: {
  layoutId: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.span
      aria-hidden
      layoutId={reduceMotion ? undefined : layoutId}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 460, damping: 36, mass: 0.7 }
      }
      className={className}
    />
  );
}
