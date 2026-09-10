import { useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import KeyRound from "lucide-react/dist/esm/icons/key-round";
import KeySquare from "lucide-react/dist/esm/icons/key-square";
import Lock from "lucide-react/dist/esm/icons/lock";
import Mail from "lucide-react/dist/esm/icons/mail";
import Cookie from "lucide-react/dist/esm/icons/cookie";
import { pluralize } from "@/lib/pluralize";
import { BackButton } from "@/components/ui/primitives/back-button";
import { useSession } from "@/hooks/use-session";
import { useApiTokens } from "@/hooks/use-api-tokens";
import { usePasskeys } from "@/hooks/use-passkeys";
import { useHasPassword } from "@/hooks/use-has-password";
import { resolveAccountIdentity } from "@/lib/account-identity";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLinkItem,
  NavigationMenuToggleItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { setAnalyticsConsent, track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { useEffectiveConsent } from "@/hooks/use-effective-consent";
import { Text } from "@/components/ui/primitives/text";
import { fetchAuthCapabilitiesWithApi } from "@/lib/auth-capabilities";

export const Route = createFileRoute("/(dashboard)/dashboard/settings/")({
  loader: async ({ context }) => {
    const authCapabilities = await fetchAuthCapabilitiesWithApi(context.fetchApi);
    return { authCapabilities };
  },
  component: SettingsPage,
});

function SettingsPage() {
  const { authCapabilities } = Route.useLoaderData();
  const { user } = useSession();
  const { data: hasPassword = false } = useHasPassword();
  const { label: accountLabel, value: accountValue } = resolveAccountIdentity(user);
  const { data: apiTokens = [] } = useApiTokens();
  const { data: passkeys = [] } = usePasskeys(authCapabilities.supportsPasskeys);
  const analyticsConsent = useEffectiveConsent();
  const handleAnalyticsToggle = useCallback((checked: boolean) => {
    track(ANALYTICS_EVENTS.analytics_consent_changed, { granted: checked });
    setAnalyticsConsent(checked);
  }, []);

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton />
      <NavigationMenu>
        <NavigationMenuItem>
          <NavigationMenuItemIcon>
            <Mail size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>{accountLabel}</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing>
            <Text size="sm" tone="muted" className="truncate">{accountValue}</Text>
          </NavigationMenuItemTrailing>
        </NavigationMenuItem>
      </NavigationMenu>
      <NavigationMenu>
        {hasPassword && authCapabilities.supportsChangePassword && (
          <NavigationMenuLinkItem to="/dashboard/settings/change-password">
            <NavigationMenuItemIcon>
              <Lock size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Change Password</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing />
          </NavigationMenuLinkItem>
        )}
        {authCapabilities.supportsPasskeys && (
          <NavigationMenuLinkItem to="/dashboard/settings/passkeys">
            <NavigationMenuItemIcon>
              <KeyRound size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Passkeys</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing>
              <Text size="sm" tone="muted">
                {pluralize(passkeys.length, "passkey", "passkeys")}
              </Text>
            </NavigationMenuItemTrailing>
          </NavigationMenuLinkItem>
        )}
        <NavigationMenuLinkItem to="/dashboard/settings/api-tokens">
          <NavigationMenuItemIcon>
            <KeySquare size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>API Tokens</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing>
            <Text size="sm" tone="muted">
              {pluralize(apiTokens.length, "token", "tokens")}
            </Text>
          </NavigationMenuItemTrailing>
        </NavigationMenuLinkItem>
      </NavigationMenu>
      <NavigationMenu>
        <NavigationMenuToggleItem checked={analyticsConsent} onCheckedChange={handleAnalyticsToggle}>
          <NavigationMenuItemIcon>
            <Cookie size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>Analytics Cookies</NavigationMenuItemLabel>
        </NavigationMenuToggleItem>
      </NavigationMenu>
    </div>
  );
}
