"use client";

import { Check, Moon, Sun, Eclipse } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/components/theme-provider";
import { THEME_LABELS, type Theme } from "@/lib/theme";

const OPTIONS: { value: Theme; icon: typeof Sun; hint: string }[] = [
  { value: "light", icon: Sun, hint: "Bright daytime UI" },
  { value: "dark", icon: Moon, hint: "Dim teal night UI" },
  { value: "ultra-dark", icon: Eclipse, hint: "Near-black OLED UI" },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const ActiveIcon =
    OPTIONS.find((o) => o.value === theme)?.icon ?? Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 bg-card/70"
          aria-label={`Theme: ${THEME_LABELS[theme]}`}
          title="Appearance"
        >
          <ActiveIcon className="size-4" />
          <span className="hidden sm:inline">{THEME_LABELS[theme]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {OPTIONS.map(({ value, icon: Icon, hint }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => setTheme(value)}
            className="gap-2"
          >
            <Icon className="size-4 shrink-0" />
            <span className="flex flex-1 flex-col">
              <span>{THEME_LABELS[value]}</span>
              <span className="text-[11px] text-muted-foreground">{hint}</span>
            </span>
            {theme === value && <Check className="size-4 opacity-80" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
