import Image from "next/image";
import { BRAND_ICON_DARK, BRAND_ICON_LIGHT, BRAND_ICON_SIZE } from "@/lib/brandAssets";
import { PRELOADER_SCRIPT } from "@/lib/preloader";

/**
 * The logo mark alone, centred over the page while it first loads. See
 * src/lib/preloader.ts for when it shows and how it is dismissed; the
 * styling (fade, pulse, reduced-motion and no-JS fallbacks) lives in
 * globals.css under .bg-preloader.
 */
export function Preloader() {
  return (
    <>
      {/* Before the overlay, so a skipped page is marked before the overlay is ever parsed, let alone painted. */}
      <script dangerouslySetInnerHTML={{ __html: PRELOADER_SCRIPT }} />
      <div className="bg-preloader" aria-hidden>
        <Image src={BRAND_ICON_DARK} alt="" {...BRAND_ICON_SIZE} sizes="64px" priority className="bg-preloader-mark brand-mark-dark h-16 w-auto" />
        <Image src={BRAND_ICON_LIGHT} alt="" {...BRAND_ICON_SIZE} sizes="64px" priority className="bg-preloader-mark brand-mark-light h-16 w-auto" />
      </div>
    </>
  );
}
