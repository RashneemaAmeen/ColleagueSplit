import { AVATAR_COLORS, cn, initials } from "@/lib/utils";
import type { Profile } from "@/lib/types";

const SIZES = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-xl",
} as const;

export function MemberAvatar({
  profile,
  size = "md",
  className,
}: {
  profile: Pick<Profile, "name" | "colorIndex" | "avatarUrl">;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const color = AVATAR_COLORS[profile.colorIndex % AVATAR_COLORS.length];
  if (profile.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={profile.avatarUrl}
        alt={profile.name}
        className={cn("shrink-0 rounded-full object-cover", SIZES[size], className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white",
        SIZES[size],
        className,
      )}
      style={{ backgroundColor: color }}
    >
      {initials(profile.name)}
    </span>
  );
}
