import type { ReactNode } from "react";

import { cn } from "@/shared/ui/utils";

type BadgeVariant = "green" | "red" | "yellow" | "blue" | "gray" | "purple";

const variantClasses: Record<BadgeVariant, string> = {
  green: "bg-emerald-50 text-emerald-700",
  red: "bg-red-50 text-red-600",
  yellow: "bg-amber-50 text-amber-700",
  blue: "bg-blue-50 text-blue-700",
  gray: "bg-gray-100 text-gray-500",
  purple: "bg-purple-50 text-purple-700",
};

function Badge({
  variant = "gray",
  className,
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

export { Badge };
export type { BadgeVariant };
