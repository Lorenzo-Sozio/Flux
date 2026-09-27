// This layout renders over the dashboard chrome using a fixed overlay.
// The EmailBuilder component itself is h-dvh fixed, so this is just a passthrough.
//
// ⚠️ Padded by the safe area: installed to a home screen the page is drawn
// under the notch (`viewport-fit=cover`), and the builder's top bar — back
// button and save — sat beneath it. `[&>div]:h-full` then makes the builder's
// own `h-dvh` mean the box it was given, or its bottom edge would be pushed
// out of the overlay by exactly the padding added at the top.
export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-background pt-[var(--safe-top)] pb-[var(--safe-bottom)] [&>div]:h-full">
      {children}
    </div>
  );
}
