import { BackButton } from "@/components/BackButton";
import { PreviewDataBanner } from "@/components/PreviewDataBanner";
import { Nav } from "@/components/Nav";
import { SiteFooter } from "@/components/SiteFooter";
import { InstallPrompt } from "@/components/InstallPrompt";
import { AppTabBar } from "@/components/AppTabBar";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PreviewDataBanner />
      <Nav />
      {/* Top-left of the content column rather than in the nav bar: the back
          button belongs to the page you are on, not to the site chrome, and
          it reads that way sitting directly above the page heading. It shares
          the main padding box, so it lines up with the h1 below it.

          Renders nothing on root pages and above md, and it is the margin's
          owner (mb-3 lives on the button, not on a wrapper here), so on every
          page without a back button this contributes no element and no
          space — the heading sits exactly where it always did. */}
      <main className="mx-auto max-w-7xl px-4 py-6">
        <BackButton />
        {children}
      </main>
      <SiteFooter />
      {/* Bottom-anchored and fixed, so it overlays rather than displacing the
          footer. Mounted on the PUBLIC layout only — /admin and /dashboard are
          separate trees, and prompting a signed-in admin to install the tipping
          app is not the audience this is for. */}
      <InstallPrompt />
      {/* The installed app's primary navigation. Rendered unconditionally and
          hidden in a browser tab by CSS — see the note in the component and the
          app-shell section of globals.css. Mounted beside InstallPrompt on the
          PUBLIC layout only, matching it: /admin and /dashboard are separate
          trees with their own chrome. */}
      <AppTabBar />
    </>
  );
}
