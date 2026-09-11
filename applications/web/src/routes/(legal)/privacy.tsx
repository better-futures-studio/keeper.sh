import type { PropsWithChildren } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Heading1, Heading2, Heading3 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";

export const Route = createFileRoute("/(legal)/privacy")({
  component: PrivacyPage,
  head: ({ match }) => {
    const { operatorName } = match.context.runtimeConfig;

    return {
      meta: [
        { title: `Privacy Policy · ${operatorName} Calendar Sync` },
        {
          content:
            `How ${operatorName}'s internal calendar-sync tool collects, uses, and retains calendar data for ${operatorName} staff.`,
          name: "description",
        },
      ],
    };
  },
});

function PrivacyPage() {
  const { runtimeConfig } = Route.useRouteContext();
  const { operatorName } = runtimeConfig;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Heading1>Privacy Policy</Heading1>
        <Text size="sm" tone="muted">Last updated: 10 September 2026</Text>
      </div>
      <div className="flex flex-col gap-8">
        <Section title="Overview">
          <Text size="sm">
            This tool is operated by {operatorName} (&ldquo;{operatorName}&rdquo;, &ldquo;we&rdquo;, &ldquo;our&rdquo;). It is a
            private, internal calendar-sync tool for {operatorName} staff. Sign-in is limited to authorized
            accounts, so only authorized {operatorName} staff can use it.
          </Text>
          <Text size="sm">
            The tool is a self-hosted build of the open-source Keeper.sh project, licensed AGPL-3.0. Its
            source code is public at{" "}
            <a
              href="https://github.com/better-futures-studio/keeper.sh"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-2"
            >
              github.com/better-futures-studio/keeper.sh
            </a>
            .
          </Text>
        </Section>

        <Section title="Information We Collect">
          <Heading3 as="h3">Connected Accounts</Heading3>
          <Text size="sm">
            When you connect a calendar, we store its account identity (email address and provider) and
            the credentials needed to read it: OAuth tokens for Google Calendar and Microsoft Outlook, or
            a CalDAV/iCal credential if you add one of those instead. These credentials are encrypted at
            rest.
          </Text>
          <Heading3 as="h3">Calendar Event Data</Heading3>
          <Text size="sm">
            We pull event data from your connected calendars, as provided by the calendar provider:
            titles, times, descriptions, locations, and attendees. We use this to create busy-block
            copies on the other calendars you connect.
          </Text>
          <Heading3 as="h3">Busy-Block Copies</Heading3>
          <Text size="sm">
            Copies are written to the destination calendars you chose, and are marked as created by this
            tool. They are private by default and carry only the source calendar&apos;s name, unless you
            change your sync settings to show more.
          </Text>
        </Section>

        <Section title="Google API Data Use">
          <Text size="sm">
            Our use of data obtained through Google APIs complies with the Google API Services User Data
            Policy, including its Limited Use requirements. Calendar data from Google is used only to
            provide the sync feature you configured. We never use it for advertising, never sell it,
            never use it to train models, and never show it to a human except as needed for support or
            security with your knowledge, or as required by law.
          </Text>
        </Section>

        <Section title="Hosting and Third Parties">
          <Text size="sm">
            The application, its database, and its cache run on Railway, in the US East region. To
            provide sync, the tool calls the APIs of the providers you connect: Google, Microsoft, and
            any CalDAV/iCal host you add. We use no analytics and no advertising, and we do not track
            you. The only cookies this tool sets are sign-in session cookies. It does not send email.
          </Text>
        </Section>

        <Section title="Data Retention">
          <Text size="sm">
            Data for a connected calendar or account stays stored for as long as it remains connected.
            Disconnecting a calendar or account removes its stored events and credentials. Hiding a
            calendar removes the events pulled from it. Nightly database backups may retain deleted data
            for a limited period afterward.
          </Text>
          <Text size="sm">
            You can ask a {operatorName} administrator, through internal company channels, to delete your data.
          </Text>
        </Section>

        <Section title="Who Can Access Your Data">
          <Text size="sm">
            {operatorName} administrators with infrastructure access can access stored data as needed to operate
            and support the tool. You can revoke this tool&apos;s access to your Google or Microsoft account
            at any time from that provider&apos;s account settings.
          </Text>
        </Section>

        <Section title="Questions and Deletion Requests">
          <Text size="sm">
            For questions about this policy, or to request deletion of your data, raise it with a {operatorName}{" "}
            administrator through the company&apos;s internal channels.
          </Text>
        </Section>

        <Section title="Changes to This Policy">
          <Text size="sm">
            We may update this policy as the tool changes. Updates are posted on this page with a
            revised &ldquo;Last updated&rdquo; date.
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
