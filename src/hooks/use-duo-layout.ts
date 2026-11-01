"use client";

import { useEffect, useState } from "react";

export type DuoLayout = {
  /**
   * iPhone Duo outer display + open landscape put controls on the side
   * to preserve vertical content space (HIG: Vertical controls).
   */
  sideRail: boolean;
  /** Inner Duo / tablet / desktop — room for split list+detail. */
  regularWidth: boolean;
  /** Narrow / outer display — prefer stacked cards over wide tables. */
  compactWidth: boolean;
};

const SIDE_RAIL_QUERY =
  "(orientation: landscape), (max-height: 560px)";
const REGULAR_WIDTH_QUERY = "(min-width: 900px)";

function readLayout(): DuoLayout {
  if (typeof window === "undefined") {
    return { sideRail: false, regularWidth: true, compactWidth: false };
  }
  const sideRail = window.matchMedia(SIDE_RAIL_QUERY).matches;
  const regularWidth = window.matchMedia(REGULAR_WIDTH_QUERY).matches;
  return {
    sideRail,
    regularWidth,
    compactWidth: !regularWidth,
  };
}

/** Fluid size classes for iPhone Duo outer/inner displays and resize. */
export function useDuoLayout(): DuoLayout {
  const [layout, setLayout] = useState<DuoLayout>(readLayout);

  useEffect(() => {
    const sideMq = window.matchMedia(SIDE_RAIL_QUERY);
    const widthMq = window.matchMedia(REGULAR_WIDTH_QUERY);
    const sync = () => setLayout(readLayout());
    sync();
    sideMq.addEventListener("change", sync);
    widthMq.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    return () => {
      sideMq.removeEventListener("change", sync);
      widthMq.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);

  return layout;
}
