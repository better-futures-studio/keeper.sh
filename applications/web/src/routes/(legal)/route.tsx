import { createFileRoute, Outlet } from "@tanstack/react-router";
import { TextLink } from "@/components/ui/primitives/text-link";

export const Route = createFileRoute("/(legal)")({
  component: LegalLayout,
  head: () => ({
    meta: [{ content: "noindex, nofollow", name: "robots" }],
  }),
});

function LegalLayout() {
  return (
    <div className="flex min-h-dvh justify-center px-4 py-16">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <TextLink align="left" size="sm" to="/login" tone="muted">
          Back to login
        </TextLink>
        <Outlet />
      </div>
    </div>
  );
}
