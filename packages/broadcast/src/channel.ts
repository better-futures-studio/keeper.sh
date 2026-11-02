const DEFAULT_BROADCAST_CHANNEL = "broadcast";
const MAX_BROADCAST_CHANNEL_LENGTH = 256;
const BROADCAST_CHANNEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/;

const BROADCAST_CHANNEL_ERROR =
  "Broadcast channel must be a non-empty name of letters, digits, colon, dot, underscore or hyphen";

const resolveBroadcastChannel = (channel?: string): string => {
  if (typeof channel !== "string") {
    return DEFAULT_BROADCAST_CHANNEL;
  }
  if (
    channel.length === 0
    || channel.length > MAX_BROADCAST_CHANNEL_LENGTH
    || !BROADCAST_CHANNEL_PATTERN.test(channel)
  ) {
    throw new Error(BROADCAST_CHANNEL_ERROR);
  }
  return channel;
};

export {
  BROADCAST_CHANNEL_ERROR,
  DEFAULT_BROADCAST_CHANNEL,
  MAX_BROADCAST_CHANNEL_LENGTH,
  resolveBroadcastChannel,
};
