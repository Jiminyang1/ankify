import { cn } from "@/lib/utils";
import { getUserDisplayName } from "@/lib/user-identity";

const sizes = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
} as const;

export function UserAvatar({
  name,
  email,
  image,
  size = "md",
  className,
}: {
  name: string;
  email: string;
  image?: string | null;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const displayName = getUserDisplayName(name, email);
  const initial = Array.from(displayName)[0]?.toUpperCase() ?? "?";

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-accent/25 bg-accent-soft font-semibold text-accent",
        sizes[size],
        className,
      )}
      aria-hidden="true"
    >
      {initial}
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          referrerPolicy="no-referrer"
        />
      )}
    </span>
  );
}
