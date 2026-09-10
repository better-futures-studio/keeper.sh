import { createKeeperApi } from "@/read-models";
import type { KeeperSource } from "@/types";
import { withV1Auth, withWideEvent } from "@/utils/middleware";
import { database } from "@/context";

const keeperApi = createKeeperApi(database);

const toCalendar = (source: KeeperSource) => ({
  id: source.id,
  name: source.name,
  provider: source.providerName,
  account: source.accountLabel,
  hidden: source.hidden,
});

const GET = withWideEvent(
  withV1Auth(async ({ request, userId }) => {
    const url = new URL(request.url);
    const providerFilter = url.searchParams.get("provider");
    const includeHidden = url.searchParams.get("includeHidden") === "true";

    let sources = await keeperApi.listSources(userId);

    if (providerFilter) {
      const providers = new Set(providerFilter.split(",").filter(Boolean));
      sources = sources.filter((source) => providers.has(source.provider));
    }

    if (!includeHidden) {
      sources = sources.filter((source) => !source.hidden);
    }

    return Response.json(sources.map((source) => toCalendar(source)));
  }),
);

export { GET };
