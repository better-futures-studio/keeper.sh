import type { PropsWithChildren } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Heading1, Heading2 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";

export const Route = createFileRoute("/(legal)/terms")({
  component: TermsPage,
  head: ({ match }) => {
    const { operatorName } = match.context.runtimeConfig;

    return {
      meta: [
        { title: `Terms & Conditions · ${operatorName} Calendar Sync` },
        {
          content:
            `Terms of use for ${operatorName}'s internal calendar-sync tool: who can use it, acceptable use, and the open-source license behind it.`,
          name: "description",
        },
      ],
    };
  },
});

function TermsPage() {
  const { runtimeConfig } = Route.useRouteContext();
  const { operatorName } = runtimeConfig;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Heading1>Terms &amp; Conditions</Heading1>
        <Text size="sm" tone="muted">Last updated: 10 September 2026</Text>
      </div>
      <div className="flex flex-col gap-8">
        <Section title="Agreement to Terms">
          <Text size="sm">
            These Terms are an agreement between you and {operatorName} (&ldquo;{operatorName}&rdquo;, &ldquo;we&rdquo;, &ldquo;our&rdquo;)
            governing your use of this internal calendar-sync tool. By using it, you agree to these
            Terms.
          </Text>
        </Section>

        <Section title="Description of Service">
          <Text size="sm">
            This tool reads the calendars you connect and creates busy-block copies of your events on
            other calendars you connect, so your availability stays in sync across accounts.
          </Text>
          <Text size="sm">
            It is a private, internal tool for {operatorName} staff. It is not offered to the public.
          </Text>
        </Section>

        <Section title="Who May Use This Tool">
          <Text size="sm">
            This tool is for authorized {operatorName} staff, for work purposes. You may only connect calendars
            you are entitled to access. You are responsible for keeping your account credentials secure
            and for activity under your account.
          </Text>
        </Section>

        <Section title="Acceptable Use">
          <Text size="sm">You agree not to:</Text>
          <ul className="list-disc list-inside flex flex-col gap-1 ml-2 text-sm tracking-tight text-foreground-muted">
            <li>Use the tool for any unlawful purpose or in violation of any applicable laws</li>
            <li>Attempt to gain unauthorized access to any part of the tool or its underlying systems</li>
            <li>Interfere with or disrupt the operation of the tool</li>
            <li>Connect a calendar you are not entitled to access</li>
            <li>Share your account access with anyone outside {operatorName}</li>
          </ul>
        </Section>

        <Section title="Changes to the Service">
          <Text size="sm">
            {operatorName} may change, suspend, or discontinue this tool, or any part of it, at any time.
          </Text>
        </Section>

        <Section title="No Warranty">
          <Text size="sm">
            This tool is provided as is, without warranties of any kind, express or implied. {operatorName}{" "}
            does not warrant that it will be uninterrupted, secure, or error-free.
          </Text>
        </Section>

        <Section title="Open-Source License">
          <Text size="sm">
            This tool is a self-hosted build of the open-source Keeper.sh project, licensed AGPL-3.0. Its
            source code is public at{" "}
            <a
              href="https://github.com/better-futures-studio/keeper.sh"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-2"
            >
              github.com/better-futures-studio/keeper.sh
            </a>
            . That license governs the source code itself; it does not extend any rights to use this
            hosted instance beyond what these Terms allow.
          </Text>
        </Section>

        <Section title="Changes to These Terms">
          <Text size="sm">
            We may update these Terms as the tool changes. Updates are posted on this page with a
            revised &ldquo;Last updated&rdquo; date.
          </Text>
        </Section>

        <Section title="Questions">
          <Text size="sm">
            For questions about these Terms, raise them with a {operatorName} administrator through the
            company&apos;s internal channels.
          </Text>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <section className="flex flex-col gap-3">
      <Heading2 as="h2">{title}</Heading2>
      {children}
    </section>
  );
}
