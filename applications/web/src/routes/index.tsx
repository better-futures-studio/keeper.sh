import { createFileRoute, redirect } from "@tanstack/react-router";
import { resolveRootRedirect } from "@/lib/route-access-guards";

export const Route = createFileRoute("/")({
  beforeLoad: ({ context }) => {
    throw redirect({ to: resolveRootRedirect(context.auth.hasSession()) });
  },
});
