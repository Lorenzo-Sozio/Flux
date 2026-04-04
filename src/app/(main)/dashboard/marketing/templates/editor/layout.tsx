// This layout renders over the dashboard chrome using a fixed overlay.
// The EmailBuilder component itself is h-screen fixed, so this is just a passthrough.
export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-background">
      {children}
    </div>
  );
}
